import { describe, it, expect, beforeEach } from 'vitest';
import { runSaga, type Step } from '../engine/sagaEngine';
import { call, put, run, type Effect } from '../engine/effectRunner';
import { api, ledger, resetFailures, setFailureRate, timing } from '../api/mockApi';
import { makeStore } from '../app/store';
import { checkoutActions as a } from '../features/checkout/checkoutSlice';

timing.minMs = 0; timing.maxMs = 5;
beforeEach(() => { resetFailures(); ledger.length = 0; });

const until = async (store: ReturnType<typeof makeStore>, pred: (p: string) => boolean) => {
  for (let i = 0; i < 400; i++) {
    if (pred(store.getState().checkout.phase)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timeout, phase=' + store.getState().checkout.phase);
};

describe('framework-free engine', () => {
  type Ctx = { log: string[] };
  const mk = (name: string, fail = false): Step<Ctx> => ({
    name,
    run: async (c) => { if (fail) throw new Error(name); c.log.push('do ' + name); },
    compensate: async (c) => { c.log.push('undo ' + name); },
  });
  it('completes', async () => {
    const r = await runSaga([mk('a'), mk('b')], { log: [] });
    expect(r.status).toBe('completed');
  });
  it('compensates in reverse order', async () => {
    const ctx: Ctx = { log: [] };
    const r = await runSaga([mk('a'), mk('b'), mk('c', true)], ctx, () => {}, undefined, 1);
    expect(r.status).toBe('rolled_back');
    expect(ctx.log).toEqual(['do a', 'do b', 'undo b', 'undo a']);
  });
});

describe('effect runner', () => {
  function* login(id: string): Generator<Effect, string, any> {
    const user: { name: string } = yield call(async (x: string) => ({ name: 'u' + x }), id);
    yield put({ type: 'LOGIN_OK', payload: user });
    return user.name;
  }
  it('runs and is testable without a runner', async () => {
    const actions: string[] = [];
    expect(await run(login('1'), (x) => actions.push(x.type))).toBe('u1');
    expect(actions).toEqual(['LOGIN_OK']);
    const g = login('9');                                  // step-by-step unit test
    expect(g.next().value).toMatchObject({ type: 'CALL' });
    expect(g.next({ name: 'z' }).value).toEqual(put({ type: 'LOGIN_OK', payload: { name: 'z' } }));
  });
});

describe('redux-saga checkout', () => {
  it('happy path', async () => {
    const s = makeStore(); s.dispatch(a.checkoutRequested({ cartId: 'c1' }));
    await until(s, (p) => p === 'success');
    expect(ledger.map((l) => l.split(':')[0])).toEqual(['reserved', 'charged', 'order']);
  });
  it('card fails -> stock released', async () => {
    setFailureRate('charge', 1);
    const s = makeStore(); s.dispatch(a.checkoutRequested({ cartId: 'c2' }));
    await until(s, (p) => p === 'rolledBack');
    expect(ledger.map((l) => l.split(':')[0])).toEqual(['reserved', 'released']);
  }, 10000);
  it('order fails -> refund THEN release (reverse order)', async () => {
    setFailureRate('createOrder', 1);
    const s = makeStore(); s.dispatch(a.checkoutRequested({ cartId: 'c3' }));
    await until(s, (p) => p === 'rolledBack');
    expect(ledger.map((l) => l.split(':')[0])).toEqual(['reserved', 'charged', 'refunded', 'released']);
  }, 10000);
  it('refund keeps failing -> stuck, and release is NOT attempted', async () => {
    setFailureRate('createOrder', 1); setFailureRate('refund', 1);
    const s = makeStore(); s.dispatch(a.checkoutRequested({ cartId: 'c4' }));
    await until(s, (p) => p === 'stuck');
    expect(s.getState().checkout.steps.chargeCard).toBe('comp_failed');
    expect(ledger.some((l) => l.startsWith('released'))).toBe(false);
  }, 10000);
  it('cancel mid-flight -> compensates what completed', async () => {
    timing.minMs = 30; timing.maxMs = 30;
    const s = makeStore(); s.dispatch(a.checkoutRequested({ cartId: 'c5' }));
    await new Promise((r) => setTimeout(r, 45));          // reserveStock done, charge in flight
    s.dispatch(a.cancelRequested());
    await until(s, (p) => p === 'cancelled');
    expect(ledger.some((l) => l.startsWith('released'))).toBe(true);
    timing.minMs = 0; timing.maxMs = 5;
  }, 10000);
  it('double click is ignored (takeLeading)', async () => {
    const s = makeStore();
    s.dispatch(a.checkoutRequested({ cartId: 'c6' })); s.dispatch(a.checkoutRequested({ cartId: 'c6' }));
    await until(s, (p) => p === 'success');
    expect(ledger.filter((l) => l.startsWith('charged')).length).toBe(1);
  });
});

import { runSaga as reduxRunSaga } from 'redux-saga';
import { checkoutSaga } from '../features/checkout/checkoutSagas';
import { callWithRetry, ApiError, isRetryable } from '../lib/retry';

describe('extras', () => {
  it('runSaga: isolated saga test, no store needed', async () => {
    const dispatched: { type: string }[] = [];
    await reduxRunSaga({ dispatch: (x: { type: string }) => dispatched.push(x), getState: () => ({}) },
      checkoutSaga, a.checkoutRequested({ cartId: 'c7' })).toPromise();
    expect(dispatched.map((d) => d.type)).toEqual([
      'checkout/stepStarted', 'checkout/stepSucceeded', 'checkout/stepStarted', 'checkout/stepSucceeded',
      'checkout/stepStarted', 'checkout/stepSucceeded', 'checkout/checkoutSucceeded']);
  });
  it('callWithRetry: retries transient, not 4xx', async () => {
    let n = 0;
    const flaky = async () => { if (++n < 3) throw new ApiError(503, 'down'); return 'ok'; };
    expect(await reduxRunSaga({ dispatch: () => {} }, callWithRetry, flaky).toPromise()).toBe('ok');
    let m = 0;
    const declined = async () => { m++; throw new ApiError(402, 'declined'); };
    await expect(reduxRunSaga({ dispatch: () => {} }, callWithRetry, declined).toPromise()).rejects.toThrow('declined');
    expect(m).toBe(1);
    expect(isRetryable(new TypeError('network'))).toBe(true);
  }, 10000);
});

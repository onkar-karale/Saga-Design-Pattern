import {
  call, put, race, retry, take, takeLeading, cancelled, all, type StrictEffect,
} from 'redux-saga/effects';
import type { SagaIterator } from 'redux-saga';
import type { PayloadAction } from '@reduxjs/toolkit';
import { api, type Order, type Payment, type Reservation } from '../../api/mockApi';
import { checkoutActions as a, type StepName } from './checkoutSlice';

type Undo = { step: StepName; run: () => Promise<unknown> };
const RETRY = { tries: 3, delayMs: 300 };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Undo everything in `undo`, newest first. Returns true if fully rolled back. */
export function* compensate(undo: Undo[]): Generator<StrictEffect, boolean, any> {
  for (const u of [...undo].reverse()) {
    yield put(a.compensationStarted(u.step));
    try {
      yield retry(RETRY.tries, RETRY.delayMs, u.run); // compensations MUST be retried
      yield put(a.compensationDone(u.step));
    } catch {
      yield put(a.compensationFailed(u.step));
      return false;                                   // stuck: stop and surface it
    }
  }
  return true;
}

export function* checkoutSaga(action: PayloadAction<{ cartId: string }>): SagaIterator {
  const { cartId } = action.payload;
  const undo: Undo[] = [];                 // the compensation stack lives in the generator
  let current: StepName = 'reserveStock';
  let handled = false;

  try {
    current = 'reserveStock';
    yield put(a.stepStarted(current));
    const res: Reservation = yield call(api.reserveStock, cartId);
    undo.push({ step: current, run: () => api.releaseStock(res.id) });
    yield put(a.stepSucceeded({ step: current, ids: { reservationId: res.id } }));

    current = 'chargeCard';
    yield put(a.stepStarted(current));
    const pay: Payment = yield retry(RETRY.tries, RETRY.delayMs, api.charge, cartId, `charge-${cartId}`);
    undo.push({ step: current, run: () => api.refund(pay.id) });
    yield put(a.stepSucceeded({ step: current, ids: { paymentId: pay.id } }));

    current = 'createOrder';
    yield put(a.stepStarted(current));
    const order: Order = yield call(api.createOrder, { cartId, paymentId: pay.id });
    yield put(a.stepSucceeded({ step: current, ids: { orderId: order.id } }));

    handled = true;
    yield put(a.checkoutSucceeded());
  } catch (err) {
    handled = true;
    yield put(a.stepFailed({ step: current, error: msg(err) }));
    const ok: boolean = yield call(compensate, undo);
    if (ok) yield put(a.checkoutRolledBack({ cancelled: false }));
  } finally {
    // Runs when the task is CANCELLED (e.g. it lost a race). Effects are still allowed here.
    if (!handled && (yield cancelled())) {
      const ok: boolean = yield call(compensate, undo);
      if (ok) yield put(a.checkoutRolledBack({ cancelled: true }));
    }
  }
}

/** One checkout at a time; the Cancel button can interrupt it. */
function* checkoutFlow(action: PayloadAction<{ cartId: string }>): SagaIterator {
  yield race({
    run: call(checkoutSaga, action),
    cancel: take(a.cancelRequested.type),
  });
}

export function* checkoutWatcher(): SagaIterator {
  yield takeLeading(a.checkoutRequested.type, checkoutFlow); // ignores double-clicks
}

export function* rootSaga(): SagaIterator {
  yield all([call(checkoutWatcher)]);
}

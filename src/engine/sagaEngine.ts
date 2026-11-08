// A framework-free saga orchestrator: steps + compensations, in ~90 lines.

export type Step<C> = {
  name: string;
  run: (ctx: C, signal: AbortSignal) => Promise<Partial<C> | void>;
  compensate?: (ctx: C) => Promise<void>;
  retries?: number; // how many times to retry run() before declaring failure
};

export type SagaEvent =
  | { type: 'step:start'; step: string }
  | { type: 'step:done'; step: string }
  | { type: 'step:failed'; step: string; error: unknown }
  | { type: 'compensate:start'; step: string }
  | { type: 'compensate:done'; step: string }
  | { type: 'compensate:failed'; step: string; error: unknown }
  | { type: 'saga:completed' }
  | { type: 'saga:rolled_back' }
  | { type: 'saga:stuck' };

export type SagaResult<C> =
  | { status: 'completed'; ctx: C }
  | { status: 'rolled_back'; ctx: C; error: unknown }
  | { status: 'cancelled'; ctx: C }
  | { status: 'stuck'; ctx: C; failedAt: string; error: unknown };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, retries: number, baseMs = 200): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(baseMs * 2 ** attempt); // exponential backoff
    }
  }
}

export async function runSaga<C extends object>(
  steps: Step<C>[],
  initial: C,
  emit: (e: SagaEvent) => void = () => {},
  signal: AbortSignal = new AbortController().signal,
  backoffMs = 200,
): Promise<SagaResult<C>> {
  let ctx: C = { ...initial };
  const completed: Step<C>[] = []; // the "compensation stack"

  for (const step of steps) {
    emit({ type: 'step:start', step: step.name });
    try {
      if (signal.aborted) throw new Error('cancelled');
      const patch = await withRetry(() => step.run(ctx, signal), step.retries ?? 0, backoffMs);
      ctx = { ...ctx, ...(patch ?? {}) };
      completed.push(step);
      emit({ type: 'step:done', step: step.name });
    } catch (error) {
      emit({ type: 'step:failed', step: step.name, error });
      return rollback(completed, ctx, error, emit, signal.aborted, backoffMs);
    }
  }
  emit({ type: 'saga:completed' });
  return { status: 'completed', ctx };
}

async function rollback<C extends object>(
  completed: Step<C>[],
  ctx: C,
  error: unknown,
  emit: (e: SagaEvent) => void,
  wasCancelled: boolean,
  backoffMs: number,
): Promise<SagaResult<C>> {
  for (const step of [...completed].reverse()) {        // newest first!
    if (!step.compensate) continue;
    emit({ type: 'compensate:start', step: step.name });
    try {
      await withRetry(() => step.compensate!(ctx), 3, backoffMs);
      emit({ type: 'compensate:done', step: step.name });
    } catch (e) {
      emit({ type: 'compensate:failed', step: step.name, error: e });
      emit({ type: 'saga:stuck' });
      return { status: 'stuck', ctx, failedAt: step.name, error: e };
    }
  }
  emit({ type: 'saga:rolled_back' });
  return wasCancelled ? { status: 'cancelled', ctx } : { status: 'rolled_back', ctx, error };
}

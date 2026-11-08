// The heart of redux-saga in ~30 lines: generators yield *descriptions* of work,
// a runner performs the work and feeds results back in.

export type Effect =
  | { type: 'CALL'; fn: (...args: any[]) => unknown; args: unknown[] }
  | { type: 'PUT'; action: { type: string; payload?: unknown } };

export const call = (fn: (...args: any[]) => unknown, ...args: unknown[]): Effect => ({
  type: 'CALL', fn, args,
});
export const put = (action: { type: string; payload?: unknown }): Effect => ({
  type: 'PUT', action,
});

export async function run<T>(
  saga: Generator<Effect, T, any>,
  dispatch: (a: { type: string; payload?: unknown }) => void,
): Promise<T> {
  let step = saga.next();
  while (!step.done) {
    const effect = step.value;
    try {
      let result: unknown;
      if (effect.type === 'CALL') result = await effect.fn(...effect.args);
      if (effect.type === 'PUT') dispatch(effect.action);
      step = saga.next(result);      // success: resume the generator with the result
    } catch (err) {
      step = saga.throw(err);        // failure: throw INTO the generator, at the yield
    }
  }
  return step.value;
}

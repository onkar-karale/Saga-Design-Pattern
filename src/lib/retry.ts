import { call, delay, type StrictEffect } from 'redux-saga/effects';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Retry network errors, 5xx, 408, 429. Never retry 4xx (declined card, validation...). */
export const isRetryable = (e: unknown) =>
  !(e instanceof ApiError) || e.status >= 500 || e.status === 408 || e.status === 429;

export function* callWithRetry<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  ...args: A
): Generator<StrictEffect, R, any> {
  for (let attempt = 1; ; attempt++) {
    try {
      return (yield call(fn, ...args)) as R;
    } catch (e) {
      if (!isRetryable(e) || attempt >= 3) throw e;
      yield delay(300 * 2 ** (attempt - 1) + Math.random() * 100); // backoff + jitter
    }
  }
}

import { call, cancelled } from 'redux-saga/effects';

/** fetch that is really aborted when the saga is cancelled (race loser, takeLatest, cancel). */
export function* abortableFetch(url: string): Generator<any, Response, any> {
  const controller = new AbortController();
  try {
    return (yield call(fetch, url, { signal: controller.signal })) as Response;
  } finally {
    if (yield cancelled()) controller.abort();
  }
}

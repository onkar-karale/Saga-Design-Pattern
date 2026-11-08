import { configureStore } from '@reduxjs/toolkit';
import createSagaMiddleware from 'redux-saga';
import checkout from '../features/checkout/checkoutSlice';
import { rootSaga } from '../features/checkout/checkoutSagas';

export function makeStore() {
  const sagaMiddleware = createSagaMiddleware();
  const store = configureStore({
    reducer: { checkout },
    middleware: (getDefault) => getDefault().concat(sagaMiddleware),
  });
  sagaMiddleware.run(rootSaga);
  return store;
}
export const store = makeStore();
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

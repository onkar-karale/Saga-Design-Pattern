import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './app/store';
import { CheckoutLab } from './components/CheckoutLab';

createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <CheckoutLab />
  </Provider>,
);

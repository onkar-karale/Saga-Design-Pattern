import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type StepName = 'reserveStock' | 'chargeCard' | 'createOrder';
export type StepStatus =
  | 'pending' | 'running' | 'done' | 'failed' | 'compensating' | 'compensated' | 'comp_failed';
export type Phase = 'idle' | 'running' | 'compensating' | 'success' | 'rolledBack' | 'cancelled' | 'stuck';

export interface CheckoutState {
  phase: Phase;
  steps: Record<StepName, StepStatus>;
  ids: { reservationId?: string; paymentId?: string; orderId?: string };
  error?: string;
  log: string[];
}

const freshSteps = (): CheckoutState['steps'] => ({
  reserveStock: 'pending', chargeCard: 'pending', createOrder: 'pending',
});
const initialState: CheckoutState = { phase: 'idle', steps: freshSteps(), ids: {}, log: [] };

const slice = createSlice({
  name: 'checkout',
  initialState,
  reducers: {
    // --- commands (UI -> saga) ---
    checkoutRequested(state, _a: PayloadAction<{ cartId: string }>) {
      return { ...initialState, phase: 'running', steps: freshSteps(), log: ['checkout requested'] };
    },
    cancelRequested() {},
    // --- facts (saga -> reducer) ---
    stepStarted(state, a: PayloadAction<StepName>) {
      state.steps[a.payload] = 'running'; state.log.push(`${a.payload}: started`);
    },
    stepSucceeded(state, a: PayloadAction<{ step: StepName; ids?: Partial<CheckoutState['ids']> }>) {
      state.steps[a.payload.step] = 'done';
      Object.assign(state.ids, a.payload.ids);
      state.log.push(`${a.payload.step}: done`);
    },
    stepFailed(state, a: PayloadAction<{ step: StepName; error: string }>) {
      state.steps[a.payload.step] = 'failed'; state.error = a.payload.error;
      state.log.push(`${a.payload.step}: FAILED (${a.payload.error})`);
    },
    compensationStarted(state, a: PayloadAction<StepName>) {
      state.phase = 'compensating'; state.steps[a.payload] = 'compensating';
      state.log.push(`undo ${a.payload}: started`);
    },
    compensationDone(state, a: PayloadAction<StepName>) {
      state.steps[a.payload] = 'compensated'; state.log.push(`undo ${a.payload}: done`);
    },
    compensationFailed(state, a: PayloadAction<StepName>) {
      state.steps[a.payload] = 'comp_failed'; state.phase = 'stuck';
      state.log.push(`undo ${a.payload}: FAILED - needs manual attention`);
    },
    checkoutSucceeded(state) { state.phase = 'success'; state.log.push('checkout complete'); },
    checkoutRolledBack(state, a: PayloadAction<{ cancelled: boolean }>) {
      state.phase = a.payload.cancelled ? 'cancelled' : 'rolledBack';
      state.log.push(a.payload.cancelled ? 'cancelled and rolled back' : 'rolled back');
    },
  },
});

export const checkoutActions = slice.actions;
export default slice.reducer;

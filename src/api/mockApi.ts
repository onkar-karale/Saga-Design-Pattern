// A fake backend whose failures you control. Every call takes ~300-600ms.

export type Reservation = { id: string };
export type Payment = { id: string };
export type Order = { id: string };

type ApiName = 'reserveStock' | 'releaseStock' | 'charge' | 'refund' | 'createOrder';

const failureRate: Record<ApiName, number> = {
  reserveStock: 0, releaseStock: 0, charge: 0, refund: 0, createOrder: 0,
};
export const setFailureRate = (name: ApiName, p: number) => { failureRate[name] = p; };
export const resetFailures = () => {
  (Object.keys(failureRate) as ApiName[]).forEach((k) => (failureRate[k] = 0));
};

export const timing = { minMs: 300, maxMs: 600 };
export const ledger: string[] = []; // what the "server" believes happened (great for tests)

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function simulate(name: ApiName) {
  await wait(timing.minMs + Math.random() * (timing.maxMs - timing.minMs));
  if (Math.random() < failureRate[name]) throw new Error(`${name} failed`);
}
let n = 0;
const id = (p: string) => `${p}_${++n}`;
const seenKeys = new Map<string, Payment>(); // idempotency: same key => same payment

export const api = {
  async reserveStock(cartId: string): Promise<Reservation> {
    await simulate('reserveStock'); ledger.push(`reserved:${cartId}`);
    return { id: id('res') };
  },
  async releaseStock(reservationId: string): Promise<void> {
    await simulate('releaseStock'); ledger.push(`released:${reservationId}`);
  },
  async charge(cartId: string, idempotencyKey: string): Promise<Payment> {
    const existing = seenKeys.get(idempotencyKey);
    if (existing) return existing;               // retry-safe!
    await simulate('charge');
    const p = { id: id('pay') };
    seenKeys.set(idempotencyKey, p); ledger.push(`charged:${p.id}`);
    return p;
  },
  async refund(paymentId: string): Promise<void> {
    await simulate('refund'); ledger.push(`refunded:${paymentId}`);
  },
  async createOrder(input: { cartId: string; paymentId: string }): Promise<Order> {
    await simulate('createOrder'); ledger.push(`order:${input.cartId}`);
    return { id: id('ord') };
  },
};

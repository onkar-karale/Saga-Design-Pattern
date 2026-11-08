import { setFailureRate } from "../api/mockApi";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import {
  checkoutActions,
  type Phase,
  type StepName,
  type StepStatus,
} from "../features/checkout/checkoutSlice";
// @ts-ignore CSS side-effect imports are handled by the bundler.
import "./Checkout.css";

const STEPS: {
  name: StepName;
  title: string;
  desc: string;
  idKey: "reservationId" | "paymentId" | "orderId";
}[] = [
  {
    name: "reserveStock",
    title: "Reserve stock",
    desc: "Hold the items so nobody else can buy them",
    idKey: "reservationId",
  },
  {
    name: "chargeCard",
    title: "Charge card",
    desc: "Take payment (safe to retry: idempotency key)",
    idKey: "paymentId",
  },
  {
    name: "createOrder",
    title: "Create order",
    desc: "Record the order in the system",
    idKey: "orderId",
  },
];

const LABEL: Record<StepStatus, string> = {
  pending: "Waiting",
  running: "Running",
  done: "Done",
  failed: "Failed",
  compensating: "Undoing",
  compensated: "Undone",
  comp_failed: "Undo failed",
};

const PHASE_TEXT: Record<Phase, string> = {
  idle: "Ready",
  running: "Running",
  compensating: "Compensating",
  success: "Success",
  rolledBack: "Rolled back",
  cancelled: "Cancelled",
  stuck: "Stuck",
};

const FAILURES = [
  {
    key: "charge",
    title: "Card charge fails",
    hint: "Retries 3 times, then rolls back stock",
  },
  {
    key: "createOrder",
    title: "Order creation fails",
    hint: "Refund first, then release stock",
  },
  {
    key: "refund",
    title: "Refund fails",
    hint: "Undo cannot finish: the saga gets stuck",
  },
] as const;

const CART = [
  { name: "Mechanical keyboard", price: 89 },
  { name: "USB-C hub", price: 39 },
  { name: "Desk mat", price: 19 },
];

function icon(status: StepStatus, index: number) {
  switch (status) {
    case "running":
      return <div className="spinner" />;
    case "done":
      return "✓";
    case "failed":
      return "✕";
    case "compensating":
      return <div className="spinner" />;
    case "compensated":
      return "↩";
    case "comp_failed":
      return "!";
    default:
      return index + 1;
  }
}

function logClass(line: string) {
  if (line.includes("FAILED")) return "l-bad";
  if (line.startsWith("undo")) return "l-undo";
  if (line.includes("done") || line.includes("complete")) return "l-ok";
  return "l-info";
}

export function CheckoutLab() {
  const dispatch = useAppDispatch();
  const { phase, steps, ids, log, error } = useAppSelector((s) => s.checkout);
  const busy = phase === "running" || phase === "compensating";
  const finished = ["success", "rolledBack", "cancelled", "stuck"].includes(
    phase,
  );
  const chargeStarted = steps.chargeCard !== "pending";
  const total = CART.reduce((sum, i) => sum + i.price, 0);

  return (
    <div className="lab">
      <header className="lab-head">
        <div>
          <h1>Checkout Saga Lab</h1>
          <p>
            Break the backend on purpose and watch the saga clean up after
            itself.
          </p>
        </div>
        <span className={`badge ${phase}`}>
          <span className="dot" />
          {PHASE_TEXT[phase]}
        </span>
      </header>

      <div className="grid">
        <div className="stack">
          <section className="card">
            <h2>Your order</h2>
            {CART.map((i) => (
              <div className="order-row" key={i.name}>
                <span>{i.name}</span>
                <span>${i.price}</span>
              </div>
            ))}
            <div className="order-total">
              <span>Total</span>
              <span>${total}</span>
            </div>
            <div className="actions">
              {finished ? (
                <button
                  className="btn primary"
                  onClick={() => window.location.reload()}
                >
                  Start over
                </button>
              ) : (
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() =>
                    dispatch(
                      checkoutActions.checkoutRequested({ cartId: "cart-1" }),
                    )
                  }
                >
                  {busy ? "Processing…" : "Pay now"}
                </button>
              )}
              <button
                className="btn ghost"
                disabled={phase !== "running" || chargeStarted}
                onClick={() => dispatch(checkoutActions.cancelRequested())}
              >
                Cancel
              </button>
            </div>
            <p className="hint">
              Cancel locks once the card charge starts: money may already have
              moved (semantic lock).
            </p>
          </section>

          <section className="card">
            <h2>Failure injection</h2>
            {FAILURES.map((f) => (
              <label className="switch" key={f.key}>
                <span>
                  <b>{f.title}</b>
                  <small>{f.hint}</small>
                </span>
                <input
                  type="checkbox"
                  onChange={(e) =>
                    setFailureRate(f.key, e.target.checked ? 1 : 0)
                  }
                />
                <span className="track" />
              </label>
            ))}
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <h2>Saga timeline</h2>

            {phase === "idle" && (
              <div className="banner info">
                <b>Ready when you are</b>Press Pay now, or flip a failure switch
                first.
              </div>
            )}
            {phase === "compensating" && (
              <div className="banner compensating">
                <b>Undoing completed steps…</b>Newest step first. Please keep
                this page open.
              </div>
            )}
            {phase === "success" && (
              <div className="banner success">
                <b>Order confirmed 🎉</b>All three steps succeeded.
                {ids.orderId ? ` Order ${ids.orderId}.` : ""}
              </div>
            )}
            {phase === "rolledBack" && (
              <div className="banner rolledBack">
                <b>Checkout failed, and everything was undone</b>
                {error ? `${error}. ` : ""}Nothing was charged and stock was
                released.
              </div>
            )}
            {phase === "cancelled" && (
              <div className="banner cancelled">
                <b>Checkout cancelled</b>Completed steps were rolled back.
              </div>
            )}
            {phase === "stuck" && (
              <div className="banner stuck">
                <b>We could not finish undoing</b>A compensation failed after
                retries. In production this raises an incident for a human or a
                reconciliation job.
              </div>
            )}

            <ol className="timeline">
              {STEPS.map((s, i) => {
                const st = steps[s.name];
                const id = ids[s.idKey];
                return (
                  <li key={s.name} className={`step ${st}`}>
                    <div className="icon">{icon(st, i)}</div>
                    <div>
                      <div className="step-title">{s.title}</div>
                      <div className="step-desc">{s.desc}</div>
                      {id && <div className="step-id">{id}</div>}
                    </div>
                    <span className="chip">{LABEL[st]}</span>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="card">
            <h2>Live event log</h2>
            <div className="log">
              {log.length === 0 && (
                <span className="empty">
                  Nothing yet. Events appear here as the saga runs.
                </span>
              )}
              {log.map((line, i) => (
                <div key={i} className={logClass(line)}>
                  <span className="n">{String(i + 1).padStart(2, "0")}</span>
                  {line}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

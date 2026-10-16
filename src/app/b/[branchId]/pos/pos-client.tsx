"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { submitOrder } from "@/app/actions/orders";
import { localName, secondaryName } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { formatSen } from "@/lib/money";
import { newUuid } from "@/lib/uuid";
import type { PosCatalog, PosProduct } from "@/server/domain";
import { emptyPayment, evaluatePayment, type PaymentDraft } from "./payment-logic";
import { PaymentPanel, type DisplayLine } from "./payment-panel";

interface CartLine {
  product: PosProduct;
  quantity: number;
  note: string;
}

const TAKEAWAY = "__takeaway__";
const TABLES = Array.from({ length: 12 }, (_, i) => String(i + 1));

export function PosClient({ branchId, catalog }: { branchId: string; catalog: PosCatalog }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [table, setTable] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentDraft>(emptyPayment);
  // Pay later: the order goes to the kitchen unpaid and is collected on the orders board.
  const [payLater, setPayLater] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // One key per submission attempt: reused on retry/double-tap, discarded once the cart
  // changes or the order succeeds. The server deducts stock at most once per key.
  const idempotencyKey = useRef<string | null>(null);

  const visibleProducts = catalog.products.filter((p) => !categoryId || p.categoryId === categoryId);
  const total = useMemo(() => cart.reduce((sum, l) => sum + l.product.priceSen * l.quantity, 0), [cart]);
  const itemCount = cart.reduce((sum, l) => sum + l.quantity, 0);

  // One payer normally; several when the bill is split (evenly or by item).
  const paymentLines: DisplayLine[] = cart.map((l) => ({
    productId: l.product.productId,
    priceSen: l.product.priceSen,
    quantity: l.quantity,
    name: localName(locale, l.product),
    secondaryName: secondaryName(locale, l.product),
  }));
  const paymentState = evaluatePayment(payment, paymentLines);
  const paymentMissing = !payLater && paymentState.methodMissing;
  const cashShort = !payLater && paymentState.payers.some((p) => p.short);
  const unassigned = payLater ? 0 : paymentState.unassigned;
  const paymentBlocked = !payLater && paymentState.blocked;

  function changePayLater(next: boolean) {
    idempotencyKey.current = null;
    setPayLater(next);
  }

  function changePayment(next: PaymentDraft) {
    idempotencyKey.current = null;
    setPayment(next);
  }

  function updateCart(next: (lines: CartLine[]) => CartLine[]) {
    idempotencyKey.current = null;
    setMessage(null);
    setCart((lines) => next(lines).filter((l) => l.quantity > 0));
  }

  const changeQty = (product: PosProduct, delta: number) =>
    updateCart((lines) =>
      lines.some((l) => l.product.productId === product.productId)
        ? lines.map((l) => (l.product.productId === product.productId ? { ...l, quantity: Math.min(99, l.quantity + delta) } : l))
        : delta > 0
          ? [...lines, { product, quantity: delta, note: "" }]
          : lines,
    );

  const setNote = (productId: string, note: string) =>
    updateCart((lines) => lines.map((l) => (l.product.productId === productId ? { ...l, note } : l)));

  function submit() {
    if (!table || cart.length === 0 || pending || paymentBlocked) return;
    idempotencyKey.current ??= newUuid();
    const key = idempotencyKey.current;
    startTransition(async () => {
      const result = await submitOrder({
        idempotencyKey: key,
        branchId,
        tableNumber: table === TAKEAWAY ? null : table,
        payments: payLater ? [] : paymentState.payload,
        items: cart.map((l) => ({
          productId: l.product.productId,
          quantity: l.quantity,
          specialInstructions: l.note.trim() || null,
        })),
      }).catch(() => ({ ok: false as const, error: t.pos.networkError }));

      if (result.ok) {
        idempotencyKey.current = null;
        setCart([]);
        setTable(null);
        setPayment(emptyPayment());
        setPayLater(false);
        setOpenNote(null);
        // The orders board confirms the saved order and shows any change to give.
        router.push(`/b/${branchId}/orders?placed=${result.data.id}`);
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    });
  }

  return (
    <div className="grid gap-4 pb-24 lg:grid-cols-[1fr_380px] lg:pb-0">
      <section>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0">
          {[{ id: null, name: t.pos.all, nameZh: null }, ...catalog.categories].map((c) => (
            <button
              key={c.id ?? "all"}
              onClick={() => setCategoryId(c.id)}
              className={`whitespace-nowrap rounded-full px-5 py-2.5 font-semibold ${
                categoryId === c.id ? "bg-[var(--foreground)] text-white" : "bg-white border border-[var(--border)]"
              }`}
            >
              {localName(locale, c)}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {visibleProducts.map((p) => {
            const out = p.estimatedServings === 0;
            const inCart = cart.find((l) => l.product.productId === p.productId)?.quantity ?? 0;
            return (
              <button
                key={p.productId}
                disabled={out}
                onClick={() => changeQty(p, 1)}
                className={`relative flex flex-col overflow-hidden rounded-2xl border bg-white text-left shadow-sm active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
                  inCart ? "border-[var(--primary)] ring-2 ring-[var(--primary)]/30" : "border-[var(--border)]"
                }`}
              >
                {inCart > 0 && (
                  <span className="absolute right-2 top-2 z-10 flex h-7 min-w-7 items-center justify-center rounded-full bg-[var(--primary)] px-2 text-sm font-bold text-white shadow">
                    {inCart}
                  </span>
                )}
                {p.imageUrl && (
                  // Photos are already resized to ≤800px on upload, so next/image optimisation isn't needed.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" loading="lazy" className="aspect-[4/3] w-full bg-slate-100 object-cover" />
                )}
                <span className={`flex flex-1 flex-col justify-between p-3 sm:p-4 ${p.imageUrl ? "" : "min-h-28"}`}>
                  <span className={p.imageUrl ? "" : "pr-8"}>
                    <span className="block text-base font-semibold leading-tight sm:text-lg">{localName(locale, p)}</span>
                    {secondaryName(locale, p) && (
                      <span className="block text-sm text-[var(--muted)]">{secondaryName(locale, p)}</span>
                    )}
                  </span>
                  <span className="mt-2 flex flex-wrap items-end justify-between gap-1">
                    <span className="text-lg font-bold">{formatSen(p.priceSen)}</span>
                    {p.estimatedServings !== null && (
                      <span
                        title={p.limitingIngredient ? t.pos.limitedBy(p.limitingIngredient) : undefined}
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          out
                            ? "bg-red-100 text-red-800"
                            : p.lowStock
                              ? "bg-amber-100 text-amber-900"
                              : "bg-emerald-50 text-emerald-800"
                        }`}
                      >
                        {out ? t.pos.outOfStock : t.pos.servingsLeft(p.estimatedServings)}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">{t.pos.estimateHint}</p>
      </section>

      <aside id="cart" className="flex flex-col rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{t.pos.currentOrder}</h2>
          {cart.length > 0 && (
            <button onClick={() => updateCart(() => [])} className="text-sm text-[var(--muted)] underline">
              {t.pos.clear}
            </button>
          )}
        </div>

        <div className="mt-3">
          <p className="mb-2 text-sm font-semibold text-[var(--muted)]">{t.pos.table}</p>
          <div className="grid grid-cols-6 gap-1.5">
            {TABLES.map((n) => (
              <button
                key={n}
                onClick={() => setTable(n)}
                className={`rounded-lg py-2 font-semibold ${table === n ? "bg-[var(--primary)] text-white" : "bg-slate-100"}`}
              >
                {n}
              </button>
            ))}
          </div>
          <button
            onClick={() => setTable(TAKEAWAY)}
            className={`mt-1.5 w-full rounded-lg py-2 font-semibold ${table === TAKEAWAY ? "bg-[var(--primary)] text-white" : "bg-slate-100"}`}
          >
            {t.pos.takeaway}
          </button>
        </div>

        <div className="mt-4 flex-1 space-y-2 overflow-y-auto">
          {cart.length === 0 && <p className="py-6 text-center text-[var(--muted)]">{t.pos.empty}</p>}
          {cart.map((l) => (
            <div key={l.product.productId} className="rounded-xl bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{localName(locale, l.product)}</p>
                  {secondaryName(locale, l.product) && (
                    <p className="truncate text-sm text-[var(--muted)]">{secondaryName(locale, l.product)}</p>
                  )}
                  <p className="text-sm text-[var(--muted)]">{formatSen(l.product.priceSen * l.quantity)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button aria-label={t.pos.decrease} onClick={() => changeQty(l.product, -1)} className="h-10 w-10 rounded-lg bg-white text-xl font-bold shadow-sm">
                    −
                  </button>
                  <span className="w-8 text-center text-lg font-bold">{l.quantity}</span>
                  <button aria-label={t.pos.increase} onClick={() => changeQty(l.product, 1)} className="h-10 w-10 rounded-lg bg-white text-xl font-bold shadow-sm">
                    +
                  </button>
                </div>
              </div>
              {openNote === l.product.productId || l.note ? (
                <input
                  autoFocus={openNote === l.product.productId}
                  value={l.note}
                  maxLength={200}
                  placeholder={t.pos.notePlaceholder}
                  onChange={(e) => setNote(l.product.productId, e.target.value)}
                  className="mt-2 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm"
                />
              ) : (
                <button onClick={() => setOpenNote(l.product.productId)} className="mt-1 text-sm text-[var(--primary)]">
                  + {t.pos.note}
                </button>
              )}
            </div>
          ))}
        </div>

        {message && (
          <p
            role="status"
            className={`mt-3 rounded-xl p-3 text-sm font-medium ${
              message.kind === "success" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"
            }`}
          >
            {message.text}
          </p>
        )}

        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <div className="flex items-baseline justify-between">
            <span className="font-semibold">{t.pos.total}</span>
            <span className="text-2xl font-bold">{formatSen(total)}</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            {[false, true].map((later) => (
              <button
                key={String(later)}
                type="button"
                aria-pressed={payLater === later}
                onClick={() => changePayLater(later)}
                className={`rounded-lg py-2.5 font-semibold ${payLater === later ? "bg-white shadow-sm" : "text-[var(--muted)]"}`}
              >
                {later ? t.pos.payLater : t.pos.payNow}
              </button>
            ))}
          </div>
          {payLater ? (
            <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900">{t.pos.payLaterHint}</p>
          ) : (
            <PaymentPanel draft={payment} lines={paymentLines} onChange={changePayment} />
          )}
          <button
            onClick={submit}
            disabled={!table || cart.length === 0 || pending || paymentBlocked}
            className="mt-3 w-full rounded-2xl bg-[var(--primary)] py-4 text-lg font-bold text-white disabled:opacity-40"
          >
            {pending
              ? t.pos.submitting
              : cart.length > 0 && !table
                ? t.pos.chooseTable
                : cart.length > 0 && unassigned > 0
                  ? t.pos.unassigned(unassigned)
                  : cart.length > 0 && paymentMissing
                    ? t.pos.choosePayment
                    : cashShort
                      ? t.pos.notEnoughCash
                      : t.pos.submit}
          </button>
        </div>
      </aside>

      {/* Mobile shortcut to the cart. */}
      {itemCount > 0 && (
        <a
          href="#cart"
          className="fixed inset-x-4 bottom-4 z-30 flex items-center justify-between rounded-2xl bg-[var(--foreground)] px-5 py-4 font-bold text-white shadow-lg lg:hidden"
        >
          <span>
            {t.pos.viewOrder} ({itemCount})
          </span>
          <span>{formatSen(total)}</span>
        </a>
      )}
    </div>
  );
}

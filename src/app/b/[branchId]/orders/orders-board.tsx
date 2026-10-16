"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { advanceOrder, cancelOrder, collectPayment } from "@/app/actions/orders";
import { localName, secondaryName, type Dictionary } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { formatTime } from "@/lib/dates";
import { formatSen } from "@/lib/money";
import type { Order, OrderStatus, PaymentMethod } from "@/server/domain";
import { emptyPayment, evaluatePayment, type PaymentDraft } from "../pos/payment-logic";
import { PaymentPanel, type DisplayLine } from "../pos/payment-panel";

const COLUMNS: { status: Exclude<OrderStatus, "CANCELLED">; accent: string }[] = [
  { status: "NEW", accent: "border-t-sky-500" },
  { status: "PREPARING", accent: "border-t-amber-500" },
  { status: "READY", accent: "border-t-emerald-600" },
];

const NEXT: Partial<Record<OrderStatus, { status: "PREPARING" | "READY"; label: "startPreparing" | "markReady" }>> = {
  NEW: { status: "PREPARING", label: "startPreparing" },
  PREPARING: { status: "READY", label: "markReady" },
};

const itemName = (locale: "en" | "zh", item: Order["items"][number]) =>
  localName(locale, { name: item.productNameSnapshot, nameZh: item.productNameZhSnapshot });

interface BoardProps {
  branchId: string;
  orders: Order[];
  timezone: string;
  canCancelStarted: boolean;
  /** Order just placed from the POS, confirmed with a banner and highlighted. */
  placedOrderId: string | null;
}

export function OrdersBoard({ branchId, orders, timezone, canCancelStarted, placedOrderId }: BoardProps) {
  const { t, locale } = useI18n();
  const placed = orders.find((o) => o.id === placedOrderId) ?? null;
  const [tab, setTab] = useState<OrderStatus>(placed?.status ?? "NEW");
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const cancelled = orders.filter((o) => o.status === "CANCELLED");
  const unpaidCount = orders.filter(isUnpaid).length;
  const shown = unpaidOnly ? orders.filter(isUnpaid) : orders;

  return (
    <>
      {placed && <PlacedBanner order={placed} branchId={branchId} />}

      {(unpaidCount > 0 || unpaidOnly) && (
        <button
          type="button"
          aria-pressed={unpaidOnly}
          onClick={() => setUnpaidOnly(!unpaidOnly)}
          className={`mb-3 rounded-full px-4 py-2 font-semibold ${
            unpaidOnly ? "bg-red-600 text-white" : "border border-red-200 bg-white text-red-700"
          }`}
        >
          {t.orders.unpaidOnly(unpaidCount)}
        </button>
      )}

      {/* Phones: one column at a time. */}
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1 md:hidden">
        {COLUMNS.map(({ status }) => (
          <button
            key={status}
            onClick={() => setTab(status)}
            className={`rounded-xl py-2.5 font-semibold ${tab === status ? "bg-white shadow-sm" : ""}`}
          >
            {t.status[status]} ({shown.filter((o) => o.status === status).length})
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map(({ status, accent }) => {
          // Oldest first so the kitchen works in order.
          const list = shown.filter((o) => o.status === status).reverse();
          return (
            <section key={status} className={`${tab === status ? "" : "hidden"} md:block`}>
              <h2 className="mb-2 hidden text-lg font-bold md:block">
                {t.status[status]} <span className="text-[var(--muted)]">({list.length})</span>
              </h2>
              <div className="space-y-3">
                {list.length === 0 && (
                  <p className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-[var(--muted)]">
                    {t.orders.noOrders}
                  </p>
                )}
                {list.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    branchId={branchId}
                    timezone={timezone}
                    accent={accent}
                    canCancel={order.status === "NEW" || canCancelStarted}
                    highlighted={order.id === placed?.id}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {cancelled.length > 0 && (
        <details className="mt-6 rounded-2xl border border-[var(--border)] bg-white p-4">
          <summary className="cursor-pointer font-semibold">
            {t.orders.cancelledToday} ({cancelled.length})
          </summary>
          <ul className="mt-3 space-y-2 text-sm">
            {cancelled.map((o) => (
              <li key={o.id} className="flex flex-wrap justify-between gap-2 border-t border-[var(--border)] pt-2">
                <span>
                  #{o.orderNumber} · {o.tableNumber ? `${t.pos.table} ${o.tableNumber}` : t.pos.takeaway} ·{" "}
                  {o.items.map((i) => `${i.quantity}× ${itemName(locale, i)}`).join(", ")}
                </span>
                <span className="text-[var(--muted)]">
                  {formatSen(o.totalSen)} · {paymentSummary(t, o)} · {o.cancelReason}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function OrderCard({
  order,
  branchId,
  timezone,
  accent,
  canCancel,
  highlighted,
}: {
  order: Order;
  branchId: string;
  timezone: string;
  accent: string;
  canCancel: boolean;
  highlighted: boolean;
}) {
  const { t, locale } = useI18n();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [collecting, setCollecting] = useState(false);
  const next = NEXT[order.status];

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await fn();
      setError(result.ok ? null : (result.error ?? t.orders.failed));
    });

  return (
    <article
      className={`rounded-2xl border border-t-4 border-[var(--border)] bg-white p-4 shadow-sm ${accent} ${
        highlighted ? "ring-4 ring-emerald-400" : ""
      }`}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-bold">#{order.orderNumber}</span>
        <span className="text-lg font-semibold">
          {order.tableNumber ? `${t.pos.table} ${order.tableNumber}` : t.pos.takeaway}
        </span>
      </div>
      <p className="text-xs text-[var(--muted)]">
        {formatTime(order.createdAt, timezone)} · {order.createdByName}
      </p>
      <ul className="mt-3 space-y-1.5">
        {order.items.map((item, idx) => (
          <li key={idx}>
            <span className="font-semibold">
              {item.quantity}× {itemName(locale, item)}
            </span>
            {secondaryName(locale, { name: item.productNameSnapshot, nameZh: item.productNameZhSnapshot }) && (
              <span className="ml-1.5 text-sm text-[var(--muted)]">
                {secondaryName(locale, { name: item.productNameSnapshot, nameZh: item.productNameZhSnapshot })}
              </span>
            )}
            {item.specialInstructions && (
              <span className="block text-sm font-medium text-amber-800">↳ {item.specialInstructions}</span>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-3">
        {isUnpaid(order) ? (
          <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-bold text-red-800">{t.orders.unpaid}</span>
        ) : order.payments.length > 1 ? (
          <span className="rounded-full bg-slate-800 px-3 py-1 text-sm font-semibold text-white">
            {t.orders.split(order.payments.length)}
          </span>
        ) : (
          <PaymentBadge method={order.payments[0].method} />
        )}
        <span className="text-xl font-bold tabular-nums">{formatSen(order.totalSen)}</span>
      </div>
      {order.payments.length > 1 ? (
        <ul className="mt-2 space-y-1 text-sm">
          {order.payments.map((p, i) => (
            <li key={i} className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-[var(--muted)]">{t.pos.person(i + 1)}</span>
                  <PaymentBadge method={p.method} small />
                </span>
                {p.allocations && (
                  <span className="block truncate text-xs text-[var(--muted)]">
                    {p.allocations.map((a) => `${itemName(locale, order.items[a.lineIndex])} ×${a.quantity}`).join(", ")}
                  </span>
                )}
              </span>
              <span className="text-right tabular-nums">
                {formatSen(p.amountSen)}
                {p.cashReceivedSen !== null && (
                  <span className="block text-xs text-[var(--muted)]">
                    {t.orders.received} {formatSen(p.cashReceivedSen)} · {t.pos.change} {formatSen(p.changeSen ?? 0)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        order.payments[0]?.cashReceivedSen != null && (
          <p className="mt-1 text-right text-sm text-[var(--muted)] tabular-nums">
            {t.orders.received} {formatSen(order.payments[0].cashReceivedSen)} · {t.pos.change}{" "}
            {formatSen(order.payments[0].changeSen ?? 0)}
          </p>
        )
      )}

      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">{error}</p>}

      {isUnpaid(order) && !cancelling && (
        <button
          onClick={() => setCollecting(true)}
          className="mt-3 w-full rounded-xl bg-red-600 py-3 text-lg font-bold text-white"
        >
          {t.orders.collect} {formatSen(order.totalSen)}
        </button>
      )}
      {collecting && <CollectSheet order={order} branchId={branchId} onClose={() => setCollecting(false)} />}

      {cancelling ? (
        <div className="mt-3 space-y-2">
          <input
            autoFocus
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t.orders.cancelReason}
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2"
          />
          <p className="text-xs text-[var(--muted)]">{t.orders.stockNotRestored}</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setCancelling(false)} className="rounded-xl bg-slate-100 py-3 font-semibold">
              {t.orders.keep}
            </button>
            <button
              disabled={pending || !reason.trim()}
              onClick={() => run(() => cancelOrder(branchId, order.id, reason))}
              className="rounded-xl bg-red-600 py-3 font-semibold text-white disabled:opacity-40"
            >
              {t.orders.confirmCancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          {next && (
            <button
              disabled={pending}
              onClick={() => run(() => advanceOrder(branchId, order.id, next.status))}
              className="flex-1 rounded-xl bg-[var(--primary)] py-3 font-semibold text-white disabled:opacity-50"
            >
              {t.orders[next.label]}
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => setCancelling(true)}
              className={`rounded-xl px-4 py-3 text-sm font-semibold text-red-700 hover:bg-red-50 ${next ? "" : "flex-1 border border-red-200"}`}
            >
              {t.orders.cancel}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/** Confirms the order is saved (it is read back from the server) and repeats the change to give. */
function PlacedBanner({ order, branchId }: { order: Order; branchId: string }) {
  const { t } = useI18n();
  const split = order.payments.length > 1;
  const changes = order.payments.flatMap((p, i) =>
    p.changeSen ? [split ? t.pos.personChange(i + 1, formatSen(p.changeSen)) : t.pos.giveChange(formatSen(p.changeSen))] : [],
  );
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-emerald-50 p-4 text-emerald-900">
      <div>
        <p className="text-lg font-bold">{t.pos.sent(order.orderNumber)}</p>
        {isUnpaid(order) && <p className="font-bold text-red-700">{t.orders.collectAfterServing}</p>}
        {changes.map((c) => (
          <p key={c} className="text-xl font-bold tabular-nums">
            {c}
          </p>
        ))}
      </div>
      <Link href={`/b/${branchId}/pos`} className="rounded-xl bg-[var(--primary)] px-5 py-3 font-bold text-white">
        {t.orders.newOrder}
      </Link>
    </div>
  );
}

const isUnpaid = (order: Order) => order.paidAt === null && order.status !== "CANCELLED";

/** Takes payment for a pay-later order with the same panel as the POS (split, cash change). */
function CollectSheet({ order, branchId, onClose }: { order: Order; branchId: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState<PaymentDraft>(emptyPayment);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Line indexes match order.items, which is what the server's allocations refer to.
  const lines: DisplayLine[] = order.items.map((item) => ({
    productId: item.productId,
    priceSen: item.unitPriceSnapshotSen,
    quantity: item.quantity,
    name: itemName(locale, item),
    secondaryName: secondaryName(locale, { name: item.productNameSnapshot, nameZh: item.productNameZhSnapshot }),
  }));
  const state = evaluatePayment(draft, lines);

  const confirm = () =>
    startTransition(async () => {
      const result = await collectPayment(branchId, order.id, state.payload).catch(() => ({
        ok: false as const,
        error: t.pos.networkError,
      }));
      if (result.ok) onClose();
      else setError(result.error ?? t.orders.failed);
    });

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 sm:max-w-md sm:rounded-2xl"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-bold">
            {t.orders.collect} #{order.orderNumber}
          </h2>
          <span className="text-2xl font-bold tabular-nums">{formatSen(order.totalSen)}</span>
        </div>
        <PaymentPanel draft={draft} lines={lines} onChange={setDraft} />
        {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">{error}</p>}
        <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
          <button onClick={onClose} className="rounded-xl bg-slate-100 px-5 py-4 font-semibold">
            {t.orders.close}
          </button>
          <button
            disabled={pending || state.blocked}
            onClick={confirm}
            className="rounded-xl bg-[var(--primary)] py-4 text-lg font-bold text-white disabled:opacity-40"
          >
            {state.unassigned > 0
              ? t.pos.unassigned(state.unassigned)
              : state.methodMissing
                ? t.pos.choosePayment
                : t.orders.confirmCollect(formatSen(order.totalSen))}
          </button>
        </div>
      </div>
    </div>
  );
}

function paymentSummary(t: Dictionary, order: Order): string {
  if (order.payments.length === 0) return t.orders.unpaid;
  return order.payments.length > 1
    ? `${t.orders.split(order.payments.length)} (${order.payments.map((p) => t.paymentMethod[p.method]).join(", ")})`
    : t.paymentMethod[order.payments[0].method];
}

function PaymentBadge({ method, small = false }: { method: PaymentMethod; small?: boolean }) {
  const { t } = useI18n();
  return (
    <span
      className={`rounded-full font-semibold ${small ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"} ${
        method === "QR" ? "bg-violet-100 text-violet-900" : "bg-emerald-100 text-emerald-900"
      }`}
    >
      {t.paymentMethod[method]}
    </span>
  );
}

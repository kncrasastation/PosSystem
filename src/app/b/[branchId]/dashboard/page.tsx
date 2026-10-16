import Link from "next/link";
import { businessDate, isDateString, startOfMonth, startOfWeek } from "@/lib/dates";
import { localName } from "@/i18n";
import { getI18n } from "@/i18n/server";
import { formatSen } from "@/lib/money";
import { PAYMENT_METHODS } from "@/server/domain";
import { repo } from "@/server/repository";
import { requireOwnerPage } from "@/server/session";

const RANGES = ["today", "week", "month"] as const;

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ branchId: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string; scope?: string }>;
}) {
  const { branchId } = await params;
  const sp = await searchParams;
  const { actor, branch } = await requireOwnerPage(branchId);
  const { t, locale } = await getI18n();

  const today = businessDate(new Date(), branch.timezone);
  const custom = isDateString(sp.from) && isDateString(sp.to) && sp.from <= sp.to;
  const range = custom ? "custom" : (RANGES.find((r) => r === sp.range) ?? "today");
  const fromDate = custom ? sp.from! : range === "week" ? startOfWeek(today) : range === "month" ? startOfMonth(today) : today;
  const toDate = custom ? sp.to! : today;
  const allBranches = sp.scope === "all";

  const summary = await repo.salesSummary(actor, { branchId: allBranches ? "ALL" : branchId, fromDate, toDate });
  const query = (extra: Record<string, string>) =>
    `?${new URLSearchParams({ ...(allBranches ? { scope: "all" } : {}), range, ...extra })}`;

  const pill = (active: boolean) =>
    `rounded-full px-4 py-2 font-semibold ${active ? "bg-[var(--foreground)] text-white" : "border border-[var(--border)] bg-white"}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <Link key={r} href={query({ range: r })} className={pill(range === r)}>
            {t.dashboard[r]}
          </Link>
        ))}
        <form className="flex flex-wrap items-center gap-2">
          {allBranches && <input type="hidden" name="scope" value="all" />}
          <input type="date" name="from" defaultValue={fromDate} max={today} className="rounded-xl border border-[var(--border)] bg-white px-3 py-2" />
          <span className="text-[var(--muted)]">{t.dashboard.to}</span>
          <input type="date" name="to" defaultValue={toDate} max={today} className="rounded-xl border border-[var(--border)] bg-white px-3 py-2" />
          <button className={pill(range === "custom")}>{t.dashboard.apply}</button>
        </form>
      </div>

      <div className="flex gap-2">
        <Link href={`?${new URLSearchParams({ range, ...(custom ? { from: fromDate, to: toDate } : {}) })}`} className={pill(!allBranches)}>
          {branch.name}
        </Link>
        <Link href={`?${new URLSearchParams({ range, scope: "all", ...(custom ? { from: fromDate, to: toDate } : {}) })}`} className={pill(allBranches)}>
          {t.dashboard.allBranches}
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label={t.dashboard.orderTotals} value={formatSen(summary.orderTotalSen)} />
        <Tile label={t.dashboard.orders} value={String(summary.orderCount)} />
        <Tile label={t.dashboard.averageOrder} value={formatSen(summary.averageOrderSen)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {PAYMENT_METHODS.map((method) => (
          <Tile
            key={method}
            label={`${t.paymentMethod[method]} · ${t.dashboard.paymentsCount(summary.byPaymentMethod[method].paymentCount)}`}
            value={formatSen(summary.byPaymentMethod[method].totalSen)}
          />
        ))}
        <Tile label={t.dashboard.unpaid(summary.unpaid.orderCount)} value={formatSen(summary.unpaid.totalSen)} />
      </div>
      <p className="text-sm text-[var(--muted)]">
        {fromDate === toDate ? fromDate : `${fromDate} ${t.dashboard.to} ${toDate}`} · {t.dashboard.paymentNote}{" "}
        {t.dashboard.cancelledNote(summary.cancelledCount)}
      </p>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-bold">{t.dashboard.productsSold}</h2>
        {summary.byProduct.length === 0 ? (
          <p className="text-[var(--muted)]">{t.dashboard.noSales}</p>
        ) : (
          <table className="w-full text-left">
            <thead className="text-sm text-[var(--muted)]">
              <tr>
                <th className="py-2 font-medium">{t.dashboard.product}</th>
                <th className="py-2 text-right font-medium">{t.dashboard.qty}</th>
                <th className="py-2 text-right font-medium">{t.dashboard.sales}</th>
              </tr>
            </thead>
            <tbody>
              {summary.byProduct.map((p) => (
                <tr key={p.productId} className="border-t border-[var(--border)]">
                  <td className="py-2.5 font-medium">{localName(locale, p)}</td>
                  <td className="py-2.5 text-right tabular-nums">{p.quantity}</td>
                  <td className="py-2.5 text-right tabular-nums">{formatSen(p.salesSen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm">
      <p className="text-sm text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

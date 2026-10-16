import { AutoRefresh } from "@/components/auto-refresh";
import { getI18n } from "@/i18n/server";
import { businessDate } from "@/lib/dates";
import { repo } from "@/server/repository";
import { requireBranchPage } from "@/server/session";
import { OrdersBoard } from "./orders-board";

export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ branchId: string }>;
  searchParams: Promise<{ date?: string; placed?: string }>;
}) {
  const { branchId } = await params;
  const { date, placed } = await searchParams;
  const { actor, branch } = await requireBranchPage(branchId);
  const { t } = await getI18n();

  const today = businessDate(new Date(), branch.timezone);
  const selectedDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  const orders = await repo.listOrders(actor, branchId, { businessDate: selectedDate });

  return (
    <div>
      {selectedDate === today && <AutoRefresh />}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t.orders.title}</h1>
        <form className="flex items-center gap-2">
          <label htmlFor="date" className="text-sm text-[var(--muted)]">
            {t.orders.date}
          </label>
          <input
            id="date"
            type="date"
            name="date"
            max={today}
            defaultValue={selectedDate}
            className="rounded-xl border border-[var(--border)] bg-white px-3 py-2"
          />
          <button className="rounded-xl bg-slate-100 px-4 py-2 font-semibold">{t.orders.go}</button>
        </form>
      </div>
      <OrdersBoard
        branchId={branchId}
        orders={orders}
        timezone={branch.timezone}
        canCancelStarted={actor.role === "OWNER"}
        placedOrderId={placed ?? null}
      />
    </div>
  );
}

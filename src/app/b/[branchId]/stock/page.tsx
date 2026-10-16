import { getI18n } from "@/i18n/server";
import { formatQuantity } from "@/lib/quantity";
import { repo } from "@/server/repository";
import { requireOwnerPage } from "@/server/session";

export default async function StockPage({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = await params;
  const { actor, branch } = await requireOwnerPage(branchId);
  const rows = await repo.listStock(actor, branchId);
  const { t } = await getI18n();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t.stock.title}</h1>
        <p className="text-sm text-[var(--muted)]">
          {t.stock.intro(branch.name)}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <article
            key={row.ingredient.id}
            className={`rounded-2xl border bg-white p-4 shadow-sm ${row.isLow ? "border-amber-300" : "border-[var(--border)]"}`}
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-bold">{row.ingredient.name}</h2>
              {row.isLow && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">{t.stock.low}</span>}
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums">{formatQuantity(row.quantityOnHand, row.ingredient.baseUnit)}</p>
            <p className="text-xs text-[var(--muted)]">
              {t.stock.lowLevel}: {formatQuantity(row.ingredient.lowStockThreshold, row.ingredient.baseUnit)}
            </p>
            {row.usedBy.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-[var(--border)] pt-2 text-sm">
                {row.usedBy.map((u) => (
                  <li key={u.productName} className="flex justify-between">
                    <span>{u.productName}</span>
                    <span className="tabular-nums text-[var(--muted)]">
                      {formatQuantity(u.quantityPerServing, row.ingredient.baseUnit)} {t.stock.perServing}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

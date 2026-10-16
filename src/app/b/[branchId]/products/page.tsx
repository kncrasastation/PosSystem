import { getI18n } from "@/i18n/server";
import { repo } from "@/server/repository";
import { requireOwnerPage } from "@/server/session";
import { NewProductForm, ProductRow } from "./product-forms";

export default async function ProductsPage({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = await params;
  const { actor, branch } = await requireOwnerPage(branchId);
  const { t } = await getI18n();
  const [categories, rows] = await Promise.all([repo.listCategories(actor), repo.listAdminProducts(actor, branchId)]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t.products.title}</h1>
        <p className="text-sm text-[var(--muted)]">{t.products.intro(branch.name)}</p>
      </div>
      <NewProductForm branchId={branchId} categories={categories.filter((c) => c.isActive)} />
      <div className="space-y-3">
        {rows.map((row) => (
          <ProductRow key={row.product.id} branchId={branchId} row={row} />
        ))}
      </div>
    </div>
  );
}

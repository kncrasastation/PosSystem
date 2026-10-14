const modules = [
  { title: "POS Ordering", description: "Fast product selection, table number, order totals and order submission.", status: "Starter" },
  { title: "Order Management", description: "Track NEW, PREPARING and READY orders across connected devices.", status: "Planned" },
  { title: "Ingredients & Stock", description: "Track grams, millilitres and pieces, purchases, wastage and stock counts.", status: "Planned" },
  { title: "Recipes & Auto Deduction", description: "Deduct ingredients transactionally when an order is confirmed.", status: "Critical rule" },
  { title: "Branches & Staff", description: "Separate stock and orders by branch with backend role enforcement.", status: "Planned" },
  { title: "Sales Reports", description: "Daily, weekly, monthly and branch-level sales summaries.", status: "Planned" },
];

export default function Home() {
  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 border-b border-[var(--border)] pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--primary)]">K&C Rasa Station</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Food Court POS</h1>
          <p className="mt-2 text-[var(--muted)]">Multi-branch sales and ingredient inventory starter</p>
        </div>
        <span className="w-fit rounded-full bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-900">Starter template</span>
      </header>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((module) => (
          <article key={module.title} className="rounded-2xl border border-[var(--border)] bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold">{module.title}</h2>
              <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{module.status}</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{module.description}</p>
          </article>
        ))}
      </section>

      <section className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 sm:p-6">
        <h2 className="text-lg font-bold text-emerald-950">Inventory calculation example</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div><p className="text-sm text-emerald-800">Opening stock</p><p className="mt-1 text-2xl font-bold text-emerald-950">1,200 g</p></div>
          <div><p className="text-sm text-emerald-800">Recipe per serving</p><p className="mt-1 text-2xl font-bold text-emerald-950">120 g</p></div>
          <div><p className="text-sm text-emerald-800">Estimated servings</p><p className="mt-1 text-2xl font-bold text-emerald-950">10 servings</p></div>
        </div>
        <p className="mt-4 text-sm leading-6 text-emerald-900">Target rule: stock deduction happens on the server in the same database transaction as order creation. This page is a UI starter, not yet a live POS.</p>
      </section>

      <footer className="mt-8 text-sm text-[var(--muted)]">
        Next step: configure Supabase, apply the SQL migration, then build features incrementally with Claude Code.
      </footer>
    </main>
  );
}

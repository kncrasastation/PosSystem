import { BranchSwitcher } from "@/components/branch-switcher";
import { NavLinks } from "@/components/nav-links";
import { LanguageToggle } from "@/components/language-toggle";
import { getI18n } from "@/i18n/server";
import { repo } from "@/server/repository";
import { requireBranchPage } from "@/server/session";
import { logout } from "../../actions/session";

export default async function BranchLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ branchId: string }>;
}) {
  const { branchId } = await params;
  const { actor, branch } = await requireBranchPage(branchId);
  const { t } = await getI18n();
  const branches = await repo.listBranches(actor);
  const base = `/b/${branchId}`;
  const links =
    actor.role === "OWNER"
      ? [
          { href: `${base}/dashboard`, label: t.nav.dashboard },
          { href: `${base}/pos`, label: t.nav.pos },
          { href: `${base}/orders`, label: t.nav.orders },
          { href: `${base}/products`, label: t.nav.products },
          { href: `${base}/stock`, label: t.nav.stock },
        ]
      : [
          { href: `${base}/pos`, label: t.nav.pos },
          { href: `${base}/orders`, label: t.nav.orders },
        ];

  return (
    <div className="min-h-screen">
      <div className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900">{t.demoBanner}</div>
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center justify-between gap-3">
            {actor.role === "OWNER" && branches.length > 1 ? (
              <BranchSwitcher branches={branches} current={branchId} />
            ) : (
              <span className="text-lg font-bold">{branch.name}</span>
            )}
            <div className="flex items-center gap-1 lg:hidden">
              <LanguageToggle />
              <form action={logout}>
                <button className="rounded-xl px-3 py-2 text-sm text-[var(--muted)]">
                  {actor.name} · {t.nav.logout}
                </button>
              </form>
            </div>
          </div>
          <NavLinks links={links} />
          <div className="hidden items-center gap-2 lg:flex">
            <LanguageToggle />
            <form action={logout}>
              <button className="rounded-xl px-3 py-2 text-sm text-[var(--muted)] hover:bg-slate-100">
                {actor.name} · {t.nav.logout}
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-4">{children}</div>
    </div>
  );
}

import { LanguageToggle } from "@/components/language-toggle";
import { getI18n } from "@/i18n/server";
import { repo } from "@/server/repository";
import { loginAs } from "../actions/session";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const users = await repo.listLoginUsers();
  const { t } = await getI18n();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{t.appName}</h1>
        <LanguageToggle />
      </div>
      <p className="mt-2 text-[var(--muted)]">{t.login.intro}</p>
      {error && (
        <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {error === "no-branch" ? t.login.noBranch : t.login.failed}
        </p>
      )}
      <div className="mt-6 flex flex-col gap-3">
        {users.map((user) => (
          <form key={user.id} action={loginAs.bind(null, user.id)}>
            <button className="flex w-full items-center justify-between rounded-2xl border border-[var(--border)] bg-white px-5 py-4 text-left shadow-sm active:bg-slate-50">
              <span className="text-lg font-semibold">{user.name}</span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm">{user.role === "OWNER" ? t.login.owner : t.login.staff}</span>
            </button>
          </form>
        ))}
      </div>
    </main>
  );
}

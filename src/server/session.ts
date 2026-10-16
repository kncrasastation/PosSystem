import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isDomainError, type Actor, type Branch } from "./domain";
import { repo } from "./repository";

// DEMO-ONLY session: the signed-in user id is kept in an httpOnly cookie chosen on the
// login page. This is replaced by Supabase Auth when the database is connected.
export const SESSION_COOKIE = "fcpos_demo_user";

export async function getActor(): Promise<Actor | null> {
  const userId = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!userId) return null;
  const user = await repo.getUser(userId);
  if (!user || !user.isActive) return null;
  return { id: user.id, name: user.name, role: user.role };
}

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return actor;
}

/** Landing page for an actor: owners go to the dashboard, staff to their branch POS. */
export async function homePath(actor: Actor): Promise<string> {
  const branches = await repo.listBranches(actor);
  if (branches.length === 0) return "/login?error=no-branch";
  return actor.role === "OWNER" ? `/b/${branches[0].id}/dashboard` : `/b/${branches[0].id}/pos`;
}

/**
 * Page guard: signed-in actor with access to the branch, otherwise redirect home.
 * Layouts and pages render in parallel in the App Router, so every page calls this
 * itself rather than relying on the layout. The repository still enforces access.
 */
export async function requireBranchPage(branchId: string): Promise<{ actor: Actor; branch: Branch }> {
  const actor = await requireActor();
  const branch = await repo.getBranch(actor, branchId).catch((error) => {
    if (isDomainError(error)) return null;
    throw error;
  });
  if (!branch) redirect("/");
  return { actor, branch };
}

/** For owner-only pages: staff are sent back to the POS. */
export async function requireOwnerPage(branchId: string): Promise<{ actor: Actor; branch: Branch }> {
  const result = await requireBranchPage(branchId);
  if (result.actor.role !== "OWNER") redirect(`/b/${branchId}/pos`);
  return result;
}

import { randomUUID } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";

export type Db = pg.Client;

export async function connect(): Promise<Db> {
  const client = new pg.Client({ connectionString: inject("dbUrl") });
  await client.connect();
  return client;
}

/**
 * Runs `fn` on a fresh connection as the Supabase `authenticated` role with the given
 * user's JWT claims, inside a transaction that commits on success.
 */
export async function asUser<T>(userId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await connect();
  try {
    await db.query("begin");
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const result = await fn(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}

export const uniq = (label: string) => `${label}-${randomUUID().slice(0, 8)}`;

export async function createUser(
  admin: Db,
  opts: { role: "OWNER" | "STAFF"; active?: boolean; branches?: string[] },
): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [`${uniq("user")}@example.test`],
  );
  const id = rows[0].id;
  await admin.query("insert into public.profiles (id, name, role, is_active) values ($1, $2, $3, $4)", [
    id,
    uniq(opts.role.toLowerCase()),
    opts.role,
    opts.active ?? true,
  ]);
  for (const branchId of opts.branches ?? []) {
    await admin.query("insert into public.staff_branch_assignments (user_id, branch_id) values ($1, $2)", [
      id,
      branchId,
    ]);
  }
  return id;
}

export async function createBranch(admin: Db, opts: { active?: boolean } = {}): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    "insert into public.branches (name, is_active) values ($1, $2) returning id",
    [uniq("branch"), opts.active ?? true],
  );
  return rows[0].id;
}

/** Postgres SQLSTATE of a rejected promise, e.g. '42501' (insufficient privilege). */
export async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

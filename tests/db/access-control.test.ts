import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, connect, createBranch, createUser, sqlState, uniq, type Db } from "./helpers";

let admin: Db;
let branchA: string;
let branchB: string;
let inactiveBranch: string;
let owner: string;
let staffA: string;
let inactiveStaff: string;
let staffOnInactiveBranch: string;
let noProfileUser: string;

const branchIds = async (db: Db) =>
  (await db.query<{ id: string }>("select id from public.branches")).rows.map((r) => r.id);

beforeAll(async () => {
  admin = await connect();
  branchA = await createBranch(admin);
  branchB = await createBranch(admin);
  inactiveBranch = await createBranch(admin, { active: false });
  owner = await createUser(admin, { role: "OWNER" });
  staffA = await createUser(admin, { role: "STAFF", branches: [branchA] });
  inactiveStaff = await createUser(admin, { role: "STAFF", active: false, branches: [branchA] });
  staffOnInactiveBranch = await createUser(admin, { role: "STAFF", branches: [inactiveBranch] });
  noProfileUser = (
    await admin.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [
      `${uniq("noprofile")}@example.test`,
    ])
  ).rows[0].id;
});

afterAll(async () => {
  await admin.end();
});

describe("branch visibility", () => {
  it("owner sees every branch, including inactive ones", async () => {
    const ids = await asUser(owner, branchIds);
    expect(ids).toEqual(expect.arrayContaining([branchA, branchB, inactiveBranch]));
  });

  it("staff see only their assigned branch", async () => {
    const ids = await asUser(staffA, branchIds);
    expect(ids).toContain(branchA);
    expect(ids).not.toContain(branchB);
    expect(ids).not.toContain(inactiveBranch);
  });

  it("inactive staff, users without a profile, and staff of an inactive branch see nothing", async () => {
    expect(await asUser(inactiveStaff, branchIds)).toEqual([]);
    expect(await asUser(noProfileUser, branchIds)).toEqual([]);
    expect(await asUser(staffOnInactiveBranch, branchIds)).toEqual([]);
  });

  it("anon role cannot read tables at all", async () => {
    const db = await connect();
    try {
      await db.query("begin");
      await db.query("set local role anon");
      expect(await sqlState(db.query("select * from public.branches"))).toBe("42501");
    } finally {
      await db.query("rollback");
      await db.end();
    }
  });
});

describe("branch-scoped data", () => {
  let productId: string;

  beforeAll(async () => {
    productId = (
      await admin.query<{ id: string }>("insert into public.products (name) values ($1) returning id", [
        uniq("product"),
      ])
    ).rows[0].id;
    await admin.query(
      "insert into public.branch_products (branch_id, product_id, price) values ($1, $3, 8.00), ($2, $3, 9.00)",
      [branchA, branchB, productId],
    );
  });

  it("staff only see prices for their branch", async () => {
    const rows = await asUser(staffA, async (db) =>
      (await db.query("select branch_id from public.branch_products where product_id = $1", [productId])).rows,
    );
    expect(rows).toEqual([{ branch_id: branchA }]);
  });

  it("staff cannot see stock movements or audit logs", async () => {
    await admin.query(
      `insert into public.audit_logs (branch_id, actor_user_id, action, entity_type)
       values ($1, $2, 'TEST', 'test')`,
      [branchA, owner],
    );
    const staffCount = await asUser(staffA, async (db) =>
      Number((await db.query("select count(*) from public.audit_logs")).rows[0].count),
    );
    const ownerCount = await asUser(owner, async (db) =>
      Number((await db.query("select count(*) from public.audit_logs")).rows[0].count),
    );
    expect(staffCount).toBe(0);
    expect(ownerCount).toBeGreaterThan(0);
  });
});

describe("write restrictions", () => {
  it("staff cannot change prices", async () => {
    const updated = await asUser(staffA, async (db) =>
      (await db.query("update public.branch_products set price = 0.01 where branch_id = $1", [branchA])).rowCount,
    );
    expect(updated).toBe(0);
  });

  it("staff cannot create products or branches", async () => {
    expect(
      await sqlState(asUser(staffA, (db) => db.query("insert into public.products (name) values ('x')"))),
    ).toBe("42501");
    expect(
      await sqlState(asUser(staffA, (db) => db.query("insert into public.branches (name) values ('x')"))),
    ).toBe("42501");
  });

  it("staff cannot assign themselves to another branch", async () => {
    expect(
      await sqlState(
        asUser(staffA, (db) =>
          db.query("insert into public.staff_branch_assignments (user_id, branch_id) values ($1, $2)", [
            staffA,
            branchB,
          ]),
        ),
      ),
    ).toBe("42501");
  });

  it("staff cannot promote themselves to owner", async () => {
    const updated = await asUser(staffA, async (db) =>
      (await db.query("update public.profiles set role = 'OWNER' where id = $1", [staffA])).rowCount,
    );
    expect(updated).toBe(0);
  });

  it("owner cannot change their own role (prevents losing the last owner)", async () => {
    const updated = await asUser(owner, async (db) =>
      (await db.query("update public.profiles set role = 'STAFF' where id = $1", [owner])).rowCount,
    );
    expect(updated).toBe(0);
  });

  it("nobody can write orders or stock directly, not even the owner", async () => {
    for (const sql of [
      `insert into public.orders (idempotency_key, order_number, branch_id, created_by, subtotal, total_amount)
       values (gen_random_uuid(), 'X1', '${branchA}', '${owner}', 0, 0)`,
      "update public.ingredient_stock_balances set quantity_on_hand = 999",
      `insert into public.stock_movements (branch_id, ingredient_id, movement_type, quantity_delta)
       values ('${branchA}', gen_random_uuid(), 'MANUAL_ADJUSTMENT', 1)`,
    ]) {
      expect(await sqlState(asUser(owner, (db) => db.query(sql)))).toBe("42501");
    }
  });

  it("owner can create products and set branch prices", async () => {
    await asUser(owner, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        "insert into public.products (name) values ($1) returning id",
        [uniq("owner-product")],
      );
      await db.query("insert into public.branch_products (branch_id, product_id, price) values ($1, $2, 10.00)", [
        branchB,
        rows[0].id,
      ]);
    });
  });
});

describe("owner bootstrap", () => {
  it("is not callable by app users", async () => {
    expect(
      await sqlState(asUser(owner, (db) => db.query("select app.bootstrap_owner('a@b.c', 'x')"))),
    ).toBe("42501");
  });

  it("refuses to create a second owner", async () => {
    const email = `${uniq("second")}@example.test`;
    await admin.query("insert into auth.users (email) values ($1)", [email]);
    await expect(admin.query("select app.bootstrap_owner($1, 'Second')", [email])).rejects.toThrow(
      /owner already exists/,
    );
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, connect, createBranch, createUser, type Db } from "./helpers";

let admin: Db;
let branchA: string;
let staffA: string;
let staffB: string;

beforeAll(async () => {
  admin = await connect();
  branchA = await createBranch(admin);
  const branchB = await createBranch(admin);
  staffA = await createUser(admin, { role: "STAFF", branches: [branchA] });
  staffB = await createUser(admin, { role: "STAFF", branches: [branchB] });
});

afterAll(async () => {
  await admin.end();
});

/** Inserts an order with the given payment rows in one transaction (as the RPC will). */
async function insertOrder(total: string, payments: [string, string, string | null, string | null][]) {
  const db = await connect();
  try {
    await db.query("begin");
    const { rows } = await db.query<{ id: string }>(
      `insert into public.orders (idempotency_key, order_number, branch_id, created_by, subtotal, total_amount, paid_at, paid_by)
       values (gen_random_uuid(), substr(gen_random_uuid()::text, 1, 8), $1, $2, $3, $3, now(), $2) returning id`,
      [branchA, staffA, total],
    );
    for (const [i, [method, amount, received, change]] of payments.entries()) {
      await db.query(
        `insert into public.order_payments (order_id, payer_index, method, amount, cash_received, change_given)
         values ($1, $2, $3, $4, $5, $6)`,
        [rows[0].id, i + 1, method, amount, received, change],
      );
    }
    await db.query("commit");
    return rows[0].id;
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}

describe("order_payments", () => {
  it("accepts an AA split whose shares add up to the total", async () => {
    const orderId = await insertOrder("16.00", [
      ["QR", "8.00", null, null],
      ["CASH", "8.00", "10.00", "2.00"],
    ]);
    const { rows } = await admin.query("select count(*)::int as n from public.order_payments where order_id = $1", [orderId]);
    expect(rows[0].n).toBe(2);
  });

  it("rejects payments that do not add up to the order total (checked at commit)", async () => {
    await expect(insertOrder("16.00", [["QR", "8.00", null, null]])).rejects.toThrow(/do not add up/);
  });

  it("rejects wrong change or cash fields on QR payments", async () => {
    await expect(insertOrder("8.00", [["CASH", "8.00", "10.00", "1.00"]])).rejects.toThrow(/check constraint/);
    await expect(insertOrder("8.00", [["QR", "8.00", "10.00", "2.00"]])).rejects.toThrow(/check constraint/);
  });

  it("is visible only to the order's branch and not writable by app users", async () => {
    const orderId = await insertOrder("8.00", [["QR", "8.00", null, null]]);
    const count = (userId: string) =>
      asUser(userId, async (db) =>
        (await db.query("select count(*)::int as n from public.order_payments where order_id = $1", [orderId])).rows[0].n,
      );
    expect(await count(staffA)).toBe(1);
    expect(await count(staffB)).toBe(0);
    await expect(
      asUser(staffA, (db) => db.query("update public.order_payments set amount = 0 where order_id = $1", [orderId])),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("order_payment_items (split by item)", () => {
  /** Order: Chicken Rice RM 8.00 ×1 + Chop RM 9.50 ×1, two payers, given allocations [payer, item, qty]. */
  async function insertByItem(allocations: [number, number, number][]) {
    const db = await connect();
    try {
      await db.query("begin");
      const product = (
        await db.query<{ id: string }>("insert into public.products (name) values ('x') returning id")
      ).rows[0].id;
      const order = (
        await db.query<{ id: string }>(
          `insert into public.orders (idempotency_key, order_number, branch_id, created_by, subtotal, total_amount, paid_at, paid_by)
           values (gen_random_uuid(), substr(gen_random_uuid()::text, 1, 8), $1, $2, 17.50, 17.50, now(), $2) returning id`,
          [branchA, staffA],
        )
      ).rows[0].id;
      const itemIds: string[] = [];
      for (const [name, price] of [["Chicken Rice", "8.00"], ["Chop", "9.50"]]) {
        itemIds.push(
          (
            await db.query<{ id: string }>(
              `insert into public.order_items (order_id, product_id, product_name_snapshot, unit_price_snapshot, quantity, line_total)
               values ($1, $2, $3, $4, 1, $4) returning id`,
              [order, product, name, price],
            )
          ).rows[0].id,
        );
      }
      const paymentIds: string[] = [];
      for (const [i, amount] of ["8.00", "9.50"].entries()) {
        paymentIds.push(
          (
            await db.query<{ id: string }>(
              `insert into public.order_payments (order_id, payer_index, method, amount) values ($1, $2, 'QR', $3) returning id`,
              [order, i + 1, amount],
            )
          ).rows[0].id,
        );
      }
      for (const [payer, item, qty] of allocations) {
        await db.query("insert into public.order_payment_items (payment_id, order_item_id, quantity) values ($1, $2, $3)", [
          paymentIds[payer],
          itemIds[item],
          qty,
        ]);
      }
      await db.query("commit");
    } catch (error) {
      await db.query("rollback").catch(() => {});
      throw error;
    } finally {
      await db.end();
    }
  }

  it("accepts allocations covering every unit once (A: RM 8, B: RM 9.50)", async () => {
    await insertByItem([
      [0, 0, 1],
      [1, 1, 1],
    ]);
  });

  it("rejects an unallocated item", async () => {
    await expect(insertByItem([[0, 0, 1]])).rejects.toThrow(/exactly once/);
  });

  it("rejects an over-allocated item", async () => {
    await expect(
      insertByItem([
        [0, 0, 1],
        [1, 0, 1],
        [1, 1, 1],
      ]),
    ).rejects.toThrow(/exactly once/);
  });
});

describe("pay later", () => {
  /** Runs statements in one transaction, as the RPC will. */
  async function tx(fn: (db: Db) => Promise<void>) {
    const db = await connect();
    try {
      await db.query("begin");
      await fn(db);
      await db.query("commit");
    } catch (error) {
      await db.query("rollback").catch(() => {});
      throw error;
    } finally {
      await db.end();
    }
  }

  async function unpaidOrder(total = "8.00") {
    const { rows } = await admin.query<{ id: string }>(
      `insert into public.orders (idempotency_key, order_number, branch_id, created_by, subtotal, total_amount)
       values (gen_random_uuid(), substr(gen_random_uuid()::text, 1, 8), $1, $2, $3, $3) returning id`,
      [branchA, staffA, total],
    );
    return rows[0].id;
  }

  /** The collection RPC's guarded claim plus payment rows; returns whether this call won. */
  const collect = (orderId: string, method = "QR") =>
    tx(async (db) => {
      const claimed = await db.query(
        `update public.orders set paid_at = now(), paid_by = $2
         where id = $1 and paid_at is null and status <> 'CANCELLED'`,
        [orderId, staffA],
      );
      if (claimed.rowCount !== 1) throw new Error("not claimed");
      await db.query(
        `insert into public.order_payments (order_id, payer_index, method, amount)
         select id, 1, $2, total_amount from public.orders where id = $1`,
        [orderId, method],
      );
    });

  it("stores an unpaid order with no payment rows", async () => {
    const orderId = await unpaidOrder();
    const { rows } = await admin.query("select paid_at from public.orders where id = $1", [orderId]);
    expect(rows[0].paid_at).toBeNull();
  });

  it("collects payment later in one transaction", async () => {
    const orderId = await unpaidOrder();
    await collect(orderId);
    const { rows } = await admin.query(
      "select o.paid_by, count(p.*)::int as n from public.orders o join public.order_payments p on p.order_id = o.id where o.id = $1 group by o.paid_by",
      [orderId],
    );
    expect(rows[0]).toMatchObject({ paid_by: staffA, n: 1 });
  });

  it("only one of two concurrent collections succeeds", async () => {
    const orderId = await unpaidOrder();
    const results = await Promise.allSettled([collect(orderId, "QR"), collect(orderId, "CASH")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const { rows } = await admin.query("select count(*)::int as n from public.order_payments where order_id = $1", [orderId]);
    expect(rows[0].n).toBe(1);
  });

  it("rejects marking paid without payment rows, or payment rows without marking paid", async () => {
    const a = await unpaidOrder();
    await expect(
      tx((db) => db.query("update public.orders set paid_at = now(), paid_by = $2 where id = $1", [a, staffA]).then(() => {})),
    ).rejects.toThrow(/does not match/);
    const b = await unpaidOrder();
    await expect(
      tx((db) =>
        db
          .query("insert into public.order_payments (order_id, payer_index, method, amount) values ($1, 1, 'QR', 8.00)", [b])
          .then(() => {}),
      ),
    ).rejects.toThrow(/does not match/);
  });

  it("never changes a recorded payment or pays a cancelled order", async () => {
    const orderId = await unpaidOrder();
    await collect(orderId);
    await expect(admin.query("update public.orders set paid_at = now() where id = $1", [orderId])).rejects.toThrow(
      /already paid/,
    );
    const cancelled = await unpaidOrder();
    await admin.query("update public.orders set status = 'CANCELLED', cancelled_at = now() where id = $1", [cancelled]);
    await expect(collect(cancelled)).rejects.toThrow(/not claimed/);
  });
});

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { zh } from "@/i18n/zh";
import type { Actor, CreateOrderInput, DomainError, ItemAllocation, Repository } from "./domain";
import { createMemoryRepository, type MemoryState } from "./memory-repository";
import { seedState } from "./memory-seed";

const owner: Actor = { id: "u-owner", name: "Owner", role: "OWNER" };
const staffMain: Actor = { id: "u-staff-main", name: "Aminah", role: "STAFF" };
const staffMall: Actor = { id: "u-staff-mall", name: "Ben", role: "STAFF" };

let state: MemoryState;
let repo: Repository;

const order = (items: CreateOrderInput["items"], extra: Partial<CreateOrderInput> = {}): CreateOrderInput => ({
  idempotencyKey: randomUUID(),
  branchId: "b-main",
  tableNumber: "5",
  payments: [cash()],
  items,
  ...extra,
});
const cash = (cashReceivedSen: number | null = null, allocations: ItemAllocation[] | null = null) => ({
  method: "CASH" as const,
  cashReceivedSen,
  allocations,
});
const qr = (allocations: ItemAllocation[] | null = null) => ({ method: "QR" as const, cashReceivedSen: null, allocations });
const items = (...pairs: [number, number][]) => pairs.map(([lineIndex, quantity]) => ({ lineIndex, quantity }));
const line = (productId: string, quantity: number) => ({ productId, quantity, specialInstructions: null });
const balance = (ingredientId: string, branchId = "b-main") => state.balances.get(`${branchId}:${ingredientId}`);
const servings = async (productId: string, actor: Actor = staffMain) =>
  (await repo.getPosCatalog(actor, "b-main")).products.find((p) => p.productId === productId)?.estimatedServings;

beforeEach(() => {
  state = seedState();
  repo = createMemoryRepository(state, () => new Date("2026-10-14T04:00:00Z"));
});

describe("order creation", () => {
  it("uses server prices, snapshots names, and numbers orders per branch per day", async () => {
    const { order: first } = await repo.createOrder(staffMain, order([line("p-chicken-rice", 2), line("p-teh-tarik", 1)]));
    expect(first.totalSen).toBe(2 * 800 + 250);
    expect(first.items[0]).toMatchObject({ productNameSnapshot: "Chicken Rice", unitPriceSnapshotSen: 800 });
    expect(first.orderNumber).toBe("001");
    expect(first.payments).toEqual([
      { method: "CASH", amountSen: 1850, cashReceivedSen: null, changeSen: null, allocations: null },
    ]);
    expect(first.businessDate).toBe("2026-10-14");

    const { order: second } = await repo.createOrder(staffMain, order([line("p-teh-tarik", 1)]));
    expect(second.orderNumber).toBe("002");

    // Later price change does not alter history.
    await repo.setBranchProduct(owner, { branchId: "b-main", productId: "p-chicken-rice", priceSen: 900, isAvailable: true });
    const orders = await repo.listOrders(owner, "b-main", { businessDate: "2026-10-14" });
    expect(orders.find((o) => o.id === first.id)!.items[0].unitPriceSnapshotSen).toBe(800);
  });

  it("rejects disabled or unavailable products", async () => {
    await repo.setBranchProduct(owner, { branchId: "b-main", productId: "p-nasi-lemak", priceSen: 700, isAvailable: false });
    await expect(repo.createOrder(staffMain, order([line("p-nasi-lemak", 1)]))).rejects.toMatchObject({
      code: "PRODUCT_UNAVAILABLE",
    });
    await repo.updateProduct(owner, "p-fried-mee", { isActive: false });
    await expect(repo.createOrder(staffMain, order([line("p-fried-mee", 1)]))).rejects.toMatchObject({
      code: "PRODUCT_UNAVAILABLE",
    });
  });
});

describe("bilingual names and photos", () => {
  it("snapshots both English and Chinese names on order items", async () => {
    const { order: o } = await repo.createOrder(staffMain, order([line("p-chicken-rice", 1)]));
    expect(o.items[0]).toMatchObject({ productNameSnapshot: "Chicken Rice", productNameZhSnapshot: "鸡饭" });
    await repo.updateProduct(owner, "p-chicken-rice", { nameZh: "海南鸡饭" });
    expect(state.orders[0].items[0].productNameZhSnapshot).toBe("鸡饭");
  });

  it("errors carry a translation key and parameters", async () => {
    const error = (await repo
      .createOrder(staffMain, order([line("p-fried-chicken-rice", 7)]))
      .catch((e: unknown) => e)) as DomainError;
    expect(error).toMatchObject({ key: "insufficientStock", params: { ingredient: "Chicken", need: "1,260 g", have: "1,200 g" } });
    expect(zh.errors[error.key](error.params)).toBe("Chicken 库存不足：需要 1,260 g，现有 1,200 g");
  });

  it("only owners can set product photos", async () => {
    await expect(repo.setProductImage(staffMain, "p-chicken-rice", "/api/uploads/x.jpg")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await repo.setProductImage(owner, "p-chicken-rice", "/api/uploads/a.jpg")).toBeNull();
    expect(await repo.setProductImage(owner, "p-chicken-rice", null)).toBe("/api/uploads/a.jpg");
    await expect(repo.assertOwner(staffMain)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("POS catalog exposes Chinese names and photos", async () => {
    await repo.setProductImage(owner, "p-teh-tarik", "/api/uploads/t.jpg");
    const product = (await repo.getPosCatalog(staffMain, "b-main")).products.find((p) => p.productId === "p-teh-tarik");
    expect(product).toMatchObject({ nameZh: "拉茶", imageUrl: "/api/uploads/t.jpg" });
  });
});

describe("AA split bill", () => {
  it("splits 2 Fried Rice (RM 16) between two people at RM 8 each", async () => {
    const { order: o } = await repo.createOrder(
      staffMain,
      order([line("p-fried-rice", 2)], { payments: [qr(), cash(1000)] }),
    );
    expect(o.totalSen).toBe(1600);
    expect(o.payments).toEqual([
      { method: "QR", amountSen: 800, cashReceivedSen: null, changeSen: null, allocations: null },
      { method: "CASH", amountSen: 800, cashReceivedSen: 1000, changeSen: 200, allocations: null },
    ]);
  });

  it("gives leftover sen to the first payers so shares add up exactly", async () => {
    // 3 Teh Tarik + 1 Iced Lemon Tea = RM 10.50; ÷4 → 263, 263, 262, 262.
    const { order: o } = await repo.createOrder(
      staffMain,
      order([line("p-teh-tarik", 3), line("p-iced-lemon-tea", 1)], { payments: [cash(), cash(), qr(), qr()] }),
    );
    expect(o.payments.map((p) => p.amountSen)).toEqual([263, 263, 262, 262]);
    expect(o.payments.reduce((sum, p) => sum + p.amountSen, 0)).toBe(o.totalSen);
  });

  it("checks each cash payer against their own share", async () => {
    await expect(
      repo.createOrder(staffMain, order([line("p-chicken-rice", 2)], { payments: [cash(1000), cash(700)] })),
    ).rejects.toMatchObject({ key: "cashShort", params: { received: "RM 7.00", total: "RM 8.00" } });
    expect(state.orders).toHaveLength(0);
    expect(balance("i-chicken")).toBe(1_200_000);
  });

  it("rejects more than 10 payers", async () => {
    await expect(
      repo.createOrder(staffMain, order([line("p-teh-tarik", 1)], { payments: Array.from({ length: 11 }, () => qr()) })),
    ).rejects.toMatchObject({ key: "invalidSplit" });
  });

  it("dashboard counts each payer's share under their own method", async () => {
    await repo.createOrder(staffMain, order([line("p-chicken-rice", 2)], { payments: [qr(), cash()] }));
    const summary = await repo.salesSummary(owner, { branchId: "b-main", fromDate: "2026-10-14", toDate: "2026-10-14" });
    expect(summary.orderTotalSen).toBe(1600);
    expect(summary.byPaymentMethod).toEqual({
      QR: { paymentCount: 1, totalSen: 800 },
      CASH: { paymentCount: 1, totalSen: 800 },
    });
  });
});

describe("split by item", () => {
  // Lines: 0 Chicken Rice RM 8.00, 1 Fried Chicken Rice RM 10.00, 2 Teh Tarik RM 2.50 ×2.
  const lines = () => [line("p-chicken-rice", 1), line("p-fried-chicken-rice", 1), line("p-teh-tarik", 2)];

  it("charges each person for what they had", async () => {
    const { order: o } = await repo.createOrder(
      staffMain,
      order(lines(), { payments: [qr(items([0, 1])), cash(1000, items([1, 1])), cash(null, items([2, 2]))] }),
    );
    expect(o.totalSen).toBe(2300);
    expect(o.payments.map((p) => p.amountSen)).toEqual([800, 1000, 500]);
    expect(o.payments[1]).toMatchObject({ cashReceivedSen: 1000, changeSen: 0 });
    expect(o.payments[2].allocations).toEqual([{ lineIndex: 2, quantity: 2 }]);
  });

  it("matches the RM 8 / RM 9.50 example with a RM 9.50 dish", async () => {
    await repo.setBranchProduct(owner, { branchId: "b-main", productId: "p-fried-chicken-rice", priceSen: 950, isAvailable: true });
    const { order: o } = await repo.createOrder(
      staffMain,
      order(lines(), { payments: [qr(items([0, 1])), qr(items([1, 1])), qr(items([2, 2]))] }),
    );
    expect(o.payments.map((p) => p.amountSen)).toEqual([800, 950, 500]);
  });

  it("lets one person pay for several units and items", async () => {
    const { order: o } = await repo.createOrder(
      staffMain,
      order(lines(), { payments: [qr(items([0, 1], [2, 1])), qr(items([1, 1], [2, 1]))] }),
    );
    expect(o.payments.map((p) => p.amountSen)).toEqual([1050, 1250]);
  });

  it("rejects unassigned, double-assigned or out-of-range items without touching stock", async () => {
    for (const payments of [
      [qr(items([0, 1])), qr(items([1, 1]))], // teh tarik unassigned
      [qr(items([0, 1], [2, 2])), qr(items([0, 1], [1, 1]))], // chicken rice twice
      [qr(items([0, 1], [1, 1], [2, 2])), qr(items([5, 1]))], // no such line
      [qr(items([0, 1], [1, 1], [2, 2])), qr(null)], // mixing even and by-item
    ]) {
      await expect(repo.createOrder(staffMain, order(lines(), { payments }))).rejects.toMatchObject({
        key: "allocationMismatch",
      });
    }
    expect(state.orders).toHaveLength(0);
    expect(balance("i-chicken")).toBe(1_200_000);
  });

  it("rejects a person with no items", async () => {
    await expect(
      repo.createOrder(staffMain, order(lines(), { payments: [qr(items([0, 1], [1, 1], [2, 2])), qr([])] })),
    ).rejects.toMatchObject({ key: "payerNoItems", params: { person: "2" } });
  });

  it("checks cash against the person's own items", async () => {
    await expect(
      repo.createOrder(staffMain, order(lines(), { payments: [cash(500, items([0, 1])), qr(items([1, 1], [2, 2]))] })),
    ).rejects.toMatchObject({ key: "cashShort", params: { received: "RM 5.00", total: "RM 8.00" } });
  });
});

describe("cash change", () => {
  it("computes change from the server total", async () => {
    // 2 × RM 8.00 + RM 2.50 = RM 18.50; customer hands over RM 20.
    const { order: o } = await repo.createOrder(
      staffMain,
      order([line("p-chicken-rice", 2), line("p-teh-tarik", 1)], { payments: [cash(2000)] }),
    );
    expect(o.totalSen).toBe(1850);
    expect(o.payments).toEqual([
      { method: "CASH", amountSen: 1850, cashReceivedSen: 2000, changeSen: 150, allocations: null },
    ]);
  });

  it("treats no amount as exact cash", async () => {
    const { order: o } = await repo.createOrder(staffMain, order([line("p-teh-tarik", 1)]));
    expect(o.payments[0]).toMatchObject({ cashReceivedSen: null, changeSen: null });
  });

  it("rejects too little cash before touching stock", async () => {
    await expect(
      repo.createOrder(staffMain, order([line("p-chicken-rice", 2)], { payments: [cash(1500)] })),
    ).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("less than the amount due") });
    expect(balance("i-chicken")).toBe(1_200_000);
    expect(state.orders).toHaveLength(0);
  });

  it("rejects a cash amount on QR orders", async () => {
    await expect(
      repo.createOrder(staffMain, order([line("p-teh-tarik", 1)], { payments: [{ method: "QR", cashReceivedSen: 500, allocations: null }] })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("pay later", () => {
  const payLater = (extra: Partial<CreateOrderInput> = {}) =>
    order([line("p-chicken-rice", 1), line("p-teh-tarik", 2)], { payments: [], ...extra });

  it("sends an unpaid order to the kitchen and deducts stock at once", async () => {
    const before = balance("i-rice");
    const { order: o } = await repo.createOrder(staffMain, payLater());
    expect(o).toMatchObject({ status: "NEW", payments: [], paidAt: null, paidByName: null });
    expect(balance("i-rice")).toBeLessThan(before!);
  });

  it("pay-now orders are marked paid when placed", async () => {
    const { order: o } = await repo.createOrder(staffMain, order([line("p-teh-tarik", 1)]));
    expect(o.paidAt).not.toBeNull();
    expect(o.paidByName).toBe("Aminah");
  });

  it("collects payment later with cash change, even after the food is ready", async () => {
    const { order: o } = await repo.createOrder(staffMain, payLater());
    await repo.updateOrderStatus(staffMain, o.id, "PREPARING");
    await repo.updateOrderStatus(staffMain, o.id, "READY");
    const paid = await repo.recordPayment(staffMain, o.id, [cash(2000)]);
    expect(paid.payments).toEqual([
      { method: "CASH", amountSen: 1300, cashReceivedSen: 2000, changeSen: 700, allocations: null },
    ]);
    expect(paid.paidAt).not.toBeNull();
    expect(state.auditLogs.at(-1)).toMatchObject({ action: "ORDER_PAID", entityId: o.id });
  });

  it("collects a split-by-item payment against the order's own prices", async () => {
    const { order: o } = await repo.createOrder(staffMain, payLater());
    await repo.setBranchProduct(owner, { branchId: "b-main", productId: "p-chicken-rice", priceSen: 990, isAvailable: true });
    const paid = await repo.recordPayment(staffMain, o.id, [qr(items([0, 1])), cash(null, items([1, 2]))]);
    expect(paid.payments.map((p) => p.amountSen)).toEqual([800, 500]);
  });

  it("only the first of two collections is recorded", async () => {
    const { order: o } = await repo.createOrder(staffMain, payLater());
    const results = await Promise.allSettled([
      repo.recordPayment(staffMain, o.id, [qr()]),
      repo.recordPayment(owner, o.id, [cash()]),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject({ code: "ALREADY_PAID" });
    expect(state.orders.find((x) => x.id === o.id)!.payments.map((p) => p.method)).toEqual(["QR"]);
  });

  it("rejects paying a pay-now order, a cancelled order, short cash, or no payers", async () => {
    const { order: paid } = await repo.createOrder(staffMain, order([line("p-teh-tarik", 1)]));
    await expect(repo.recordPayment(staffMain, paid.id, [qr()])).rejects.toMatchObject({ code: "ALREADY_PAID" });

    const { order: o } = await repo.createOrder(staffMain, payLater());
    await expect(repo.recordPayment(staffMain, o.id, [cash(1000)])).rejects.toMatchObject({ key: "cashShort" });
    await expect(repo.recordPayment(staffMain, o.id, [])).rejects.toMatchObject({ key: "invalidSplit" });
    expect(state.orders.find((x) => x.id === o.id)!.paidAt).toBeNull();

    await repo.cancelOrder(staffMain, o.id, "Customer left");
    await expect(repo.recordPayment(staffMain, o.id, [qr()])).rejects.toMatchObject({ key: "alreadyCancelled" });
  });

  it("staff cannot collect payment for another branch", async () => {
    const { order: o } = await repo.createOrder(staffMain, payLater());
    await expect(repo.recordPayment(staffMall, o.id, [qr()])).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("dashboard counts unpaid orders separately until collected", async () => {
    const { order: o } = await repo.createOrder(staffMain, payLater());
    await repo.createOrder(staffMain, order([line("p-teh-tarik", 1)], { payments: [qr()] }));
    const range = { branchId: "b-main", fromDate: "2026-10-14", toDate: "2026-10-14" };
    let summary = await repo.salesSummary(owner, range);
    expect(summary.orderTotalSen).toBe(1550);
    expect(summary.unpaid).toEqual({ orderCount: 1, totalSen: 1300 });
    expect(summary.byPaymentMethod.QR.totalSen).toBe(250);

    await repo.recordPayment(staffMain, o.id, [qr()]);
    summary = await repo.salesSummary(owner, range);
    expect(summary.unpaid).toEqual({ orderCount: 0, totalSen: 0 });
    expect(summary.byPaymentMethod.QR.totalSen).toBe(1550);
  });
});

describe("recipe deduction", () => {
  it("deducts aggregated ingredients and records movements linked to the order", async () => {
    // Chicken: 2×120 + 1×180 = 420 g. Rice: 3×180 = 540 g.
    const { order: created } = await repo.createOrder(
      staffMain,
      order([line("p-chicken-rice", 2), line("p-fried-chicken-rice", 1)]),
    );
    expect(balance("i-chicken")).toBe(780_000);
    expect(balance("i-rice")).toBe(4_460_000);

    const movements = state.movements.filter((m) => m.referenceId === created.id);
    expect(movements).toHaveLength(3); // chicken, rice, oil, one row each
    expect(movements.find((m) => m.ingredientId === "i-chicken")).toMatchObject({
      movementType: "RECIPE_CONSUMPTION",
      quantityDelta: -420_000,
      balanceAfter: 780_000,
    });
    expect(balance("i-chicken", "b-mall")).toBe(1_200_000); // other branch untouched
  });

  it("updates serving estimates from shared ingredient stock (README example)", async () => {
    expect(await servings("p-chicken-rice")).toBe(10);
    await repo.createOrder(staffMain, order([line("p-chicken-rice", 4)]));
    expect(balance("i-chicken")).toBe(720_000);
    expect(await servings("p-chicken-rice")).toBe(6);
    expect(await servings("p-fried-chicken-rice")).toBe(4); // 720 / 180, same chicken stock
  });

  it("products without a recipe have no estimate and deduct nothing", async () => {
    expect(await servings("p-iced-lemon-tea")).toBeNull();
    const before = state.movements.length;
    await repo.createOrder(staffMain, order([line("p-iced-lemon-tea", 3)]));
    expect(state.movements.length).toBe(before);
  });
});

describe("insufficient stock", () => {
  it("rejects the whole order, names the ingredient, and changes nothing", async () => {
    const ordersBefore = state.orders.length;
    const movementsBefore = state.movements.length;
    // 6 Fried Chicken Rice needs 1,080 g chicken (ok) but 7 needs 1,260 g (> 1,200 g).
    await expect(
      repo.createOrder(staffMain, order([line("p-teh-tarik", 1), line("p-fried-chicken-rice", 7)])),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK", message: expect.stringContaining("Chicken") });
    expect(state.orders.length).toBe(ordersBefore);
    expect(state.movements.length).toBe(movementsBefore);
    expect(balance("i-chicken")).toBe(1_200_000);
    expect(balance("i-tea")).toBe(500_000);
  });

  it("checks the aggregate, not each line separately", async () => {
    // Each line alone fits (600 g, 720 g) but together 1,320 g > 1,200 g.
    await expect(
      repo.createOrder(staffMain, order([line("p-chicken-rice", 5), line("p-fried-chicken-rice", 4)])),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
  });
});

describe("duplicate submissions", () => {
  it("replays the same order for the same idempotency key and deducts once", async () => {
    const input = order([line("p-chicken-rice", 2)]);
    const first = await repo.createOrder(staffMain, input);
    const again = await repo.createOrder(staffMain, input);
    expect(again.replayed).toBe(true);
    expect(again.order.id).toBe(first.order.id);
    expect(state.orders).toHaveLength(1);
    expect(balance("i-chicken")).toBe(960_000);
  });

  it("handles concurrent double-taps with the same key", async () => {
    const input = order([line("p-chicken-rice", 1)]);
    const results = await Promise.all([1, 2, 3].map(() => repo.createOrder(staffMain, input)));
    expect(new Set(results.map((r) => r.order.id)).size).toBe(1);
    expect(balance("i-chicken")).toBe(1_080_000);
  });

  it("rejects reuse of a key with a different cart", async () => {
    const input = order([line("p-chicken-rice", 1)]);
    await repo.createOrder(staffMain, input);
    await expect(
      repo.createOrder(staffMain, { ...input, items: [line("p-chicken-rice", 2)] }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
});

describe("concurrent stock contention", () => {
  it("never oversells when orders race for the last stock", async () => {
    // 1,200 g chicken / 120 g = 10 servings; 15 parallel single orders.
    const attempts = await Promise.allSettled(
      Array.from({ length: 15 }, () => repo.createOrder(staffMain, order([line("p-chicken-rice", 1)]))),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(10);
    expect(attempts.filter((a) => a.status === "rejected")).toHaveLength(5);
    expect(balance("i-chicken")).toBe(0);
  });
});

describe("status changes and cancellation", () => {
  it("moves NEW → PREPARING → READY and rejects skipping or going back", async () => {
    const { order: o } = await repo.createOrder(staffMain, order([line("p-teh-tarik", 1)]));
    await expect(repo.updateOrderStatus(staffMain, o.id, "READY")).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await repo.updateOrderStatus(staffMain, o.id, "PREPARING");
    await repo.updateOrderStatus(staffMain, o.id, "READY");
    await expect(repo.updateOrderStatus(staffMain, o.id, "PREPARING")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("cancellation does not restore stock and is audited", async () => {
    const { order: o } = await repo.createOrder(staffMain, order([line("p-chicken-rice", 2)]));
    await repo.cancelOrder(staffMain, o.id, "Customer left");
    expect(balance("i-chicken")).toBe(960_000);
    expect(state.auditLogs.at(-1)).toMatchObject({ action: "ORDER_CANCELLED", entityId: o.id });
  });

  it("staff can only cancel NEW orders; owner can cancel later", async () => {
    const { order: o } = await repo.createOrder(staffMain, order([line("p-teh-tarik", 1)]));
    await repo.updateOrderStatus(staffMain, o.id, "PREPARING");
    await expect(repo.cancelOrder(staffMain, o.id, "x")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await repo.cancelOrder(owner, o.id, "Wrong order");
  });
});

describe("branch-level access", () => {
  it("staff cannot order, view or update orders in another branch", async () => {
    await expect(repo.createOrder(staffMall, order([line("p-teh-tarik", 1)]))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { order: o } = await repo.createOrder(staffMain, order([line("p-teh-tarik", 1)]));
    await expect(repo.listOrders(staffMall, "b-main", { businessDate: "2026-10-14" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(repo.updateOrderStatus(staffMall, o.id, "PREPARING")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await repo.listBranches(staffMall)).map((b) => b.id)).toEqual(["b-mall"]);
  });

  it("owner can access every branch", async () => {
    expect((await repo.listBranches(owner)).map((b) => b.id)).toEqual(["b-main", "b-mall"]);
    await repo.createOrder(owner, order([line("p-teh-tarik", 1)], { branchId: "b-mall" }));
  });

  it("staff cannot use owner functions", async () => {
    await expect(
      repo.setBranchProduct(staffMain, { branchId: "b-main", productId: "p-chicken-rice", priceSen: 1, isAvailable: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(repo.listStock(staffMain, "b-main")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      repo.salesSummary(staffMain, { branchId: "b-main", fromDate: "2026-10-14", toDate: "2026-10-14" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sales summary excludes cancelled orders", async () => {
    await repo.createOrder(staffMain, order([line("p-chicken-rice", 1)]));
    const { order: o } = await repo.createOrder(staffMain, order([line("p-chicken-rice", 1)]));
    await repo.cancelOrder(staffMain, o.id, "x");
    const summary = await repo.salesSummary(owner, { branchId: "ALL", fromDate: "2026-10-14", toDate: "2026-10-14" });
    expect(summary).toMatchObject({ orderCount: 1, orderTotalSen: 800, cancelledCount: 1 });
  });

  it("sales summary splits totals by recorded payment method", async () => {
    await repo.createOrder(staffMain, order([line("p-chicken-rice", 2)], { payments: [qr()] }));
    await repo.createOrder(staffMain, order([line("p-teh-tarik", 1)], { payments: [cash()] }));
    const summary = await repo.salesSummary(owner, { branchId: "b-main", fromDate: "2026-10-14", toDate: "2026-10-14" });
    expect(summary.byPaymentMethod).toEqual({
      QR: { paymentCount: 1, totalSen: 1600 },
      CASH: { paymentCount: 1, totalSen: 250 },
    });
  });
});

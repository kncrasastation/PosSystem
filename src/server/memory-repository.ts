import { randomUUID } from "node:crypto";
import { businessDate } from "@/lib/dates";
import { formatSen, splitEvenly } from "@/lib/money";
import { formatQuantity } from "@/lib/quantity";
import {
  DomainError,
  type Actor,
  type AdminProductRow,
  type Branch,
  type Category,
  type Ingredient,
  MAX_SPLIT,
  type Order,
  type OrderPayment,
  type PaymentInput,
  type OrderItem,
  type OrderStatus,
  type PosCatalog,
  type Product,
  type Repository,
  type SalesSummary,
  type StockRow,
  type User,
} from "./domain";
import { seedState } from "./memory-seed";

// In-memory stand-in for the Supabase database, used until it is connected.
//
// Atomicity: every mutating method does all of its validation and writes synchronously,
// with no `await` in between, so on Node's single thread no other request can interleave.
// That gives the same all-or-nothing behaviour the PostgreSQL RPC will provide.

export interface BranchProduct {
  branchId: string;
  productId: string;
  priceSen: number;
  isAvailable: boolean;
}

export interface Recipe {
  branchId: string;
  productId: string;
  ingredientId: string;
  quantityPerServing: number;
}

export interface StockMovement {
  id: string;
  branchId: string;
  ingredientId: string;
  movementType: "OPENING" | "RECIPE_CONSUMPTION";
  quantityDelta: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  branchId: string | null;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface MemoryState {
  users: User[];
  branches: Branch[];
  categories: Category[];
  products: Product[];
  branchProducts: BranchProduct[];
  ingredients: Ingredient[];
  recipes: Recipe[];
  /** key: `${branchId}:${ingredientId}` */
  balances: Map<string, number>;
  movements: StockMovement[];
  orders: Order[];
  /** idempotency key -> { orderId, requestHash } */
  idempotency: Map<string, { orderId: string; requestHash: string }>;
  /** key: `${branchId}:${businessDate}` -> last sequence */
  orderCounters: Map<string, number>;
  auditLogs: AuditLog[];
}

const totalsFor = (payments: OrderPayment[]) => ({
  paymentCount: payments.length,
  totalSen: payments.reduce((sum, p) => sum + p.amountSen, 0),
});

/**
 * Each payer's amount: an even split of the total, or (split by item) the sum of the units
 * they were allocated at server prices. Validates that allocations cover every unit once.
 */
function paymentShares(payments: PaymentInput[], items: OrderItem[], totalSen: number): number[] {
  const byItem = payments.filter((p) => p.allocations !== null).length;
  if (byItem === 0) return splitEvenly(totalSen, payments.length);
  if (byItem !== payments.length || payments.length < 2) {
    throw new DomainError("VALIDATION", "allocationMismatch");
  }

  const allocated = items.map(() => 0);
  const shares = payments.map((payment, i) => {
    if (payment.allocations!.length === 0) {
      throw new DomainError("VALIDATION", "payerNoItems", { person: String(i + 1) });
    }
    return payment.allocations!.reduce((sum, { lineIndex, quantity }) => {
      if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= items.length) {
        throw new DomainError("VALIDATION", "allocationMismatch");
      }
      if (!Number.isInteger(quantity) || quantity < 1) throw new DomainError("VALIDATION", "allocationMismatch");
      allocated[lineIndex] += quantity;
      return sum + items[lineIndex].unitPriceSnapshotSen * quantity;
    }, 0);
  });

  if (allocated.some((qty, i) => qty !== items[i].quantity)) {
    throw new DomainError("VALIDATION", "allocationMismatch");
  }
  return shares;
}

/** Validates payer inputs and computes each payer's share and change from server prices. */
function buildPayments(inputs: PaymentInput[], items: OrderItem[], totalSen: number): OrderPayment[] {
  if (inputs.length < 1 || inputs.length > MAX_SPLIT) {
    throw new DomainError("VALIDATION", "invalidSplit", { max: String(MAX_SPLIT) });
  }
  for (const payment of inputs) {
    if (payment.method !== "CASH" && payment.method !== "QR") {
      throw new DomainError("VALIDATION", "choosePayment");
    }
    if (payment.method !== "CASH" && payment.cashReceivedSen !== null) {
      throw new DomainError("VALIDATION", "cashOnlyForCash");
    }
  }
  const shares = paymentShares(inputs, items, totalSen);
  return inputs.map((payment, i) => {
    const amountSen = shares[i];
    if (payment.cashReceivedSen !== null && payment.cashReceivedSen < amountSen) {
      throw new DomainError("VALIDATION", "cashShort", {
        received: formatSen(payment.cashReceivedSen),
        total: formatSen(amountSen),
      });
    }
    return {
      method: payment.method,
      amountSen,
      cashReceivedSen: payment.cashReceivedSen,
      changeSen: payment.cashReceivedSen === null ? null : payment.cashReceivedSen - amountSen,
      allocations: payment.allocations,
    };
  });
}

const balanceKey = (branchId: string, ingredientId: string) => `${branchId}:${ingredientId}`;

const FORWARD_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus>> = {
  NEW: "PREPARING",
  PREPARING: "READY",
};

export function createMemoryRepository(state: MemoryState = seedState(), now: () => Date = () => new Date()): Repository {
  // ---- authorization helpers (mirror app.is_owner / app.has_branch_access) ----
  function activeUser(actor: Actor): User {
    const user = state.users.find((u) => u.id === actor.id);
    if (!user || !user.isActive) throw new DomainError("UNAUTHORIZED", "notSignedIn");
    return user;
  }

  function requireOwner(actor: Actor): User {
    const user = activeUser(actor);
    if (user.role !== "OWNER") throw new DomainError("FORBIDDEN", "ownerRequired");
    return user;
  }

  function requireBranch(actor: Actor, branchId: string): Branch {
    const user = activeUser(actor);
    const branch = state.branches.find((b) => b.id === branchId);
    const allowed =
      branch && (user.role === "OWNER" || (branch.isActive && user.branchIds.includes(branch.id)));
    if (!branch || !allowed) throw new DomainError("FORBIDDEN", "branchForbidden");
    return branch;
  }

  function findOrder(actor: Actor, orderId: string): Order {
    const order = state.orders.find((o) => o.id === orderId);
    if (!order) throw new DomainError("NOT_FOUND", "orderNotFound");
    requireBranch(actor, order.branchId);
    return order;
  }

  function audit(actor: Actor, entry: Omit<AuditLog, "id" | "actorUserId" | "createdAt">) {
    state.auditLogs.push({ ...entry, id: randomUUID(), actorUserId: actor.id, createdAt: now().toISOString() });
  }

  const recipesFor = (branchId: string, productId: string) =>
    state.recipes.filter((r) => r.branchId === branchId && r.productId === productId);

  const ingredientName = (id: string) => state.ingredients.find((i) => i.id === id)?.name ?? "Unknown ingredient";

  return {
    async getUser(userId) {
      return state.users.find((u) => u.id === userId) ?? null;
    },

    async listLoginUsers() {
      return state.users.filter((u) => u.isActive);
    },

    async listBranches(actor) {
      const user = activeUser(actor);
      return state.branches.filter(
        (b) => user.role === "OWNER" || (b.isActive && user.branchIds.includes(b.id)),
      );
    },

    async getBranch(actor, branchId) {
      return requireBranch(actor, branchId);
    },

    async getPosCatalog(actor, branchId): Promise<PosCatalog> {
      requireBranch(actor, branchId);
      const categories = state.categories
        .filter((c) => c.isActive)
        .sort((a, b) => a.displayOrder - b.displayOrder);

      const products = state.branchProducts
        .filter((bp) => bp.branchId === branchId && bp.isAvailable)
        .flatMap((bp) => {
          const product = state.products.find((p) => p.id === bp.productId && p.isActive);
          if (!product) return [];

          // Limiting ingredient determines max servings; integer division is exact.
          let estimatedServings: number | null = null;
          let limitingIngredient: string | null = null;
          let lowStock = false;
          for (const recipe of recipesFor(branchId, product.id)) {
            const onHand = state.balances.get(balanceKey(branchId, recipe.ingredientId)) ?? 0;
            const servings = Math.floor(onHand / recipe.quantityPerServing);
            const ingredient = state.ingredients.find((i) => i.id === recipe.ingredientId);
            if (ingredient && onHand <= ingredient.lowStockThreshold) lowStock = true;
            if (estimatedServings === null || servings < estimatedServings) {
              estimatedServings = servings;
              limitingIngredient = ingredientName(recipe.ingredientId);
            }
          }

          return [
            {
              productId: product.id,
              categoryId: product.categoryId,
              name: product.name,
              nameZh: product.nameZh,
              imageUrl: product.imageUrl,
              priceSen: bp.priceSen,
              estimatedServings,
              lowStock,
              limitingIngredient,
            },
          ];
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      return { categories, products };
    },

    async createOrder(actor, input) {
      const user = activeUser(actor);
      const branch = requireBranch(actor, input.branchId);

      const requestHash = JSON.stringify([input.branchId, input.tableNumber, input.payments, input.items]);
      const existing = state.idempotency.get(input.idempotencyKey);
      if (existing) {
        const order = state.orders.find((o) => o.id === existing.orderId)!;
        if (existing.requestHash !== requestHash || order.createdBy !== user.id) {
          throw new DomainError("IDEMPOTENCY_CONFLICT", "idempotencyConflict");
        }
        return { order, replayed: true };
      }

      if (input.items.length === 0) throw new DomainError("VALIDATION", "noItems");

      // Server-side prices and availability; client-sent prices are never trusted.
      const items: OrderItem[] = input.items.map((line) => {
        if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) {
          throw new DomainError("VALIDATION", "invalidQuantity");
        }
        const product = state.products.find((p) => p.id === line.productId && p.isActive);
        const bp = state.branchProducts.find(
          (x) => x.branchId === branch.id && x.productId === line.productId && x.isAvailable,
        );
        if (!product || !bp) {
          throw new DomainError("PRODUCT_UNAVAILABLE", "productUnavailable", {
            product: product?.name ?? "A product",
            productZh: product?.nameZh ?? "",
          });
        }
        return {
          productId: product.id,
          productNameSnapshot: product.name,
          productNameZhSnapshot: product.nameZh,
          unitPriceSnapshotSen: bp.priceSen,
          quantity: line.quantity,
          lineTotalSen: bp.priceSen * line.quantity,
          specialInstructions: line.specialInstructions,
        };
      });

      // Shares and change come from server prices, not the client's, in case prices changed.
      // No payments = pay later; collected afterwards with recordPayment.
      const totalSen = items.reduce((sum, i) => sum + i.lineTotalSen, 0);
      const payments = input.payments.length === 0 ? [] : buildPayments(input.payments, items, totalSen);

      // Aggregate ingredient usage across the whole order before checking stock.
      const required = new Map<string, number>();
      for (const item of items) {
        for (const recipe of recipesFor(branch.id, item.productId)) {
          required.set(
            recipe.ingredientId,
            (required.get(recipe.ingredientId) ?? 0) + recipe.quantityPerServing * item.quantity,
          );
        }
      }

      for (const [ingredientId, need] of required) {
        const have = state.balances.get(balanceKey(branch.id, ingredientId)) ?? 0;
        if (have < need) {
          const ingredient = state.ingredients.find((i) => i.id === ingredientId)!;
          throw new DomainError("INSUFFICIENT_STOCK", "insufficientStock", {
            ingredient: ingredient.name,
            need: formatQuantity(need, ingredient.baseUnit),
            have: formatQuantity(have, ingredient.baseUnit),
          });
        }
      }

      // All checks passed: persist order, deductions and movements together.
      const at = now();
      const date = businessDate(at, branch.timezone);
      const counterKey = `${branch.id}:${date}`;
      const seq = (state.orderCounters.get(counterKey) ?? 0) + 1;
      state.orderCounters.set(counterKey, seq);

      const order: Order = {
        id: randomUUID(),
        idempotencyKey: input.idempotencyKey,
        orderNumber: String(seq).padStart(3, "0"),
        branchId: branch.id,
        businessDate: date,
        tableNumber: input.tableNumber,
        createdBy: user.id,
        createdByName: user.name,
        status: "NEW",
        totalSen,
        payments,
        paidAt: payments.length > 0 ? at.toISOString() : null,
        paidByName: payments.length > 0 ? user.name : null,
        items,
        createdAt: at.toISOString(),
        updatedAt: at.toISOString(),
        cancelledAt: null,
        cancelReason: null,
      };

      for (const [ingredientId, need] of required) {
        const key = balanceKey(branch.id, ingredientId);
        const balanceAfter = (state.balances.get(key) ?? 0) - need;
        state.balances.set(key, balanceAfter);
        state.movements.push({
          id: randomUUID(),
          branchId: branch.id,
          ingredientId,
          movementType: "RECIPE_CONSUMPTION",
          quantityDelta: -need,
          balanceAfter,
          referenceType: "order",
          referenceId: order.id,
          createdBy: user.id,
          createdAt: at.toISOString(),
        });
      }

      state.orders.push(order);
      state.idempotency.set(input.idempotencyKey, { orderId: order.id, requestHash });
      return { order, replayed: false };
    },

    async listOrders(actor, branchId, opts) {
      requireBranch(actor, branchId);
      return state.orders
        .filter((o) => o.branchId === branchId && o.businessDate === opts.businessDate)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async updateOrderStatus(actor, orderId, status) {
      const order = findOrder(actor, orderId);
      if (FORWARD_TRANSITIONS[order.status] !== status) {
        throw new DomainError("INVALID_TRANSITION", "invalidTransition", { from: order.status, to: status });
      }
      order.status = status;
      order.updatedAt = now().toISOString();
      return order;
    },

    async cancelOrder(actor, orderId, reason) {
      const order = findOrder(actor, orderId);
      const user = activeUser(actor);
      if (order.status === "CANCELLED") throw new DomainError("INVALID_TRANSITION", "alreadyCancelled");
      if (user.role === "STAFF" && order.status !== "NEW") {
        throw new DomainError("FORBIDDEN", "staffCancelStarted");
      }
      const at = now().toISOString();
      const previousStatus = order.status;
      order.status = "CANCELLED";
      order.cancelledAt = at;
      order.cancelReason = reason;
      order.updatedAt = at;
      // Stock is deliberately NOT restored; reversal is a separate owner-controlled workflow.
      audit(actor, {
        branchId: order.branchId,
        action: "ORDER_CANCELLED",
        entityType: "order",
        entityId: order.id,
        details: { reason, previousStatus },
      });
      return order;
    },

    async recordPayment(actor, orderId, inputs) {
      const order = findOrder(actor, orderId);
      const user = activeUser(actor);
      if (order.status === "CANCELLED") throw new DomainError("INVALID_TRANSITION", "alreadyCancelled");
      // Guards against two staff collecting the same bill: the first one wins.
      if (order.paidAt !== null) throw new DomainError("ALREADY_PAID", "alreadyPaid", { order: order.orderNumber });
      const payments = buildPayments(inputs, order.items, order.totalSen);
      const at = now().toISOString();
      order.payments = payments;
      order.paidAt = at;
      order.paidByName = user.name;
      order.updatedAt = at;
      audit(actor, {
        branchId: order.branchId,
        action: "ORDER_PAID",
        entityType: "order",
        entityId: order.id,
        details: { payments },
      });
      return order;
    },

    async listCategories(actor) {
      requireOwner(actor);
      return [...state.categories].sort((a, b) => a.displayOrder - b.displayOrder);
    },

    async listAdminProducts(actor, branchId): Promise<AdminProductRow[]> {
      requireOwner(actor);
      requireBranch(actor, branchId);
      return state.products
        .map((product) => {
          const bp = state.branchProducts.find((x) => x.branchId === branchId && x.productId === product.id);
          const category = state.categories.find((c) => c.id === product.categoryId);
          return {
            product,
            categoryName: category?.name ?? null,
            categoryNameZh: category?.nameZh ?? null,
            branchPriceSen: bp?.priceSen ?? null,
            isAvailable: bp?.isAvailable ?? false,
          };
        })
        .sort((a, b) => a.product.name.localeCompare(b.product.name));
    },

    async createProduct(actor, input) {
      requireOwner(actor);
      requireBranch(actor, input.branchId);
      if (input.categoryId && !state.categories.some((c) => c.id === input.categoryId)) {
        throw new DomainError("VALIDATION", "unknownCategory");
      }
      const product: Product = {
        id: randomUUID(),
        categoryId: input.categoryId,
        name: input.name,
        nameZh: input.nameZh,
        description: input.description,
        imageUrl: null,
        isActive: true,
      };
      state.products.push(product);
      state.branchProducts.push({
        branchId: input.branchId,
        productId: product.id,
        priceSen: input.priceSen,
        isAvailable: true,
      });
      return product;
    },

    async updateProduct(actor, productId, patch) {
      requireOwner(actor);
      const product = state.products.find((p) => p.id === productId);
      if (!product) throw new DomainError("NOT_FOUND", "productNotFound");
      Object.assign(product, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    },

    async setProductImage(actor, productId, imageUrl) {
      requireOwner(actor);
      const product = state.products.find((p) => p.id === productId);
      if (!product) throw new DomainError("NOT_FOUND", "productNotFound");
      const previous = product.imageUrl;
      product.imageUrl = imageUrl;
      return previous;
    },

    async assertOwner(actor) {
      requireOwner(actor);
    },

    async setBranchProduct(actor, input) {
      requireOwner(actor);
      requireBranch(actor, input.branchId);
      if (!state.products.some((p) => p.id === input.productId)) {
        throw new DomainError("NOT_FOUND", "productNotFound");
      }
      const existing = state.branchProducts.find(
        (x) => x.branchId === input.branchId && x.productId === input.productId,
      );
      if (existing) {
        existing.priceSen = input.priceSen;
        existing.isAvailable = input.isAvailable;
      } else {
        state.branchProducts.push({ ...input });
      }
    },

    async listStock(actor, branchId): Promise<StockRow[]> {
      requireOwner(actor);
      requireBranch(actor, branchId);
      return state.ingredients
        .map((ingredient) => {
          const quantityOnHand = state.balances.get(balanceKey(branchId, ingredient.id)) ?? 0;
          return {
            ingredient,
            quantityOnHand,
            isLow: quantityOnHand <= ingredient.lowStockThreshold,
            usedBy: state.recipes
              .filter((r) => r.branchId === branchId && r.ingredientId === ingredient.id)
              .map((r) => ({
                productName: state.products.find((p) => p.id === r.productId)?.name ?? "?",
                quantityPerServing: r.quantityPerServing,
              })),
          };
        })
        .sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name));
    },

    async salesSummary(actor, opts): Promise<SalesSummary> {
      requireOwner(actor);
      if (opts.branchId !== "ALL") requireBranch(actor, opts.branchId);

      const inRange = state.orders.filter(
        (o) =>
          (opts.branchId === "ALL" || o.branchId === opts.branchId) &&
          o.businessDate >= opts.fromDate &&
          o.businessDate <= opts.toDate,
      );
      const valid = inRange.filter((o) => o.status !== "CANCELLED");
      const orderTotalSen = valid.reduce((sum, o) => sum + o.totalSen, 0);

      const byProductMap = new Map<string, SalesSummary["byProduct"][number]>();
      for (const item of valid.flatMap((o) => o.items)) {
        const row = byProductMap.get(item.productId) ?? {
          productId: item.productId,
          name: item.productNameSnapshot,
          nameZh: item.productNameZhSnapshot,
          quantity: 0,
          salesSen: 0,
        };
        row.quantity += item.quantity;
        row.salesSen += item.lineTotalSen;
        byProductMap.set(item.productId, row);
      }

      return {
        orderCount: valid.length,
        orderTotalSen,
        averageOrderSen: valid.length ? Math.round(orderTotalSen / valid.length) : 0,
        cancelledCount: inRange.length - valid.length,
        byPaymentMethod: {
          CASH: totalsFor(valid.flatMap((o) => o.payments).filter((p) => p.method === "CASH")),
          QR: totalsFor(valid.flatMap((o) => o.payments).filter((p) => p.method === "QR")),
        },
        unpaid: {
          orderCount: valid.filter((o) => o.paidAt === null).length,
          totalSen: valid.filter((o) => o.paidAt === null).reduce((sum, o) => sum + o.totalSen, 0),
        },
        byProduct: [...byProductMap.values()].sort((a, b) => b.quantity - a.quantity),
      };
    },
  };
}

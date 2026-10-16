import { en, type ErrorKey } from "@/i18n/en";
import type { BaseUnit } from "@/lib/quantity";

// Money fields ending in `Sen` are integer sen. Quantity fields are integer thousandths
// of the ingredient's base unit (see src/lib/quantity.ts).

export type Role = "OWNER" | "STAFF";
export type OrderStatus = "NEW" | "PREPARING" | "READY" | "CANCELLED";

/** Recorded by staff at the counter; no payment provider verifies it. */
export type PaymentMethod = "CASH" | "QR";
export const PAYMENT_METHODS: readonly PaymentMethod[] = ["QR", "CASH"];

export interface Actor {
  id: string;
  name: string;
  role: Role;
}

export interface User extends Actor {
  isActive: boolean;
  branchIds: string[];
}

export interface Branch {
  id: string;
  name: string;
  isActive: boolean;
  timezone: string;
}

export interface Category {
  id: string;
  name: string;
  nameZh: string | null;
  displayOrder: number;
  isActive: boolean;
}

export interface Product {
  id: string;
  categoryId: string | null;
  name: string;
  nameZh: string | null;
  description: string | null;
  imageUrl: string | null;
  isActive: boolean;
}

export interface Ingredient {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  lowStockThreshold: number;
}

export interface PosProduct {
  productId: string;
  categoryId: string | null;
  name: string;
  nameZh: string | null;
  imageUrl: string | null;
  priceSen: number;
  /** Advisory only; null when the product has no recipe. Revalidated on submit. */
  estimatedServings: number | null;
  lowStock: boolean;
  limitingIngredient: string | null;
}

export interface PosCatalog {
  categories: Category[];
  products: PosProduct[];
}

export interface OrderItem {
  productId: string;
  productNameSnapshot: string;
  productNameZhSnapshot: string | null;
  unitPriceSnapshotSen: number;
  quantity: number;
  lineTotalSen: number;
  specialInstructions: string | null;
}

/** Units of one order line paid by a payer; `lineIndex` refers to CreateOrderInput.items. */
export interface ItemAllocation {
  lineIndex: number;
  quantity: number;
}

export interface PaymentInput {
  method: PaymentMethod;
  /** Cash only (null = exact amount); must be null for QR. */
  cashReceivedSen: number | null;
  /**
   * Split by item: what this payer ate. Either every payer has allocations (and together they
   * cover every unit exactly once) or none do, in which case the total is split evenly.
   */
  allocations: ItemAllocation[] | null;
}

export interface OrderPayment {
  method: PaymentMethod;
  /** This payer's share of the order total. */
  amountSen: number;
  cashReceivedSen: number | null;
  changeSen: number | null;
  /** Split by item: units this payer paid for (lineIndex = index in Order.items); null for even split. */
  allocations: ItemAllocation[] | null;
}

export const MAX_SPLIT = 10;

export interface Order {
  id: string;
  idempotencyKey: string;
  orderNumber: string;
  branchId: string;
  businessDate: string;
  tableNumber: string | null;
  createdBy: string;
  createdByName: string;
  status: OrderStatus;
  totalSen: number;
  /**
   * One entry per payer; more than one means the bill was split (AA). Amounts sum to totalSen.
   * Empty while unpaid (pay later); recorded once, either with the order or afterwards.
   */
  payments: OrderPayment[];
  /** When payment was recorded; null = unpaid. */
  paidAt: string | null;
  paidByName: string | null;
  items: OrderItem[];
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface CreateOrderInput {
  idempotencyKey: string;
  branchId: string;
  tableNumber: string | null;
  /**
   * One entry per payer (1 = no split, max 10); empty = pay later, collected from the orders
   * board. Shares are computed by the server.
   */
  payments: PaymentInput[];
  items: { productId: string; quantity: number; specialInstructions: string | null }[];
}

export interface AdminProductRow {
  product: Product;
  categoryName: string | null;
  categoryNameZh: string | null;
  /** Price/availability at the branch being viewed; null if not sold there. */
  branchPriceSen: number | null;
  isAvailable: boolean;
}

export interface StockRow {
  ingredient: Ingredient;
  quantityOnHand: number;
  isLow: boolean;
  usedBy: { productName: string; quantityPerServing: number }[];
}

export interface SalesSummary {
  orderCount: number;
  orderTotalSen: number;
  averageOrderSen: number;
  cancelledCount: number;
  /** Staff-recorded payment totals per method for non-cancelled orders (split bills counted per payer). */
  byPaymentMethod: Record<PaymentMethod, { paymentCount: number; totalSen: number }>;
  /** Non-cancelled orders still waiting for payment (pay later). */
  unpaid: { orderCount: number; totalSen: number };
  byProduct: { productId: string; name: string; nameZh: string | null; quantity: number; salesSen: number }[];
}

export type DomainErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "PRODUCT_UNAVAILABLE"
  | "INSUFFICIENT_STOCK"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_TRANSITION"
  | "ALREADY_PAID";

/**
 * `key` + `params` let the UI show the message in the user's language;
 * `message` is the English text for logs and tests.
 */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    readonly key: ErrorKey,
    readonly params: Record<string, string> = {},
  ) {
    super(en.errors[key](params));
    this.name = "DomainError";
  }
}

/**
 * Data access boundary. Every method enforces role and branch authorization itself,
 * so callers (server actions, pages) cannot bypass it. The in-memory implementation is
 * used until Supabase is connected; the Supabase implementation will delegate the same
 * checks to RLS and SECURITY DEFINER functions.
 */
export interface Repository {
  getUser(userId: string): Promise<User | null>;
  listLoginUsers(): Promise<User[]>;

  listBranches(actor: Actor): Promise<Branch[]>;
  getBranch(actor: Actor, branchId: string): Promise<Branch>;

  getPosCatalog(actor: Actor, branchId: string): Promise<PosCatalog>;
  createOrder(actor: Actor, input: CreateOrderInput): Promise<{ order: Order; replayed: boolean }>;
  listOrders(actor: Actor, branchId: string, opts: { businessDate: string }): Promise<Order[]>;
  updateOrderStatus(actor: Actor, orderId: string, status: Exclude<OrderStatus, "CANCELLED">): Promise<Order>;
  cancelOrder(actor: Actor, orderId: string, reason: string): Promise<Order>;
  /** Records payment for an unpaid (pay later) order. Rejects if it is already paid or cancelled. */
  recordPayment(actor: Actor, orderId: string, payments: PaymentInput[]): Promise<Order>;

  listCategories(actor: Actor): Promise<Category[]>;
  listAdminProducts(actor: Actor, branchId: string): Promise<AdminProductRow[]>;
  createProduct(
    actor: Actor,
    input: {
      name: string;
      nameZh: string | null;
      categoryId: string | null;
      description: string | null;
      branchId: string;
      priceSen: number;
    },
  ): Promise<Product>;
  updateProduct(
    actor: Actor,
    productId: string,
    patch: {
      name?: string;
      nameZh?: string | null;
      categoryId?: string | null;
      description?: string | null;
      isActive?: boolean;
    },
  ): Promise<void>;
  /** Sets or clears the product photo URL; returns the previous URL so its file can be removed. */
  setProductImage(actor: Actor, productId: string, imageUrl: string | null): Promise<string | null>;
  /** Throws unless the actor is an active owner. For checks that must run before side effects. */
  assertOwner(actor: Actor): Promise<void>;
  setBranchProduct(
    actor: Actor,
    input: { branchId: string; productId: string; priceSen: number; isAvailable: boolean },
  ): Promise<void>;

  listStock(actor: Actor, branchId: string): Promise<StockRow[]>;
  salesSummary(actor: Actor, opts: { branchId: string | "ALL"; fromDate: string; toDate: string }): Promise<SalesSummary>;
}

/**
 * Prefer this over `instanceof`: the repository singleton survives dev hot reloads, so its
 * errors may come from an older copy of the DomainError class.
 */
export function isDomainError(error: unknown): error is DomainError {
  return error instanceof Error && error.name === "DomainError" && "code" in error;
}

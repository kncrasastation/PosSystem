"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MAX_SPLIT, type OrderPayment } from "@/server/domain";
import { repo } from "@/server/repository";
import { requireActor } from "@/server/session";
import { fail, toResult, type ActionResult } from "./result";

const paymentSchema = z.object({
  method: z.enum(["CASH", "QR"]),
  cashReceivedSen: z.int().min(0).max(10_000_000).nullable(),
  allocations: z
    .array(z.object({ lineIndex: z.int().min(0).max(49), quantity: z.int().min(1).max(99) }))
    .max(50)
    .nullable(),
});

const submitOrderSchema = z.object({
  idempotencyKey: z.uuid(),
  branchId: z.string().min(1),
  tableNumber: z.string().trim().min(1).max(20).nullable(),
  // Empty = pay later.
  payments: z.array(paymentSchema).max(MAX_SPLIT),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.int().min(1).max(99),
        specialInstructions: z.string().trim().max(200).nullable(),
      }),
    )
    .min(1)
    .max(50),
});

export async function submitOrder(
  input: z.input<typeof submitOrderSchema>,
): Promise<ActionResult<{ id: string; orderNumber: string; payments: OrderPayment[] }>> {
  const actor = await requireActor();
  const parsed = submitOrderSchema.safeParse(input);
  if (!parsed.success) return fail("invalidOrder");

  const data = parsed.data;
  const result = await toResult(() =>
    repo.createOrder(actor, {
      ...data,
      items: data.items.map((i) => ({ ...i, specialInstructions: i.specialInstructions || null })),
    }),
  );
  if (!result.ok) return result;

  revalidatePath(`/b/${data.branchId}`, "layout");
  const { id, orderNumber, payments } = result.data.order;
  return { ok: true, data: { id, orderNumber, payments } };
}

const idSchema = z.string().min(1);

export async function advanceOrder(branchId: string, orderId: string, status: "PREPARING" | "READY"): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = z.object({ orderId: idSchema, status: z.enum(["PREPARING", "READY"]) }).safeParse({ orderId, status });
  if (!parsed.success) return fail("generic");
  const result = await toResult(async () => {
    await repo.updateOrderStatus(actor, parsed.data.orderId, parsed.data.status);
    return undefined;
  });
  revalidatePath(`/b/${branchId}/orders`);
  return result;
}

export async function cancelOrder(branchId: string, orderId: string, reason: string): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = z.object({ orderId: idSchema, reason: z.string().trim().min(1).max(200) }).safeParse({ orderId, reason });
  if (!parsed.success) return fail("cancelReasonRequired");
  const result = await toResult(async () => {
    await repo.cancelOrder(actor, parsed.data.orderId, parsed.data.reason);
    return undefined;
  });
  revalidatePath(`/b/${branchId}/orders`);
  return result;
}

export async function collectPayment(
  branchId: string,
  orderId: string,
  payments: z.input<typeof paymentSchema>[],
): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = z
    .object({ orderId: idSchema, payments: z.array(paymentSchema).min(1).max(MAX_SPLIT) })
    .safeParse({ orderId, payments });
  if (!parsed.success) return fail("choosePayment");
  const result = await toResult(async () => {
    await repo.recordPayment(actor, parsed.data.orderId, parsed.data.payments);
    return undefined;
  });
  revalidatePath(`/b/${branchId}`, "layout");
  return result;
}

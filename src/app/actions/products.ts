"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ErrorKey } from "@/i18n";
import { parseRinggit } from "@/lib/money";
import { deleteProductImage, saveProductImage } from "@/server/image-storage";
import { repo } from "@/server/repository";
import { requireActor } from "@/server/session";
import { fail, toResult, type ActionResult } from "./result";

// Zod issue messages carry dictionary keys so errors can be shown in the user's language.
const price = z.string().transform((v, ctx) => {
  const sen = parseRinggit(v);
  if (sen === null) {
    ctx.addIssue({ code: "custom", message: "priceFormat" satisfies ErrorKey });
    return z.NEVER;
  }
  return sen;
});

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

const firstIssue = (error: z.ZodError) => {
  const message = error.issues[0]?.message;
  return fail(message === "priceFormat" || message === "nameRequired" ? message : "generic");
};

const createProductSchema = z.object({
  branchId: z.string().min(1),
  name: z.string().trim().min(1, "nameRequired").max(80),
  nameZh: optionalText(80),
  categoryId: z.string().transform((v) => v || null),
  description: optionalText(200),
  price,
});

export async function createProduct(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = createProductSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);
  const { price: priceSen, ...rest } = parsed.data;
  const result = await toResult(async () => {
    await repo.createProduct(actor, { ...rest, priceSen });
    return undefined;
  });
  revalidatePath(`/b/${parsed.data.branchId}`, "layout");
  return result;
}

const saveProductSchema = z.object({
  branchId: z.string().min(1),
  productId: z.string().min(1),
  name: z.string().trim().min(1, "nameRequired").max(80),
  nameZh: optionalText(80),
  price,
  isAvailable: z.string().optional().transform((v) => v === "on"),
  isActive: z.string().optional().transform((v) => v === "on"),
});

export async function saveProduct(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const actor = await requireActor();
  const parsed = saveProductSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);
  const { branchId, productId, name, nameZh, price: priceSen, isAvailable, isActive } = parsed.data;
  const result = await toResult(async () => {
    await repo.setBranchProduct(actor, { branchId, productId, priceSen, isAvailable });
    await repo.updateProduct(actor, productId, { name, nameZh, isActive });
    return undefined;
  });
  revalidatePath(`/b/${branchId}`, "layout");
  return result;
}

export async function uploadProductImage(form: FormData): Promise<ActionResult> {
  const actor = await requireActor();
  const branchId = String(form.get("branchId") ?? "");
  const productId = String(form.get("productId") ?? "");
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) return fail("imageMissing");

  return toResult(async () => {
    // Check permission before writing anything to storage.
    await repo.assertOwner(actor);
    const url = await saveProductImage(file);
    let previous: string | null;
    try {
      previous = await repo.setProductImage(actor, productId, url);
    } catch (error) {
      await deleteProductImage(url);
      throw error;
    }
    await deleteProductImage(previous);
    revalidatePath(`/b/${branchId}`, "layout");
    return undefined;
  });
}

export async function removeProductImage(branchId: string, productId: string): Promise<ActionResult> {
  const actor = await requireActor();
  return toResult(async () => {
    const previous = await repo.setProductImage(actor, productId, null);
    await deleteProductImage(previous);
    revalidatePath(`/b/${branchId}`, "layout");
    return undefined;
  });
}

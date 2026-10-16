"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { createProduct, removeProductImage, saveProduct, uploadProductImage } from "@/app/actions/products";
import { localName } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { resizeImage } from "@/lib/image-resize";
import { senToInput } from "@/lib/money";
import type { AdminProductRow, Category } from "@/server/domain";

const input = "rounded-xl border border-[var(--border)] bg-white px-3 py-2.5";

export function NewProductForm({ branchId, categories }: { branchId: string; categories: Category[] }) {
  const { t, locale } = useI18n();
  const [state, action, pending] = useActionState(createProduct, null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm">
      <h2 className="mb-3 font-bold">{t.products.add}</h2>
      <input type="hidden" name="branchId" value={branchId} />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[2fr_2fr_1fr_1fr_auto]">
        <input name="name" required placeholder={t.products.name} className={input} />
        <input name="nameZh" placeholder={t.products.nameZh} className={input} />
        <select name="categoryId" className={input} defaultValue="">
          <option value="">{t.products.noCategory}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {localName(locale, c)}
            </option>
          ))}
        </select>
        <input name="price" required inputMode="decimal" placeholder={t.products.pricePlaceholder} className={input} />
        <button disabled={pending} className="rounded-xl bg-[var(--primary)] px-5 py-2.5 font-semibold text-white disabled:opacity-50">
          {t.products.addButton}
        </button>
      </div>
      <input name="description" placeholder={t.products.description} className={`${input} mt-2 w-full`} />
      {state && !state.ok && <p className="mt-2 text-sm text-red-700">{state.error}</p>}
    </form>
  );
}

export function ProductRow({ branchId, row }: { branchId: string; row: AdminProductRow }) {
  const { t, locale } = useI18n();
  const [state, action, pending] = useActionState(saveProduct, null);
  const { product } = row;

  return (
    <div
      className={`flex flex-col gap-4 rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm sm:flex-row ${
        product.isActive ? "" : "opacity-60"
      }`}
    >
      <ProductPhoto branchId={branchId} productId={product.id} imageUrl={product.imageUrl} />

      <form action={action} className="flex min-w-0 flex-1 flex-col gap-2">
        <input type="hidden" name="branchId" value={branchId} />
        <input type="hidden" name="productId" value={product.id} />
        <div className="grid gap-2 sm:grid-cols-2">
          <input name="name" required defaultValue={product.name} aria-label={t.products.name} placeholder={t.products.name} className={input} />
          <input
            name="nameZh"
            defaultValue={product.nameZh ?? ""}
            aria-label={t.products.nameZh}
            placeholder={t.products.nameZh}
            className={input}
          />
        </div>
        <p className="text-sm text-[var(--muted)]">
          {row.categoryName ? localName(locale, { name: row.categoryName, nameZh: row.categoryNameZh }) : t.products.noCategory}
          {row.branchPriceSen === null && ` · ${t.products.notSoldHere}`}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2">
            <span className="text-sm text-[var(--muted)]">RM</span>
            <input
              name="price"
              required
              inputMode="decimal"
              defaultValue={row.branchPriceSen === null ? "" : senToInput(row.branchPriceSen)}
              className={`${input} w-24`}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isAvailable" defaultChecked={row.isAvailable} className="h-5 w-5" />
            {t.products.availableHere}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={product.isActive} className="h-5 w-5" />
            {t.products.enabled}
          </label>
          <button disabled={pending} className="ml-auto rounded-xl bg-slate-100 px-5 py-2.5 font-semibold disabled:opacity-50">
            {pending ? t.products.saving : state?.ok ? t.products.saved : t.products.save}
          </button>
        </div>
        {state && !state.ok && <p className="text-sm text-red-700">{state.error}</p>}
      </form>
    </div>
  );
}

function ProductPhoto({ branchId, productId, imageUrl }: { branchId: string; productId: string; imageUrl: string | null }) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onFile(file: File | undefined) {
    if (!file) return;
    startTransition(async () => {
      setError(null);
      let resized: Blob;
      try {
        resized = await resizeImage(file);
      } catch {
        setError(t.products.photoReadFailed);
        return;
      }
      const form = new FormData();
      form.set("branchId", branchId);
      form.set("productId", productId);
      form.set("image", resized, "photo.jpg");
      const result = await uploadProductImage(form);
      if (!result.ok) setError(result.error);
    });
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="flex shrink-0 flex-row items-center gap-3 sm:w-36 sm:flex-col sm:items-stretch">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={pending}
        aria-label={imageUrl ? t.products.changePhoto : t.products.uploadPhoto}
        className="relative flex aspect-[4/3] w-28 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-[var(--border)] bg-slate-50 text-sm text-[var(--muted)] sm:w-full"
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="px-2 text-center">📷 {t.products.uploadPhoto}</span>
        )}
        {pending && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/80 font-semibold">{t.products.uploading}</span>
        )}
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      <div className="flex flex-col gap-1 text-sm sm:flex-row sm:justify-between">
        {imageUrl && (
          <>
            <button type="button" disabled={pending} onClick={() => fileRef.current?.click()} className="text-[var(--primary)]">
              {t.products.changePhoto}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await removeProductImage(branchId, productId);
                  setError(result.ok ? null : result.error);
                })
              }
              className="text-red-700"
            >
              {t.products.removePhoto}
            </button>
          </>
        )}
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

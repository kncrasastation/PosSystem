import { getDictionary, type ErrorKey } from "@/i18n";
import { getLocale } from "@/i18n/server";
import { isDomainError } from "@/server/domain";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** A failed result with the message in the user's language. */
export async function fail(key: ErrorKey, params: Record<string, string> = {}): Promise<{ ok: false; error: string }> {
  return { ok: false, error: getDictionary(await getLocale()).errors[key](params) };
}

/** Converts domain errors into translated results; unexpected errors are logged, not leaked. */
export async function toResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (isDomainError(error)) return fail(error.key, error.params);
    console.error(error);
    return fail("generic");
  }
}

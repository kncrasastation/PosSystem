import { parseRinggit, senToInput, splitEvenly } from "@/lib/money";
import type { ItemAllocation, PaymentInput, PaymentMethod } from "@/server/domain";

// Display-side payment calculations for the POS. The server recomputes every share and
// change from its own prices; these only drive what staff see before submitting.

export type SplitMode = "EVEN" | "ITEMS";

export interface PayerDraft {
  method: PaymentMethod | null;
  cashInput: string;
}

export interface PaymentDraft {
  mode: SplitMode;
  payers: PayerDraft[];
  /** Split by item: payer index per unit, keyed by product id (-1 or missing = unassigned). */
  assignments: Record<string, number[]>;
}

export interface PaymentLine {
  productId: string;
  priceSen: number;
  quantity: number;
}

export interface PayerState extends PayerDraft {
  shareSen: number;
  /** null when no cash amount was entered (exact) or the payer isn't paying cash. */
  cashReceivedSen: number | null;
  invalid: boolean;
  changeSen: number | null;
  short: boolean;
  allocations: ItemAllocation[] | null;
}

export const emptyPayer = (): PayerDraft => ({ method: null, cashInput: "" });
export const emptyPayment = (): PaymentDraft => ({ mode: "EVEN", payers: [emptyPayer()], assignments: {} });

/**
 * Payer index for each unit of each line. Tolerates a cart or payer count that changed
 * after assigning: new units and units of removed payers come back as unassigned (-1).
 */
export function unitAssignments(draft: PaymentDraft, lines: PaymentLine[]): number[][] {
  return lines.map((line) =>
    Array.from({ length: line.quantity }, (_, unit) => {
      const payer = draft.assignments[line.productId]?.[unit] ?? -1;
      return payer < draft.payers.length ? payer : -1;
    }),
  );
}

export function evaluatePayment(draft: PaymentDraft, lines: PaymentLine[]) {
  const totalSen = lines.reduce((sum, l) => sum + l.priceSen * l.quantity, 0);
  const byItem = draft.mode === "ITEMS" && draft.payers.length > 1;
  const units = unitAssignments(draft, lines);
  const unassigned = byItem ? units.flat().filter((p) => p < 0).length : 0;

  const allocationsFor = (payer: number): ItemAllocation[] =>
    units.flatMap((unitPayers, lineIndex) => {
      const quantity = unitPayers.filter((p) => p === payer).length;
      return quantity > 0 ? [{ lineIndex, quantity }] : [];
    });

  const shares = byItem
    ? draft.payers.map((_, i) =>
        allocationsFor(i).reduce((sum, a) => sum + lines[a.lineIndex].priceSen * a.quantity, 0),
      )
    : splitEvenly(totalSen, draft.payers.length);

  const payers: PayerState[] = draft.payers.map((payer, i) => {
    const typed = payer.method === "CASH" && payer.cashInput.trim() !== "";
    const cashReceivedSen = typed ? parseRinggit(payer.cashInput) : null;
    const changeSen = cashReceivedSen === null ? null : cashReceivedSen - shares[i];
    return {
      ...payer,
      shareSen: shares[i],
      cashReceivedSen,
      invalid: typed && cashReceivedSen === null,
      changeSen,
      short: changeSen !== null && changeSen < 0,
      allocations: byItem ? allocationsFor(i) : null,
    };
  });

  const emptyPayer = byItem && payers.some((p) => p.allocations!.length === 0);
  const methodMissing = payers.some((p) => !p.method);
  const blocked = methodMissing || unassigned > 0 || emptyPayer || payers.some((p) => p.short || p.invalid);

  const payload: PaymentInput[] = payers.map((p) => ({
    method: p.method ?? "CASH",
    cashReceivedSen: p.cashReceivedSen,
    allocations: p.allocations,
  }));

  return { totalSen, byItem, units, unassigned, emptyPayer, methodMissing, blocked, payers, payload };
}

/** Assign one unit of a product to a payer (or unassign with -1). */
export function assignUnit(draft: PaymentDraft, productId: string, unit: number, payer: number): PaymentDraft {
  const current = [...(draft.assignments[productId] ?? [])];
  while (current.length <= unit) current.push(-1);
  current[unit] = payer;
  return { ...draft, assignments: { ...draft.assignments, [productId]: current } };
}

/** Malaysian ringgit notes offered as quick-tap buttons, in sen. */
export const CASH_NOTES_SEN = [100, 500, 1000, 2000, 5000, 10000] as const;

/**
 * Adds a tapped note to the cash received, so tapping 50 twice gives 100.00.
 * An empty or unreadable amount starts from zero.
 */
export function addNote(cashInput: string, noteSen: number): string {
  const current = parseRinggit(cashInput) ?? 0;
  return senToInput(current + noteSen);
}

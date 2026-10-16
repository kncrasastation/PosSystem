import { describe, expect, it } from "vitest";
import { addNote, assignUnit, emptyPayer, emptyPayment, evaluatePayment, type PaymentDraft } from "./payment-logic";

const lines = [
  { productId: "chicken-rice", priceSen: 800, quantity: 1 },
  { productId: "chop", priceSen: 950, quantity: 1 },
  { productId: "teh", priceSen: 250, quantity: 2 },
];

const threePeople = (): PaymentDraft => ({
  ...emptyPayment(),
  mode: "ITEMS",
  payers: [emptyPayer(), emptyPayer(), emptyPayer()].map((p) => ({ ...p, method: "QR" as const })),
});

describe("split by item", () => {
  it("A pays RM 8, B pays RM 9.50, C pays the two drinks", () => {
    let draft = threePeople();
    draft = assignUnit(draft, "chicken-rice", 0, 0);
    draft = assignUnit(draft, "chop", 0, 1);
    draft = assignUnit(draft, "teh", 0, 2);
    draft = assignUnit(draft, "teh", 1, 2);
    const result = evaluatePayment(draft, lines);
    expect(result.payers.map((p) => p.shareSen)).toEqual([800, 950, 500]);
    expect(result.unassigned).toBe(0);
    expect(result.blocked).toBe(false);
    expect(result.payload[2].allocations).toEqual([{ lineIndex: 2, quantity: 2 }]);
  });

  it("blocks submission while items are unassigned or a person has nothing", () => {
    let draft = threePeople();
    draft = assignUnit(draft, "chicken-rice", 0, 0);
    expect(evaluatePayment(draft, lines)).toMatchObject({ unassigned: 3, blocked: true });

    draft = assignUnit(draft, "chop", 0, 0);
    draft = assignUnit(draft, "teh", 0, 1);
    draft = assignUnit(draft, "teh", 1, 1);
    expect(evaluatePayment(draft, lines)).toMatchObject({ unassigned: 0, emptyPayer: true, blocked: true });
  });

  it("unassigns units of a removed person and units added after assigning", () => {
    let draft = threePeople();
    draft = assignUnit(draft, "teh", 0, 2);
    draft = { ...draft, payers: draft.payers.slice(0, 2) };
    const more = lines.map((l) => (l.productId === "teh" ? { ...l, quantity: 3 } : l));
    expect(evaluatePayment(draft, more).units[2]).toEqual([-1, -1, -1]);
  });

  it("even mode ignores assignments and splits the total", () => {
    const draft = { ...threePeople(), mode: "EVEN" as const };
    const result = evaluatePayment(draft, lines);
    expect(result.payers.map((p) => p.shareSen)).toEqual([750, 750, 750]);
    expect(result.payload.every((p) => p.allocations === null)).toBe(true);
  });
});

describe("cash note buttons", () => {
  it("tapping 50 twice for a RM 95.00 bill gives RM 100.00 received, RM 5.00 change", () => {
    let input = "";
    input = addNote(input, 5000);
    input = addNote(input, 5000);
    expect(input).toBe("100.00");
    const draft: PaymentDraft = { ...emptyPayment(), payers: [{ method: "CASH", cashInput: input }] };
    const result = evaluatePayment(draft, [{ productId: "x", priceSen: 9500, quantity: 1 }]);
    expect(result.payers[0]).toMatchObject({ cashReceivedSen: 10000, changeSen: 500, short: false });
  });

  it("mixes notes and adds onto a typed amount", () => {
    expect([5000, 2000, 2000, 500].reduce((input, note) => addNote(input, note), "")).toBe("95.00");
    expect(addNote("3.50", 1000)).toBe("13.50");
    expect(addNote("abc", 100)).toBe("1.00");
  });
});

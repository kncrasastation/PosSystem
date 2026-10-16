import { describe, expect, it } from "vitest";
import { formatSen, parseRinggit, senToInput, splitEvenly } from "./money";
import { formatQuantity, parseQuantity } from "./quantity";

describe("money", () => {
  it("parses ringgit strings exactly", () => {
    expect(parseRinggit("8")).toBe(800);
    expect(parseRinggit("8.5")).toBe(850);
    expect(parseRinggit("0.10")).toBe(10);
    expect(parseRinggit("19.99")).toBe(1999);
  });

  it("rejects invalid input", () => {
    for (const bad of ["", "-1", "1.234", "abc", "1,000"]) expect(parseRinggit(bad)).toBeNull();
  });

  it("formats sen", () => {
    expect(formatSen(800)).toBe("RM 8.00");
    expect(formatSen(123456)).toBe("RM 1,234.56");
    expect(senToInput(850)).toBe("8.50");
  });
});

describe("quantity", () => {
  it("parses and formats base-unit quantities", () => {
    expect(parseQuantity("120")).toBe(120_000);
    expect(parseQuantity("1.5")).toBe(1_500);
    expect(formatQuantity(1_200_000, "g")).toBe("1,200 g");
    expect(formatQuantity(1_500, "ml")).toBe("1.5 ml");
  });
});

describe("splitEvenly", () => {
  it("splits exactly and never loses a sen", () => {
    expect(splitEvenly(1600, 2)).toEqual([800, 800]);
    expect(splitEvenly(1000, 3)).toEqual([334, 333, 333]);
    expect(splitEvenly(1, 3)).toEqual([1, 0, 0]);
    for (let total = 0; total < 500; total += 7) {
      for (let n = 1; n <= 10; n++) {
        const shares = splitEvenly(total, n);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
        expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
      }
    }
  });
});

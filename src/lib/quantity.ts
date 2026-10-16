// Ingredient quantities are held as integer thousandths of the base unit
// (e.g. 120 g = 120000), matching PostgreSQL numeric(14,3) exactly.

export type BaseUnit = "g" | "ml" | "pcs";

export const QTY_SCALE = 1000;

/** Parses "120" or "1.5" (base units, up to 3 decimals) into scaled integer. */
export function parseQuantity(input: string): number | null {
  const match = /^\s*(\d{1,10})(?:\.(\d{1,3}))?\s*$/.exec(input);
  if (!match) return null;
  return Number(match[1]) * QTY_SCALE + Number((match[2] ?? "").padEnd(3, "0"));
}

export function formatQuantity(scaled: number, unit: BaseUnit): string {
  const sign = scaled < 0 ? "-" : "";
  const abs = Math.abs(scaled);
  const whole = Math.trunc(abs / QTY_SCALE).toLocaleString("en-MY");
  const fraction = String(abs % QTY_SCALE).padStart(3, "0").replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""} ${unit}`;
}

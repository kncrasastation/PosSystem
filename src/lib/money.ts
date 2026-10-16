// Money is held as integer sen (1 RM = 100 sen). Never use floating point for money.

/** Parses a ringgit string like "8", "8.5" or "8.50" into integer sen. Returns null if invalid. */
export function parseRinggit(input: string): number | null {
  const match = /^\s*(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  return whole * 100 + fraction;
}

export function formatSen(sen: number): string {
  const sign = sen < 0 ? "-" : "";
  const abs = Math.abs(sen);
  const whole = Math.trunc(abs / 100).toLocaleString("en-MY");
  const fraction = String(abs % 100).padStart(2, "0");
  return `${sign}RM ${whole}.${fraction}`;
}

/** Plain "8.50" form for editable inputs. */
export function senToInput(sen: number): string {
  return `${Math.trunc(sen / 100)}.${String(sen % 100).padStart(2, "0")}`;
}

/**
 * Splits a total evenly between `people` payers in whole sen. Leftover sen go to the
 * first payers, so shares always add up exactly: 1000 / 3 → [334, 333, 333].
 * Used by both the POS display and the server, which is authoritative.
 */
export function splitEvenly(totalSen: number, people: number): number[] {
  const base = Math.floor(totalSen / people);
  const remainder = totalSen - base * people;
  return Array.from({ length: people }, (_, i) => base + (i < remainder ? 1 : 0));
}

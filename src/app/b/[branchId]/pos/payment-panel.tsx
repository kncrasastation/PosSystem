"use client";

import { useI18n } from "@/i18n/client";
import { formatSen, senToInput } from "@/lib/money";
import { MAX_SPLIT, PAYMENT_METHODS } from "@/server/domain";
import {
  addNote,
  assignUnit,
  CASH_NOTES_SEN,
  emptyPayer,
  evaluatePayment,
  type PayerDraft,
  type PayerState,
  type PaymentDraft,
  type PaymentLine,
  type SplitMode,
} from "./payment-logic";

export interface DisplayLine extends PaymentLine {
  name: string;
  secondaryName: string | null;
}

interface PaymentPanelProps {
  draft: PaymentDraft;
  lines: DisplayLine[];
  onChange: (draft: PaymentDraft) => void;
}

export function PaymentPanel({ draft, lines, onChange }: PaymentPanelProps) {
  const { t } = useI18n();
  const result = evaluatePayment(draft, lines);
  const split = draft.payers.length > 1;

  // Resizing keeps what earlier payers already chose.
  const setPeople = (n: number) => {
    const count = Math.max(1, Math.min(MAX_SPLIT, n));
    onChange({ ...draft, payers: Array.from({ length: count }, (_, i) => draft.payers[i] ?? emptyPayer()) });
  };
  const setMode = (mode: SplitMode) => onChange({ ...draft, mode });
  const updatePayer = (index: number, patch: Partial<PayerDraft>) =>
    onChange({ ...draft, payers: draft.payers.map((p, i) => (i === index ? { ...p, ...patch } : p)) });

  const shares = result.payers.map((p) => p.shareSen);
  const allEqual = shares.every((s) => s === shares[0]);

  // What each payer is paying for, shown on their card in by-item mode.
  const itemsFor = (payerIndex: number) =>
    result.payers[payerIndex].allocations
      ?.map((a) => (a.quantity > 1 ? `${lines[a.lineIndex].name} ×${a.quantity}` : lines[a.lineIndex].name))
      .join(", ") ?? null;

  return (
    <div className="mt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--muted)]">{t.pos.payment}</p>
        <button
          type="button"
          aria-pressed={split}
          onClick={() => setPeople(split ? 1 : 2)}
          className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
            split ? "bg-[var(--foreground)] text-white" : "border border-[var(--border)] bg-white"
          }`}
        >
          {t.pos.splitBill}
        </button>
      </div>

      {split && (
        <div className="mb-2 space-y-2 rounded-xl bg-slate-100 p-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={t.pos.decrease}
                onClick={() => setPeople(draft.payers.length - 1)}
                disabled={draft.payers.length <= 2}
                className="h-10 w-10 rounded-lg bg-white text-xl font-bold shadow-sm disabled:opacity-40"
              >
                −
              </button>
              <span className="min-w-16 text-center font-bold">{t.pos.people(draft.payers.length)}</span>
              <button
                type="button"
                aria-label={t.pos.increase}
                onClick={() => setPeople(draft.payers.length + 1)}
                disabled={draft.payers.length >= MAX_SPLIT}
                className="h-10 w-10 rounded-lg bg-white text-xl font-bold shadow-sm disabled:opacity-40"
              >
                +
              </button>
            </div>
            {!result.byItem && result.totalSen > 0 && (
              <span className="text-right font-bold tabular-nums">
                {allEqual ? t.pos.each(formatSen(shares[0])) : `${formatSen(shares[0])} / ${formatSen(shares[shares.length - 1])}`}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-white p-1">
            {(["EVEN", "ITEMS"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={draft.mode === mode}
                onClick={() => setMode(mode)}
                className={`rounded-md py-2 text-sm font-semibold ${draft.mode === mode ? "bg-[var(--foreground)] text-white" : ""}`}
              >
                {mode === "EVEN" ? t.pos.splitEven : t.pos.splitByItem}
              </button>
            ))}
          </div>
        </div>
      )}

      {result.byItem && (
        <ItemAssigner draft={draft} lines={lines} units={result.units} unassigned={result.unassigned} onChange={onChange} />
      )}

      <div className={split ? "space-y-2" : ""}>
        {result.payers.map((payer, i) => (
          <PayerCard
            key={i}
            label={split ? t.pos.person(i + 1) : null}
            items={result.byItem ? itemsFor(i) : null}
            payer={payer}
            noItems={result.byItem && payer.allocations!.length === 0}
            onChange={(patch) => updatePayer(i, patch)}
          />
        ))}
      </div>
    </div>
  );
}

/** One row per unit (2× Fried Rice = 2 rows); tap the number of the person who had it. */
function ItemAssigner({
  draft,
  lines,
  units,
  unassigned,
  onChange,
}: {
  draft: PaymentDraft;
  lines: DisplayLine[];
  units: number[][];
  unassigned: number;
  onChange: (draft: PaymentDraft) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mb-2 rounded-xl border border-[var(--border)] p-2">
      <p className="mb-1.5 text-sm text-[var(--muted)]">{t.pos.assignHint}</p>
      <ul className="max-h-64 space-y-1.5 overflow-y-auto">
        {lines.flatMap((line, lineIndex) =>
          units[lineIndex].map((payer, unit) => (
            <li key={`${line.productId}-${unit}`} className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{line.name}</span>
                <span className="block text-xs text-[var(--muted)] tabular-nums">
                  {formatSen(line.priceSen)}
                  {line.secondaryName && ` · ${line.secondaryName}`}
                </span>
              </span>
              <span className="flex shrink-0 flex-wrap justify-end gap-1">
                {draft.payers.map((_, p) => (
                  <button
                    key={p}
                    type="button"
                    aria-label={t.pos.person(p + 1)}
                    aria-pressed={payer === p}
                    onClick={() => onChange(assignUnit(draft, line.productId, unit, payer === p ? -1 : p))}
                    className={`h-9 w-9 rounded-lg text-sm font-bold ${
                      payer === p ? "bg-[var(--primary)] text-white" : "bg-slate-100"
                    }`}
                  >
                    {p + 1}
                  </button>
                ))}
              </span>
            </li>
          )),
        )}
      </ul>
      {unassigned > 0 && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-sm font-medium text-amber-900">{t.pos.unassigned(unassigned)}</p>
      )}
    </div>
  );
}

function PayerCard({
  label,
  items,
  payer,
  noItems,
  onChange,
}: {
  label: string | null;
  items: string | null;
  payer: PayerState;
  noItems: boolean;
  onChange: (patch: Partial<PayerDraft>) => void;
}) {
  const { t } = useI18n();
  const compact = label !== null;

  return (
    <div className={compact ? `rounded-xl border p-2.5 ${noItems ? "border-amber-300" : "border-[var(--border)]"}` : ""}>
      {label && (
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="min-w-0">
            <span className="font-semibold">{label}</span>
            {items && <span className="block truncate text-sm text-[var(--muted)]">{items}</span>}
          </span>
          <span className="shrink-0 text-lg font-bold tabular-nums">{formatSen(payer.shareSen)}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {PAYMENT_METHODS.map((method) => (
          <button
            key={method}
            type="button"
            aria-pressed={payer.method === method}
            onClick={() => onChange({ method, cashInput: method === "CASH" ? payer.cashInput : "" })}
            className={`rounded-xl border-2 font-bold ${compact ? "py-2" : "py-3 text-lg"} ${
              payer.method === method ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-[var(--border)] bg-white"
            }`}
          >
            {t.paymentMethod[method]}
          </button>
        ))}
      </div>

      {payer.method === "CASH" && payer.shareSen > 0 && (
        <div className="mt-2 rounded-xl bg-slate-50 p-2.5">
          <label className="flex items-center gap-2">
            <span className="shrink-0 text-sm font-semibold text-[var(--muted)]">{t.pos.cashReceived}</span>
            <span className="ml-auto text-sm text-[var(--muted)]">RM</span>
            <input
              value={payer.cashInput}
              onChange={(e) => onChange({ cashInput: e.target.value })}
              inputMode="decimal"
              placeholder={senToInput(payer.shareSen)}
              className="w-28 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-right text-lg font-bold"
            />
          </label>
          {/* Each note tap adds to the amount: 50 + 50 = 100. */}
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            <button
              type="button"
              onClick={() => onChange({ cashInput: senToInput(payer.shareSen) })}
              className="rounded-lg bg-white py-2.5 text-sm font-semibold shadow-sm"
            >
              {t.pos.exact}
            </button>
            {CASH_NOTES_SEN.map((note) => (
              <button
                key={note}
                type="button"
                aria-label={t.pos.addNote(note / 100)}
                onClick={() => onChange({ cashInput: addNote(payer.cashInput, note) })}
                className="rounded-lg border border-emerald-200 bg-white py-2.5 text-base font-bold text-emerald-900 shadow-sm active:bg-emerald-50"
              >
                {note / 100}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onChange({ cashInput: "" })}
              disabled={!payer.cashInput}
              className="rounded-lg bg-white py-2.5 text-sm font-semibold text-[var(--muted)] shadow-sm disabled:opacity-40"
            >
              {t.pos.clear}
            </button>
          </div>
          {payer.changeSen !== null && (
            <div
              className={`mt-2 flex items-baseline justify-between rounded-lg px-3 py-2 ${
                payer.short ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-900"
              }`}
            >
              <span className="font-semibold">{payer.short ? t.pos.short : t.pos.change}</span>
              <span className={`${compact ? "text-xl" : "text-2xl"} font-bold tabular-nums`}>
                {formatSen(Math.abs(payer.changeSen))}
              </span>
            </div>
          )}
          {payer.invalid && <p className="mt-2 text-sm text-red-700">{t.pos.invalidCash}</p>}
        </div>
      )}
    </div>
  );
}

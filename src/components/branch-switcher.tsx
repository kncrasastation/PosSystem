"use client";

import { usePathname, useRouter } from "next/navigation";

export function BranchSwitcher({ branches, current }: { branches: { id: string; name: string }[]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <select
      aria-label="Branch"
      className="rounded-xl border border-[var(--border)] bg-white px-3 py-2 font-semibold"
      value={current}
      onChange={(e) => router.push(pathname.replace(`/b/${current}`, `/b/${e.target.value}`))}
    >
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}

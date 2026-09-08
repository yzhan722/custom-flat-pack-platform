import type { RuleResult } from "@cfp/core";
import { SeverityBadge } from "./Badges";

const CATEGORY_LABEL: Record<string, string> = {
  purpose: "Intended use",
  catalog: "Catalogue",
  configuration: "Configuration",
  measurement: "Measurement and fit",
  geometry: "Geometry",
  structure: "Structure and stability",
  manufacturing: "Manufacturing",
  assembly: "Assembly",
  fulfilment: "Delivery and packaging",
};

/**
 * Rule results grouped by severity. Blocking items first, then review items,
 * then a collapsed list of everything that passed so a reviewer can see exactly
 * which checks ran (FR-05).
 */
export function RuleReport({ results, compiled, showPassed = true }: { results: RuleResult[]; compiled: boolean; showPassed?: boolean }) {
  const blocking = results.filter((r) => r.severity === "UNSUPPORTED");
  const review = results.filter((r) => r.severity === "REVIEW_REQUIRED");
  const passed = results.filter((r) => r.severity === "PASS");
  return (
    <div className="space-y-3 text-sm">
      {!compiled && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-900">
          The configuration could not be compiled, so geometry, structure, manufacturing and delivery checks have not run yet. Fix the items below first.
        </p>
      )}
      {blocking.length > 0 && <Group title="Must be resolved" items={blocking} tone="bad" />}
      {review.length > 0 && <Group title="Engineering will review" items={review} tone="warn" />}
      {blocking.length === 0 && review.length === 0 && compiled && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">All automated checks passed. Engineering approval is still required before production.</p>
      )}
      {showPassed && passed.length > 0 && (
        <details className="rounded-md border border-line bg-stone-50">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">{passed.length} checks passed</summary>
          <ul className="divide-y divide-stone-200 px-3 pb-2">
            {passed.map((r, i) => (
              <li key={`${r.ruleId}-${i}`} className="flex gap-3 py-1.5 text-xs text-ink-soft">
                <span className="w-16 shrink-0 font-mono">{r.ruleId}</span>
                <span>{r.message}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Group({ title, items, tone }: { title: string; items: RuleResult[]; tone: "bad" | "warn" }) {
  const border = tone === "bad" ? "border-red-200" : "border-amber-200";
  return (
    <div className={`rounded-md border ${border} bg-white`}>
      <div className="flex items-center justify-between border-b border-inherit px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{title}</p>
        <SeverityBadge severity={tone === "bad" ? "UNSUPPORTED" : "REVIEW_REQUIRED"} />
      </div>
      <ul className="divide-y divide-stone-100">
        {items.map((r, i) => (
          <li key={`${r.ruleId}-${i}`} className="px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[11px] text-ink-soft">{r.ruleId}</span>
              <span className="text-[11px] uppercase tracking-wide text-ink-soft">{CATEGORY_LABEL[r.category] ?? r.category}</span>
            </div>
            <p className="mt-0.5">{r.message}</p>
            {r.suggestion && <p className="mt-0.5 text-ink-soft">→ {r.suggestion}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

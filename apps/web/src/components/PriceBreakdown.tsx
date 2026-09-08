import { Fragment } from "react";
import type { PriceBreakdown as Price } from "@cfp/core";
import { money } from "@/lib/format";

/** Itemised price with tax, delivery and what is / is not included (FR-06, §2.3). */
export function PriceBreakdown({ price, title = "Price", estimate = false, compact = false }: { price: Price; title?: string; estimate?: boolean; compact?: boolean }) {
  const groups: Array<{ key: Price["lines"][number]["group"]; label: string }> = [
    { key: "manufacturing", label: "Manufacturing" },
    { key: "service", label: "Engineering and service" },
    { key: "fulfilment", label: "Delivery" },
    { key: "margin", label: "Reserve and platform" },
  ];
  return (
    <div className="text-sm">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold">{title}</h3>
        {estimate && <span className="text-xs text-ink-soft">Reference estimate — the formal quote is issued after review</span>}
      </div>
      <div className="mt-2 flex items-baseline justify-between rounded-md bg-stone-900 px-3 py-2 text-white">
        <span>Total incl. GST{price.delivery_cents > 0 ? " and delivery" : ""}</span>
        <span className="text-xl font-semibold tabular-nums">{money(price.totalIncGst_cents)}</span>
      </div>
      {!compact && (
        <table className="table mt-3">
          <tbody>
            {groups.map((g) => {
              const lines = price.lines.filter((l) => l.group === g.key);
              if (!lines.length) return null;
              return (
                <Fragment key={g.key}>
                  <tr>
                    <td colSpan={2} className="pt-3 text-xs font-semibold uppercase tracking-wide text-ink-soft">{g.label}</td>
                  </tr>
                  {lines.map((l) => (
                    <tr key={l.code}>
                      <td>
                        {l.label}
                        {l.detail && <span className="ml-1 text-xs text-ink-soft">({l.detail})</span>}
                      </td>
                      <td className="text-right tabular-nums">{money(l.amount_cents)}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            <tr>
              <td className="pt-3 font-medium">Subtotal excl. GST</td>
              <td className="pt-3 text-right font-medium tabular-nums">{money(price.subtotalExGst_cents)}</td>
            </tr>
            <tr>
              <td>GST 10%</td>
              <td className="text-right tabular-nums">{money(price.gst_cents)}</td>
            </tr>
          </tbody>
        </table>
      )}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Included</p>
          <ul className="mt-1 list-disc pl-5 text-ink-soft">
            {price.includes.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Not included</p>
          <ul className="mt-1 list-disc pl-5 text-ink-soft">
            {price.excludes.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

import type { AssemblyGuide, CompiledCabinet, HardwareBom } from "@cfp/core";
import { Pill } from "./Badges";
import { mm } from "@/lib/format";

/**
 * Order-specific assembly guide (FR-11). Steps come from the approved recipe
 * bound to this order's panels and hardware; text is never generated freely.
 */
export function AssemblyGuideView({ guide, cabinet, bom, releaseKey }: { guide: AssemblyGuide; cabinet: CompiledCabinet; bom: HardwareBom; releaseKey: string | null }) {
  const panelById = new Map(cabinet.panels.map((p) => [p.id, p]));
  const hwName = (sku: string) => bom.lines.find((l) => l.sku === sku);
  return (
    <div className="space-y-6">
      <section className="card grid gap-4 md:grid-cols-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Before you start</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            <li>About {guide.estimatedMinutes} minutes, {guide.people} {guide.people > 1 ? "people" : "person"}.</li>
            <li>{guide.workspaceNote}</li>
            <li>Check every panel label and bag against the lists on the right before opening packages beyond the first.</li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Tools</p>
          <ul className="mt-1 list-disc pl-5 text-sm">{guide.tools.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Record</p>
          <p className="mt-1 text-sm">Recipe {guide.recipeId} v{guide.recipeVersion}</p>
          <p className="text-sm">{releaseKey ? `Release ${releaseKey}` : "Preview — not yet released"}</p>
          {cabinet.antiTipRequired && <Pill tone="warn">Wall restraint step included</Pill>}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ol className="space-y-4">
          {guide.steps.map((s) => (
            <li key={s.id} id={s.id} className={`card ${s.isSafetyCritical ? "border-amber-300" : ""}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold"><span className="mr-2 rounded bg-stone-900 px-2 py-0.5 text-xs text-white">Step {s.order}</span>{s.title}</h3>
                <span className="text-xs text-ink-soft">{s.titleZh} · {s.id}</span>
              </div>
              <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                <div>
                  <ol className="list-decimal space-y-1 pl-5 text-sm">{s.instructions.map((t) => <li key={t}>{t}</li>)}</ol>
                  {s.checks.length > 0 && (
                    <div className="mt-2 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Check before moving on</p>
                      <ul className="list-disc pl-5">{s.checks.map((c) => <li key={c}>{c}</li>)}</ul>
                    </div>
                  )}
                  {s.safety.length > 0 && (
                    <div className="mt-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900">
                      {s.safety.map((c) => <p key={c}>{c}</p>)}
                    </div>
                  )}
                </div>
                <div className="space-y-2 text-xs">
                  {s.panelIds.length > 0 && (
                    <div>
                      <p className="font-semibold uppercase tracking-wide text-ink-soft">Parts</p>
                      <ul className="mt-1 space-y-0.5">
                        {s.panelIds.map((id) => {
                          const p = panelById.get(id);
                          return p ? <li key={id}><span className="font-mono font-semibold">{p.label}</span> {p.name} · {mm(p.finished.length_um)} × {mm(p.finished.width_um)}</li> : <li key={id}>{id}</li>;
                        })}
                      </ul>
                    </div>
                  )}
                  {s.hardware.length > 0 && (
                    <div>
                      <p className="font-semibold uppercase tracking-wide text-ink-soft">Hardware</p>
                      <ul className="mt-1 space-y-0.5">
                        {s.hardware.map((h) => {
                          const line = hwName(h.sku);
                          return <li key={h.sku}><span className="font-mono font-semibold">{line?.bagCode ?? "?"}</span> {line?.name ?? h.sku} × {h.qty}</li>;
                        })}
                      </ul>
                    </div>
                  )}
                  {s.tools.length > 0 && <p><span className="font-semibold uppercase tracking-wide text-ink-soft">Tools:</span> {s.tools.join(", ")}</p>}
                  <p className="text-ink-soft">Orientation: {s.orientation}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <aside className="space-y-4">
          <section className="card text-xs">
            <h3 className="text-sm font-semibold">Panel list</h3>
            <table className="mt-2 w-full">
              <tbody>
                {cabinet.panels.map((p) => (
                  <tr key={p.id} className="border-b border-stone-100">
                    <td className="py-1 font-mono font-semibold">{p.label}</td>
                    <td className="py-1">{p.name}</td>
                    <td className="py-1 text-right tabular-nums">{mm(p.finished.length_um)} × {mm(p.finished.width_um)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card text-xs">
            <h3 className="text-sm font-semibold">Hardware bags</h3>
            <ul className="mt-2 space-y-1">
              {bom.bags.map((bag) => (
                <li key={bag.bagCode}>
                  <span className="font-mono font-semibold">{bag.bagCode}</span>: {bag.skus.map((sku) => { const l = hwName(sku); return `${l?.name ?? sku} × ${l?.qty ?? "?"}`; }).join("; ")}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

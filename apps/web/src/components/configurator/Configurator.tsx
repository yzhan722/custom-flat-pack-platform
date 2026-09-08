"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  describeDesignDiff,
  distributeModuleWidths,
  type DesignSpec,
  type MeasurementSet,
  type ModuleSpec,
  type Proposal,
  type PurposeDefinition,
  type Template,
} from "@cfp/core";
import type { LiveEvaluation } from "@/lib/engineering";
import { money } from "@/lib/format";
import { saveDesign, submitForReview } from "@/server/actions/customer";
import { CabinetViewer, type ViewPreset } from "../CabinetViewer";
import { ElevationDrawing } from "../ElevationDrawing";
import { PriceBreakdown } from "../PriceBreakdown";
import { RuleReport } from "../RuleReport";
import { SeverityBadge } from "../Badges";

export interface ConfiguratorProps {
  orderId: string;
  /** `?t=token` when the order was opened through its access link, so navigation keeps access. */
  tokenQuery: string;
  orderStatus: string;
  editable: boolean;
  savedVersion: number;
  initialDesign: DesignSpec;
  measurement: MeasurementSet | null;
  initialEvaluation: LiveEvaluation;
  templates: Template[];
  purposes: PurposeDefinition[];
  contact: { name: string; email: string; phone: string } | null;
}

type ProposalResponse = {
  proposal: Proposal;
  diff?: string[];
  priceBefore_cents?: number | null;
  priceAfter_cents?: number | null;
  next?: LiveEvaluation;
  error?: string;
};

export function Configurator(props: ConfiguratorProps) {
  const [design, setDesign] = useState<DesignSpec>(props.initialDesign);
  const [saved, setSaved] = useState<DesignSpec>(props.initialDesign);
  const [savedVersion, setSavedVersion] = useState(props.savedVersion);
  const [evaluation, setEvaluation] = useState<LiveEvaluation>(props.initialEvaluation);
  const [evaluating, setEvaluating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [view, setView] = useState<ViewPreset>("3d");
  const [doorsOpen, setDoorsOpen] = useState(false);
  const [showDims, setShowDims] = useState(true);
  const [tab, setTab] = useState<"3d" | "drawing">("3d");
  const [history, setHistory] = useState<DesignSpec[]>([]);

  const template = useMemo(() => props.templates.find((t) => t.id === design.templateId) ?? props.templates[0]!, [design.templateId, props.templates]);
  const dirty = JSON.stringify(design) !== JSON.stringify(saved);
  const antiTipRequired = design.finished.height_mm >= 686;

  // Live evaluation, debounced. Always the server's verdict and price (FR-06).
  const seq = useRef(0);
  useEffect(() => {
    if (JSON.stringify(design) === JSON.stringify(props.initialDesign) && evaluation === props.initialEvaluation) return;
    const mine = ++seq.current;
    setEvaluating(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/evaluate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ design, measurement: props.measurement }) });
        const data = (await res.json()) as LiveEvaluation;
        if (mine === seq.current) setEvaluation(data);
      } finally {
        if (mine === seq.current) setEvaluating(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [design]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback((next: DesignSpec) => {
    setHistory((h) => [...h.slice(-19), design]);
    setDesign(next);
    setSaveError(null);
  }, [design]);

  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setDesign(prev);
  };

  const setWidth = (width_mm: number) => {
    const dist = distributeModuleWidths(width_mm, design.modules.length, template.domain.moduleWidth_mm, template.domain.moduleCount);
    const modules = dist.ok ? design.modules.map((m, i) => ({ ...m, width_mm: dist.widths_mm[i]! })) : design.modules;
    update({ ...design, finished: { ...design.finished, width_mm }, modules });
  };

  const setModuleCount = (count: number) => {
    const dist = distributeModuleWidths(design.finished.width_mm, count, template.domain.moduleWidth_mm, template.domain.moduleCount);
    const proto = design.modules[0]!;
    const modules: ModuleSpec[] = Array.from({ length: count }, (_, i) => ({ ...(design.modules[i] ?? proto), width_mm: dist.ok ? dist.widths_mm[i]! : Math.round(design.finished.width_mm / count) }));
    update({ ...design, modules });
  };

  const setModule = (i: number, patch: Partial<ModuleSpec>) => {
    update({
      ...design,
      modules: design.modules.map((m, k) => {
        if (k !== i) return m;
        const next = { ...m, ...patch };
        if (next.kind === "open") {
          delete next.doorSwing;
          delete next.handle;
        } else {
          next.doorSwing = next.doorSwing ?? (next.width_mm >= 500 ? "double" : "left");
          next.handle = next.handle ?? "bar";
        }
        return next;
      }),
    });
  };

  const setTemplate = (t: Template) => {
    const kind = t.moduleKindsAllowed.includes("door") ? "door" : "open";
    const modules: ModuleSpec[] = design.modules.map((m) => {
      if (!t.moduleKindsAllowed.includes(m.kind)) {
        return kind === "door" ? { ...m, kind, doorSwing: m.width_mm >= 500 ? "double" : "left", handle: "bar" } : { kind: "open", width_mm: m.width_mm, shelfCount: m.shelfCount };
      }
      return m;
    });
    const purpose = t.supportedPurposes.includes(design.purpose) ? design.purpose : t.supportedPurposes[0]!;
    update({ ...design, templateId: t.id, templateVersion: t.version, modules, purpose });
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    const res = await saveDesign(props.orderId, design);
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.error ?? "Could not save.");
      return;
    }
    setSaved(design);
    setSavedVersion(res.version ?? savedVersion + 1);
  };

  const feasibleCounts = useMemo(() => {
    const out: number[] = [];
    for (let n = template.domain.moduleCount.min; n <= template.domain.moduleCount.max; n++) {
      const d = distributeModuleWidths(design.finished.width_mm, n, template.domain.moduleWidth_mm, template.domain.moduleCount);
      if (d.ok) out.push(n);
    }
    return out;
  }, [design.finished.width_mm, template]);

  const cabinet = evaluation.cabinet;
  const blocking = evaluation.results.filter((r) => r.severity === "UNSUPPORTED").length;
  const reviewCount = evaluation.results.filter((r) => r.severity === "REVIEW_REQUIRED").length;

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)_340px]">
      {/* ------------------------------------------------------------------ */}
      {/* Left: parameters                                                    */}
      {/* ------------------------------------------------------------------ */}
      <aside className="space-y-5">
        <section className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Your cabinet</h2>
            <span className="text-xs text-ink-soft">Version {savedVersion}{dirty ? " · unsaved" : ""}</span>
          </div>

          <fieldset disabled={!props.editable} className="space-y-4 disabled:opacity-60">
            <div>
              <span className="label">Template</span>
              <div className="grid grid-cols-2 gap-2">
                {props.templates.map((t) => (
                  <button key={t.id} type="button" onClick={() => setTemplate(t)} className={`rounded-md border px-3 py-2 text-left text-sm ${t.id === design.templateId ? "border-brand bg-brand-soft/40" : "border-line bg-white hover:bg-stone-50"}`}>
                    <span className="block font-medium">{t.code === "O" ? "Open shelves" : "Doors"}</span>
                    <span className="block text-xs text-ink-soft">{t.code === "O" ? "Everything visible" : "Doors, may mix with open"}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="purpose">Intended use</label>
              <select id="purpose" className="input" value={design.purpose} onChange={(e) => update({ ...design, purpose: e.target.value as DesignSpec["purpose"] })}>
                {props.purposes.filter((p) => p.supported).map((p) => (
                  <option key={p.id} value={p.id} disabled={!template.supportedPurposes.includes(p.id)}>
                    {p.label}{!template.supportedPurposes.includes(p.id) ? " (other template)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-3">
                <label className="label" htmlFor="width">Overall width (mm)</label>
                <div className="flex items-center gap-2">
                  <input id="width" type="range" min={template.domain.width_mm.min} max={template.domain.width_mm.max} step={10} value={design.finished.width_mm} onChange={(e) => setWidth(Number(e.target.value))} className="flex-1 accent-brand" />
                  <input type="number" className="input w-24" min={template.domain.width_mm.min} max={template.domain.width_mm.max} value={design.finished.width_mm} onChange={(e) => setWidth(Number(e.target.value) || 0)} />
                </div>
                <p className="mt-1 text-xs text-ink-soft">{template.domain.width_mm.min}–{template.domain.width_mm.max} mm, whole millimetres. This is the outside width of the finished cabinet.</p>
              </div>
              <div>
                <label className="label" htmlFor="height">Height</label>
                <select id="height" className="input" value={design.finished.height_mm} onChange={(e) => update({ ...design, finished: { ...design.finished, height_mm: Number(e.target.value) } })}>
                  {template.domain.heights_mm.map((h) => <option key={h} value={h}>{h} mm</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="depth">Depth</label>
                <select id="depth" className="input" value={design.finished.depth_mm} onChange={(e) => update({ ...design, finished: { ...design.finished, depth_mm: Number(e.target.value) } })}>
                  {template.domain.depths_mm.map((d) => <option key={d} value={d}>{d} mm</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="modules">Modules</label>
                <select id="modules" className="input" value={design.modules.length} onChange={(e) => setModuleCount(Number(e.target.value))}>
                  {[1, 2, 3].map((n) => <option key={n} value={n} disabled={!feasibleCounts.includes(n)}>{n}{!feasibleCounts.includes(n) ? " (width)" : ""}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <span className="label">Module details</span>
              {design.modules.map((m, i) => (
                <div key={i} className="rounded-md border border-line bg-stone-50 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Module {i + 1}</span>
                    <span className="text-xs text-ink-soft">{m.width_mm} mm wide</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="text-xs">
                      <span className="label">Type</span>
                      <select className="input" value={m.kind} onChange={(e) => setModule(i, { kind: e.target.value as ModuleSpec["kind"] })}>
                        <option value="open">Open</option>
                        <option value="door" disabled={!template.moduleKindsAllowed.includes("door")}>Door</option>
                      </select>
                    </label>
                    <label className="text-xs">
                      <span className="label">Shelves</span>
                      <select className="input" value={m.shelfCount} onChange={(e) => setModule(i, { shelfCount: Number(e.target.value) })}>
                        {[0, 1, 2].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                    {m.kind === "door" && (
                      <>
                        <label className="text-xs">
                          <span className="label">Door</span>
                          <select className="input" value={m.doorSwing ?? "left"} onChange={(e) => setModule(i, { doorSwing: e.target.value as ModuleSpec["doorSwing"] })}>
                            <option value="left">One door, hinged left</option>
                            <option value="right">One door, hinged right</option>
                            <option value="double">Two doors</option>
                          </select>
                        </label>
                        <label className="text-xs">
                          <span className="label">Handle</span>
                          <select className="input" value={m.handle ?? "bar"} onChange={(e) => setModule(i, { handle: e.target.value as ModuleSpec["handle"] })}>
                            <option value="bar">Bar handle</option>
                            <option value="none">No handle (grip the edge)</option>
                          </select>
                        </label>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div>
              <span className="label">Top panel</span>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {(["single", "per_module"] as const).map((style) => (
                  <button key={style} type="button" onClick={() => update({ ...design, topPanelStyle: style })} className={`rounded-md border px-3 py-2 text-left ${design.topPanelStyle === style ? "border-brand bg-brand-soft/40" : "border-line bg-white hover:bg-stone-50"}`}>
                    <span className="block font-medium">{style === "single" ? "One piece" : "Per module"}</span>
                    <span className="block text-xs text-ink-soft">{style === "single" ? "Continuous top; long package" : "Visible seams; smaller packages"}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2 border-t border-line pt-4">
              <span className="label">Delivery and installation</span>
              <div className="grid grid-cols-2 gap-2">
                <select className="input" value={design.installation.deliveryMethod} onChange={(e) => update({ ...design, installation: { ...design.installation, deliveryMethod: e.target.value as "local_delivery" | "pickup" } })}>
                  <option value="local_delivery">Local delivery</option>
                  <option value="pickup">Pickup from factory</option>
                </select>
                <input className="input" placeholder="Postcode" value={design.installation.deliveryPostcode} onChange={(e) => update({ ...design, installation: { ...design.installation, deliveryPostcode: e.target.value } })} />
              </div>
              <select className="input" value={design.installation.wallType} onChange={(e) => update({ ...design, installation: { ...design.installation, wallType: e.target.value as DesignSpec["installation"]["wallType"] } })}>
                <option value="unknown">Wall type: unknown</option>
                <option value="masonry">Wall type: brick / masonry</option>
                <option value="plasterboard_on_stud">Wall type: plasterboard on timber/steel studs</option>
                <option value="plasterboard_unknown_structure">Wall type: plasterboard, structure unknown</option>
                <option value="not_required">No wall restraint wanted</option>
              </select>
              {antiTipRequired && (
                <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                  <input type="checkbox" className="mt-0.5" checked={design.installation.antiTipAcknowledged} onChange={(e) => update({ ...design, installation: { ...design.installation, antiTipAcknowledged: e.target.checked } })} />
                  <span>At {design.finished.height_mm} mm this cabinet must be restrained to the wall with the supplied kit. Wall fixings are not included because they depend on your wall. I understand.</span>
                </label>
              )}
            </div>
          </fieldset>
        </section>

        <NaturalLanguagePanel design={design} measurement={props.measurement} editable={props.editable} onApply={(next) => update(next)} />
      </aside>

      {/* ------------------------------------------------------------------ */}
      {/* Centre: preview                                                     */}
      {/* ------------------------------------------------------------------ */}
      <section className="space-y-4">
        <div className="card p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 text-sm">
            <div className="flex gap-1">
              <button type="button" className={`btn-sm ${tab === "3d" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("3d")}>3D</button>
              <button type="button" className={`btn-sm ${tab === "drawing" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("drawing")}>Drawing</button>
            </div>
            {tab === "3d" && (
              <div className="flex flex-wrap items-center gap-1">
                {(["3d", "front", "side", "top"] as ViewPreset[]).map((v) => (
                  <button key={v} type="button" className={`btn-sm ${view === v ? "btn-primary" : "btn-secondary"}`} onClick={() => setView(v)}>{v === "3d" ? "Turn" : v[0]!.toUpperCase() + v.slice(1)}</button>
                ))}
                <label className="ml-2 flex items-center gap-1 text-xs"><input type="checkbox" checked={doorsOpen} onChange={(e) => setDoorsOpen(e.target.checked)} /> Open doors</label>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={showDims} onChange={(e) => setShowDims(e.target.checked)} /> Dimensions</label>
              </div>
            )}
          </div>
          <div className="relative">
            {tab === "3d" ? (
              <CabinetViewer cabinet={cabinet} doorsOpen={doorsOpen} view={view} showDimensions={showDims} className="h-[460px] w-full" />
            ) : cabinet ? (
              <div className="p-4"><ElevationDrawing cabinet={cabinet} /></div>
            ) : (
              <p className="p-6 text-sm text-ink-soft">Fix the configuration to see the drawing.</p>
            )}
            {evaluating && <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2 py-1 text-xs text-ink-soft shadow">Checking…</span>}
          </div>
        </div>

        {cabinet && (
          <div className="grid gap-3 md:grid-cols-3">
            <Stat label="Outside" value={`${design.finished.width_mm} × ${design.finished.height_mm} × ${design.finished.depth_mm} mm`} hint="W × H × D including feet, doors and back" />
            <Stat label="Inside each module" value={cabinet.modules.map((m) => `${Math.round(m.interior.width_um / 1000)} × ${Math.round(m.interior.height_um / 1000)} × ${Math.round(m.interior.depth_um / 1000)}`).join(" · ")} hint="clear width × height × depth, mm" />
            <Stat label="Door swing" value={cabinet.modules.some((m) => m.doors.length) ? `Doors open to 110°; allow ${Math.round(Math.max(...cabinet.modules.flatMap((m) => m.doors.map(() => m.width_um / (m.doors.length || 1)))) / 1000)} mm in front` : "No doors"} hint="Keep this clear in front of the cabinet" />
          </div>
        )}

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Checks</h2>
            <div className="flex gap-2 text-xs">
              {blocking > 0 && <SeverityBadge severity="UNSUPPORTED" />}
              {blocking === 0 && reviewCount > 0 && <SeverityBadge severity="REVIEW_REQUIRED" />}
              {blocking === 0 && reviewCount === 0 && evaluation.compiled && <SeverityBadge severity="PASS" />}
            </div>
          </div>
          {evaluation.schemaErrors.length > 0 && (
            <ul className="mb-3 list-disc rounded-md border border-red-200 bg-red-50 p-3 pl-8 text-sm text-red-900">
              {evaluation.schemaErrors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
          <RuleReport results={evaluation.results} compiled={evaluation.compiled} />
        </section>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Right: price + actions                                              */}
      {/* ------------------------------------------------------------------ */}
      <aside className="space-y-4">
        <section className="card">
          {evaluation.price ? (
            <PriceBreakdown price={evaluation.price} estimate title="Estimate" compact />
          ) : (
            <p className="text-sm text-ink-soft">The estimate appears once the configuration is valid.</p>
          )}
          {evaluation.packaging && (
            <p className="mt-3 text-xs text-ink-soft">
              {evaluation.packaging.packages.length} packages, {evaluation.packaging.totalWeight_kg} kg total. Longest {Math.max(...evaluation.packaging.packages.map((p) => p.length_mm))} mm.
              {evaluation.assemblyMinutes ? ` Assembly about ${evaluation.assemblyMinutes} minutes.` : ""}
            </p>
          )}
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold">Save and submit</h2>
          {props.editable ? (
            <>
              <div className="flex gap-2">
                <button type="button" className="btn-primary flex-1" onClick={save} disabled={!dirty || saving || evaluating}>{saving ? "Saving…" : dirty ? `Save as version ${savedVersion + 1}` : "Saved"}</button>
                <button type="button" className="btn-secondary" onClick={undo} disabled={!history.length} title="Undo last change">Undo</button>
              </div>
              {saveError && <p className="text-sm text-red-700">{saveError}</p>}
              <Link href={`/design/${props.orderId}/measure${props.tokenQuery}`} className="btn-secondary w-full">{props.measurement ? "Edit measurements" : "Add room measurements"}</Link>
              <SubmitPanel orderId={props.orderId} tokenQuery={props.tokenQuery} disabled={dirty || blocking > 0 || !evaluation.compiled} contact={props.contact} orderStatus={props.orderStatus} />
            </>
          ) : (
            <p className="text-sm text-ink-soft">
              This order is <strong>{props.orderStatus.replace(/_/g, " ")}</strong>, so the design is locked. <Link className="underline" href={`/orders/${props.orderId}${props.tokenQuery}`}>Go to the order</Link> or contact us for a change order.
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
      <p className="text-xs text-ink-soft">{hint}</p>
    </div>
  );
}

function NaturalLanguagePanel({ design, measurement, editable, onApply }: { design: DesignSpec; measurement: MeasurementSet | null; editable: boolean; onApply: (next: DesignSpec) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProposalResponse | null>(null);

  const ask = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/propose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ utterance: text, design, measurement }) });
      setResult((await res.json()) as ProposalResponse);
    } finally {
      setBusy(false);
    }
  };

  const p = result?.proposal;
  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-semibold">Describe a change</h2>
        <p className="text-xs text-ink-soft">Try “make it 1500 wide”, “add a shelf to module 2”, “no handles”, “再宽一点”. You see the difference and price change before anything is applied.</p>
      </div>
      <div className="flex gap-2">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="What would you like to change?" disabled={!editable} />
        <button type="button" className="btn-secondary" onClick={ask} disabled={busy || !editable || !text.trim()}>{busy ? "…" : "Ask"}</button>
      </div>
      {result?.error && <p className="text-sm text-red-700">{result.error}</p>}
      {p && p.kind === "clarify" && (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <p>{p.question}</p>
          {p.options && <p className="mt-1 text-xs">Options: {p.options.join(" · ")}</p>}
        </div>
      )}
      {p && p.kind === "unsupported" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>{p.reason}</p>
          {p.alternative && <p className="mt-1 text-xs">{p.alternative}</p>}
        </div>
      )}
      {p && p.kind === "change" && result && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
          <p className="font-medium">{p.summary}</p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {(result.diff ?? describeDesignDiff(design, p.nextDesign)).map((d) => <li key={d}>{d}</li>)}
          </ul>
          {result.priceBefore_cents != null && result.priceAfter_cents != null && (
            <p className="mt-2 text-xs">
              Estimate {money(result.priceBefore_cents)} → <strong>{money(result.priceAfter_cents)}</strong> ({result.priceAfter_cents >= result.priceBefore_cents ? "+" : "−"}{money(Math.abs(result.priceAfter_cents - result.priceBefore_cents))})
            </p>
          )}
          {result.next && result.next.verdict === "UNSUPPORTED" && <p className="mt-2 text-xs text-red-800">This change would create blocking issues; it can be applied but must be fixed before submission.</p>}
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-primary btn-sm" onClick={() => { onApply(p.nextDesign); setResult(null); setText(""); }}>Apply</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setResult(null)}>Discard</button>
          </div>
        </div>
      )}
    </section>
  );
}

function SubmitPanel({ orderId, tokenQuery, disabled, contact, orderStatus }: { orderId: string; tokenQuery: string; disabled: boolean; contact: ConfiguratorProps["contact"]; orderStatus: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(contact?.name ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [referral, setReferral] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (orderStatus !== "draft" && orderStatus !== "needs_changes") {
    return <p className="text-sm text-ink-soft">Submitted for review. <Link className="underline" href={`/orders/${orderId}${tokenQuery}`}>Track the order</Link>.</p>;
  }

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    const res = await submitForReview(orderId, { name, email, phone, referralSource: referral });
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: "Submitted. Engineering will review your design and we will send a formal quote." });
      window.location.assign(`/orders/${orderId}${tokenQuery ? `${tokenQuery}&` : "?"}submitted=1`);
    } else setMsg({ ok: false, text: res.error ?? "Could not submit." });
  };

  return (
    <div className="space-y-2 border-t border-line pt-3">
      {!open ? (
        <>
          <button type="button" className="btn-secondary w-full" onClick={() => setOpen(true)} disabled={disabled}>Submit for engineering review</button>
          {disabled && <p className="text-xs text-ink-soft">Save your design and resolve every red item first.</p>}
        </>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="text-xs text-ink-soft">We review every order by hand before quoting. Where should the formal quote go?</p>
          <input className="input" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input className="input" placeholder="How did you hear about us? (optional)" value={referral} onChange={(e) => setReferral(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className="btn-primary flex-1" onClick={submit} disabled={busy}>{busy ? "Submitting…" : "Submit"}</button>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          {msg && <p className={msg.ok ? "text-emerald-800" : "text-red-700"}>{msg.text}</p>}
        </div>
      )}
    </div>
  );
}

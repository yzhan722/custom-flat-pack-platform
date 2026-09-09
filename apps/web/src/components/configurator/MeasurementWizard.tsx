"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { convertToMm, type LengthUnit, type MeasuredValue, type MeasurementSet, type MeasurementSource, type Obstacle } from "@cfp/core";
import { saveMeasurement, uploadOrderMedia } from "@/server/actions/customer";
import { MediaThumbs } from "@/components/MediaThumbs";

interface Entry {
  value: string;
  unit: LengthUnit;
  source: MeasurementSource;
  location: string;
}

const SOURCES: Array<{ id: MeasurementSource; label: string; hint: string }> = [
  { id: "approximate", label: "Rough figure", hint: "From memory or a quick look — we will ask you to re-measure." },
  { id: "manual_remeasured", label: "Measured twice with a tape", hint: "Counts as verified." },
  { id: "professional", label: "Measured by a professional", hint: "Counts as verified." },
  { id: "photo_estimate", label: "Estimated from a photo", hint: "Never used for production." },
  { id: "scan_estimate", label: "Phone scan / LiDAR", hint: "Design aid only; tape re-measure still required." },
];

const OBSTACLE_KINDS: Obstacle["kind"][] = ["skirting", "power_point", "door_swing", "window", "pipe", "radiator", "existing_furniture", "other"];

function entry(location: string, initial?: MeasuredValue): Entry {
  return {
    value: initial ? String(initial.originalValue ?? initial.value_mm) : "",
    unit: initial?.originalUnit ?? "mm",
    source: initial?.source ?? "manual_remeasured",
    location,
  };
}

function toMeasured(e: Entry): MeasuredValue | null {
  const n = Number(e.value);
  if (!e.value || !Number.isFinite(n) || n <= 0) return null;
  const conv = convertToMm(n, e.unit);
  return { value_mm: conv.value_mm, originalValue: n, originalUnit: e.unit, source: e.source, location: e.location, measuredAt: new Date().toISOString() };
}

/**
 * FR-02 measurement wizard. Finished size lives in the design; here we capture
 * the space the cabinet must fit, where each figure was taken and how reliable
 * it is. Unit conversions are shown back so the customer confirms them.
 */
export function MeasurementWizard({ orderId, initial, finished, returnTo }: { orderId: string; initial: MeasurementSet | null; finished: { width_mm: number; height_mm: number; depth_mm: number }; returnTo: string }) {
  const router = useRouter();
  const [constrained, setConstrained] = useState(initial?.spaceConstrained ?? false);
  const [widths, setWidths] = useState<Entry[]>([
    entry("floor level", initial?.availableSpace?.widths[0]),
    entry("about 600 mm above the floor", initial?.availableSpace?.widths[1]),
    entry("at the cabinet top height", initial?.availableSpace?.widths[2]),
  ]);
  const [height, setHeight] = useState<Entry>(entry("floor to obstruction above", initial?.availableSpace?.height));
  const [depth, setDepth] = useState<Entry>(entry("wall to front limit", initial?.availableSpace?.depth));
  const [obstacles, setObstacles] = useState<Obstacle[]>(initial?.obstacles ?? []);
  const [internal, setInternal] = useState<MeasurementSet["internalRequirements"]>(initial?.internalRequirements ?? []);
  const [passage, setPassage] = useState(initial?.accessPath?.narrowestPassage_mm ? String(initial.accessPath.narrowestPassage_mm) : "");
  const [accessNotes, setAccessNotes] = useState(initial?.accessPath?.notes ?? "");
  const [evidence, setEvidence] = useState(initial?.evidence.map((e) => `${e.kind}: ${e.ref}${e.caption ? ` — ${e.caption}` : ""}`).join("\n") ?? "");
  const [confirmedBy, setConfirmedBy] = useState(initial?.confirmedBy ?? "");
  const [photos, setPhotos] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const ws = widths.map(toMeasured).filter((w): w is MeasuredValue => w !== null);
    if (constrained && ws.length === 0) {
      setError("Enter at least one width of the space.");
      setBusy(false);
      return;
    }
    const uploaded: MeasurementSet["evidence"] = [];
    if (photos?.length) {
      const fd = new FormData();
      fd.set("orderId", orderId);
      for (const file of Array.from(photos)) fd.append("photos", file);
      const up = await uploadOrderMedia(fd);
      if (!up.ok) {
        setBusy(false);
        setError(up.error ?? "Could not upload photos.");
        return;
      }
      for (const ref of up.refs ?? []) uploaded.push({ kind: "photo", ref });
    }
    const ms: MeasurementSet = {
      spaceConstrained: constrained,
      availableSpace: constrained
        ? { widths: ws, height: toMeasured(height) ?? undefined, depth: toMeasured(depth) ?? undefined }
        : undefined,
      internalRequirements: internal.filter((r) => r.description.trim()),
      obstacles: obstacles.filter((o) => o.description.trim()),
      accessPath: passage || accessNotes ? { narrowestPassage_mm: passage ? Number(passage) : undefined, notes: accessNotes || undefined } : undefined,
      evidence: [
        ...evidence
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const m = l.match(/^(photo|sketch|note|scan)\s*:\s*(.*)$/i);
          const kind = (m?.[1]?.toLowerCase() ?? "note") as "photo" | "sketch" | "note" | "scan";
          const rest = m?.[2] ?? l;
          const [ref, caption] = rest.split(" — ");
          return { kind, ref: (ref ?? rest).trim(), caption: caption?.trim() || undefined };
        }),
        ...uploaded,
      ],
      confirmedBy: confirmedBy || undefined,
    };
    const res = await saveMeasurement(orderId, ms);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not save.");
      return;
    }
    router.push(returnTo);
  };

  const minWidth = widths.map(toMeasured).filter((w): w is MeasuredValue => w !== null).reduce<number | null>((min, w) => (min === null ? w.value_mm : Math.min(min, w.value_mm)), null);
  const need = finished.width_mm + 10;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <section className="card space-y-3">
          <h2 className="font-semibold">1. Does the cabinet have to fit a bounded space?</h2>
          <p className="text-sm text-ink-soft">For example an alcove, between two walls, or between existing furniture. Free-standing placement needs no space measurements.</p>
          <div className="flex gap-2">
            <button type="button" className={constrained ? "btn-secondary" : "btn-primary"} onClick={() => setConstrained(false)}>Free-standing</button>
            <button type="button" className={constrained ? "btn-primary" : "btn-secondary"} onClick={() => setConstrained(true)}>Must fit a space</button>
          </div>
        </section>

        {constrained && (
          <section className="card space-y-4">
            <div>
              <h2 className="font-semibold">2. Width of the space at three heights</h2>
              <p className="text-sm text-ink-soft">Walls are rarely square. Measure the clear width at floor level, at about 600 mm, and at the height of the cabinet top. Your cabinet is {finished.width_mm} mm wide and needs {need} mm (10 mm installation clearance).</p>
            </div>
            <div className="space-y-3">
              {widths.map((w, i) => (
                <MeasuredInput key={i} entry={w} onChange={(e) => setWidths(widths.map((x, k) => (k === i ? e : x)))} />
              ))}
            </div>
            {minWidth !== null && (
              <p className={`rounded-md px-3 py-2 text-sm ${minWidth >= need ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
                Smallest width entered: {minWidth} mm. {minWidth >= need ? "The cabinet fits with clearance." : `Too small for ${finished.width_mm} mm — reduce the cabinet width to at most ${minWidth - 10} mm or re-check the measurement.`}
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="label">Available height (optional)</p>
                <MeasuredInput entry={height} onChange={setHeight} compact />
              </div>
              <div>
                <p className="label">Available depth (optional)</p>
                <MeasuredInput entry={depth} onChange={setDepth} compact />
              </div>
            </div>
          </section>
        )}

        <section className="card space-y-3">
          <h2 className="font-semibold">{constrained ? "3" : "2"}. Skirting boards, power points and other obstacles</h2>
          <p className="text-sm text-ink-soft">Skirting pushes the cabinet away from the wall; power points and door swings may sit where a door or side would go.</p>
          {obstacles.map((o, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-line bg-stone-50 p-3 md:grid-cols-[150px_1fr_110px_110px_auto]">
              <select className="input" value={o.kind} onChange={(e) => setObstacles(obstacles.map((x, k) => (k === i ? { ...x, kind: e.target.value as Obstacle["kind"] } : x)))}>
                {OBSTACLE_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
              </select>
              <input className="input" placeholder="Description" value={o.description} onChange={(e) => setObstacles(obstacles.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)))} />
              <input className="input" type="number" placeholder="Protrudes mm" value={o.protrusion_mm ?? ""} onChange={(e) => setObstacles(obstacles.map((x, k) => (k === i ? { ...x, protrusion_mm: e.target.value ? Number(e.target.value) : undefined } : x)))} />
              <input className="input" type="number" placeholder="Height mm" value={o.heightFromFloor_mm ?? ""} onChange={(e) => setObstacles(obstacles.map((x, k) => (k === i ? { ...x, heightFromFloor_mm: e.target.value ? Number(e.target.value) : undefined } : x)))} />
              <button type="button" className="btn-secondary btn-sm" onClick={() => setObstacles(obstacles.filter((_, k) => k !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn-secondary btn-sm" onClick={() => setObstacles([...obstacles, { kind: "skirting", description: "", protrusion_mm: undefined, heightFromFloor_mm: undefined }])}>Add obstacle</button>
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold">{constrained ? "4" : "3"}. What has to fit inside?</h2>
          <p className="text-sm text-ink-soft">Optional. Tell us about tall folders, a printer, board games — anything with a size that matters. Engineering checks it against the interior dimensions.</p>
          {internal.map((r, i) => (
            <div key={i} className="grid gap-2 md:grid-cols-[1fr_100px_100px_100px_auto]">
              <input className="input" placeholder="e.g. A4 lever-arch files" value={r.description} onChange={(e) => setInternal(internal.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)))} />
              <input className="input" type="number" placeholder="W mm" value={r.width_mm ?? ""} onChange={(e) => setInternal(internal.map((x, k) => (k === i ? { ...x, width_mm: e.target.value ? Number(e.target.value) : undefined } : x)))} />
              <input className="input" type="number" placeholder="H mm" value={r.height_mm ?? ""} onChange={(e) => setInternal(internal.map((x, k) => (k === i ? { ...x, height_mm: e.target.value ? Number(e.target.value) : undefined } : x)))} />
              <input className="input" type="number" placeholder="D mm" value={r.depth_mm ?? ""} onChange={(e) => setInternal(internal.map((x, k) => (k === i ? { ...x, depth_mm: e.target.value ? Number(e.target.value) : undefined } : x)))} />
              <button type="button" className="btn-secondary btn-sm" onClick={() => setInternal(internal.filter((_, k) => k !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn-secondary btn-sm" onClick={() => setInternal([...internal, { description: "" }])}>Add item</button>
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold">{constrained ? "5" : "4"}. Getting it in, evidence and sign-off</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="label">Narrowest doorway or passage on the route (mm)</span>
              <input className="input" type="number" value={passage} onChange={(e) => setPassage(e.target.value)} placeholder="e.g. 720" />
            </label>
            <label className="text-sm">
              <span className="label">Access notes</span>
              <input className="input" value={accessNotes} onChange={(e) => setAccessNotes(e.target.value)} placeholder="stairs, lift, tight corner…" />
            </label>
          </div>
          <label className="block text-sm">
            <span className="label">Photos of the space (optional)</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="input" onChange={(e) => setPhotos(e.target.files)} />
            <span className="text-xs text-ink-soft">Photos are evidence only. They are never turned into production dimensions.</span>
          </label>
          {initial?.evidence?.length ? <MediaThumbs refs={initial.evidence.map((e) => e.ref)} /> : null}
          <label className="block text-sm">
            <span className="label">Notes, sketches (one per line, e.g. “note: alcove is not square”)</span>
            <textarea className="input min-h-24" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="label">Who took these measurements?</span>
            <input className="input" value={confirmedBy} onChange={(e) => setConfirmedBy(e.target.value)} placeholder="Your name" />
          </label>
        </section>
      </div>

      <aside className="space-y-4">
        <section className="card space-y-3 text-sm">
          <h3 className="font-semibold">How measurements are used</h3>
          <ul className="list-disc space-y-1 pl-5 text-ink-soft">
            <li>Only tape or professional measurements count as verified. Photo and scan figures are kept, but never turned into production data.</li>
            <li>If the smallest measured width is less than cabinet width + 10 mm, the design is blocked until one of them changes.</li>
            <li>Widths that differ by more than 15 mm between heights are flagged for engineering to discuss with you.</li>
            <li>We do not cut panels on site or scribe to walls in this range.</li>
          </ul>
          <button type="button" className="btn-primary w-full" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save measurements"}</button>
          {error && <p className="text-red-700">{error}</p>}
        </section>
      </aside>
    </div>
  );
}

function MeasuredInput({ entry, onChange, compact = false }: { entry: Entry; onChange: (e: Entry) => void; compact?: boolean }) {
  const n = Number(entry.value);
  const conv = entry.value && Number.isFinite(n) && n > 0 ? convertToMm(n, entry.unit) : null;
  return (
    <div className={`grid gap-2 ${compact ? "grid-cols-[1fr_80px]" : "md:grid-cols-[170px_1fr_80px_240px]"}`}>
      {!compact && <span className="self-center text-sm text-ink-soft">{entry.location}</span>}
      <input className="input" type="number" inputMode="decimal" value={entry.value} onChange={(e) => onChange({ ...entry, value: e.target.value })} placeholder="value" />
      <select className="input" value={entry.unit} onChange={(e) => onChange({ ...entry, unit: e.target.value as LengthUnit })}>
        <option value="mm">mm</option>
        <option value="cm">cm</option>
        <option value="m">m</option>
        <option value="in">in</option>
      </select>
      {!compact && (
        <select className="input" value={entry.source} onChange={(e) => onChange({ ...entry, source: e.target.value as MeasurementSource })} title={SOURCES.find((s) => s.id === entry.source)?.hint}>
          {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      )}
      {conv && entry.unit !== "mm" && <p className={`text-xs text-ink-soft ${compact ? "col-span-2" : "md:col-span-4"}`}>Confirm: {conv.confirmation}</p>}
    </div>
  );
}

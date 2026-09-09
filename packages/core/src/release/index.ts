import type { AssemblyGuide, AssemblyStep } from "../assembly";
import type { FactoryCapability } from "../catalog";
import type { DesignSpec } from "../design";
import { contentHash, sha256Hex } from "../ids";
import type { HardwareBom } from "../hardware";
import { planReplacementPackaging, type PackagingPlan } from "../packaging";
import type { CompiledCabinet, Panel } from "../panels";
import type { PriceBreakdown } from "../pricing";
import type { EvaluationReport } from "../rules";
import { umToMmRounded } from "../units";

/**
 * Immutable production release package (PRD FR-08). Built once from approved
 * inputs; any change produces a new package with a new hash while the old one is
 * marked superseded by the application layer. Nothing here is machine specific:
 * nesting, tooling and post-processing belong to the factory adapter.
 */

export interface PanelLabel {
  panelId: string;
  label: string;
  line1: string;
  line2: string;
  line3: string;
  /** Opaque QR payload; contains no personal data (PRD §11). */
  qrPayload: string;
}

export interface ProductionReleaseInput {
  orderId: string;
  designVersion: number;
  engineeringHash: string;
  design: DesignSpec;
  cabinet: CompiledCabinet;
  bom: HardwareBom;
  packaging: PackagingPlan;
  assembly: AssemblyGuide;
  report: EvaluationReport;
  price: PriceBreakdown;
  quote: { id: string; total_cents: number };
  approval: { reviewId: string; approvedBy: string; approvedAt: string; notes: string };
  confirmation: { id: string; confirmedAt: string; snapshotHash: string };
  factory: { id: string; version: number; adapter: string };
  versions: { ruleSetVersion: string; priceListId: string; priceListVersion: number };
  loadStatement: { shelf_kg: number | null; top_kg: number | null };
  /** Sequence number of releases for this order (1 for the first, 2 after a change order, ...). */
  sequence: number;
}

export interface ProductionReleasePayload {
  releaseKey: string;
  orderId: string;
  designVersion: number;
  sequence: number;
  engineeringHash: string;
  versions: CompiledCabinet["versions"] & ProductionReleaseInput["versions"] & { factoryId: string; factoryVersion: number; factoryAdapter: string; assemblyRecipeId: string; assemblyRecipeVersion: number };
  design: DesignSpec;
  summary: {
    finished_mm: { width: number; height: number; depth: number };
    modules: number;
    doors: number;
    shelves: number;
    panelCount: number;
    weight_kg: number;
    antiTipRequired: boolean;
    purpose: string;
    loadStatement: { shelf_kg: number | null; top_kg: number | null };
    flags: string[];
  };
  approval: ProductionReleaseInput["approval"];
  confirmation: ProductionReleaseInput["confirmation"];
  quote: ProductionReleaseInput["quote"] & { priceListId: string; priceListVersion: number };
  panels: CompiledCabinet["panels"];
  joints: CompiledCabinet["joints"];
  modules: CompiledCabinet["modules"];
  dims: CompiledCabinet["dims"];
  hardware: HardwareBom;
  packaging: PackagingPlan;
  assembly: AssemblyGuide;
  labels: PanelLabel[];
  documents: string[];
  ruleReport: EvaluationReport;
  /** Omitted on packages built before replacement jobs existed; treat as production. */
  kind?: ReleaseKind;
  replacement?: ReplacementRecord;
}

export type ReleaseKind = "production" | "replacement";

export type ReplacementPartKind = "panel" | "hardware_bag";

/** Provenance for a FR-12 replacement job. Copied fields are from the source package, never from a later catalog compile. */
export interface ReplacementRecord {
  sourceReleaseKey: string;
  serviceCaseId: string;
  partKind: ReplacementPartKind;
  partRef: string;
  copiedFrom: {
    engineeringHash: string;
    designVersion: number;
    templateId: string;
    templateVersion: number;
    constructionId: string;
    constructionVersion: number;
  };
}

export interface ProductionRelease {
  payload: ProductionReleasePayload;
  contentHash: string;
}

/** Deterministic key: the same order, design version and engineering hash always map to one release. */
export function releaseKeyFor(orderId: string, designVersion: number, engineeringHash: string, sequence: number): string {
  return `REL-${sha256Hex(`${orderId}|${designVersion}|${engineeringHash}|${sequence}`).slice(0, 16).toUpperCase()}`;
}

export function buildProductionRelease(input: ProductionReleaseInput): ProductionRelease {
  if (input.report.verdict === "UNSUPPORTED") throw new Error("Cannot build a release for an unsupported design.");
  const releaseKey = releaseKeyFor(input.orderId, input.designVersion, input.engineeringHash, input.sequence);
  const labels: PanelLabel[] = input.cabinet.panels.map((p) => ({
    panelId: p.id,
    label: p.label,
    line1: `${p.label}  ${p.name}`,
    line2: `${umToMmRounded(p.finished.length_um)} × ${umToMmRounded(p.finished.width_um)} × ${umToMmRounded(p.thickness_um)} mm  ${p.materialId}`,
    line3: `${releaseKey}  v${input.designVersion}`,
    qrPayload: `cfp:release/${releaseKey}/panel/${p.id}`,
  }));
  const documents = ["ASSEMBLY_GUIDE", "PACKING_LIST", "HARDWARE_LIST"];
  if (input.cabinet.antiTipRequired) documents.push("TOPPLING_WARNING_LABEL", "TOPPLING_INFORMATION_SHEET");

  const doors = input.cabinet.modules.reduce((acc, m) => acc + m.doors.length, 0);
  const shelves = input.cabinet.modules.reduce((acc, m) => acc + m.shelfPositions_um.length, 0);

  const payload: ProductionReleasePayload = {
    releaseKey,
    orderId: input.orderId,
    designVersion: input.designVersion,
    sequence: input.sequence,
    engineeringHash: input.engineeringHash,
    versions: {
      ...input.cabinet.versions,
      ...input.versions,
      factoryId: input.factory.id,
      factoryVersion: input.factory.version,
      factoryAdapter: input.factory.adapter,
      assemblyRecipeId: input.assembly.recipeId,
      assemblyRecipeVersion: input.assembly.recipeVersion,
    },
    design: input.design,
    summary: {
      finished_mm: {
        width: input.design.finished.width_mm,
        height: input.design.finished.height_mm,
        depth: input.design.finished.depth_mm,
      },
      modules: input.cabinet.modules.length,
      doors,
      shelves,
      panelCount: input.cabinet.panels.length,
      weight_kg: input.cabinet.totals.weight_kg,
      antiTipRequired: input.cabinet.antiTipRequired,
      purpose: input.design.purpose,
      loadStatement: input.loadStatement,
      flags: input.report.flags,
    },
    approval: input.approval,
    confirmation: input.confirmation,
    quote: { ...input.quote, priceListId: input.versions.priceListId, priceListVersion: input.versions.priceListVersion },
    panels: input.cabinet.panels,
    joints: input.cabinet.joints,
    modules: input.cabinet.modules,
    dims: input.cabinet.dims,
    hardware: input.bom,
    packaging: input.packaging,
    assembly: input.assembly,
    labels,
    documents,
    ruleReport: input.report,
    kind: "production",
  };
  return { payload, contentHash: contentHash(payload) };
}

export interface ReplacementReleaseInput {
  source: ProductionReleasePayload;
  sequence: number;
  serviceCaseId: string;
  partKind: ReplacementPartKind;
  partRef: string;
  factory: FactoryCapability;
  requestedAt: string;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function replacementAssembly(source: ProductionReleasePayload, partKind: ReplacementPartKind, partRef: string, panelIds: string[]): AssemblyGuide {
  const bagSkus = new Set(source.hardware.lines.filter((l) => l.bagCode === partRef).map((l) => l.sku));
  const relevant = source.assembly.steps.filter((s) =>
    partKind === "panel" ? s.panelIds.includes(partRef) : s.hardware.some((h) => bagSkus.has(h.sku)),
  );
  const notice: AssemblyStep = {
    id: "REPL-S0",
    order: 1,
    title: "Replacement part — fit to the original cabinet",
    titleZh: "补件：按原柜安装",
    moduleIndex: relevant[0]?.moduleIndex ?? null,
    panelIds,
    hardware: [],
    tools: source.assembly.tools,
    instructions: [
      `This package contains a replacement ${partKind === "panel" ? "panel" : "hardware bag"} copied from release ${source.releaseKey}.`,
      "Do not recut or redrill. Hole positions, sizes and SKUs match the original production record — not the current catalog.",
      "Fit it in place of the damaged or missing part using the original orientation.",
    ],
    checks: ["The replacement matches the original label, size and hole pattern.", "No extra holes have been added."],
    safety: relevant.flatMap((s) => s.safety).slice(0, 4),
    dependsOn: [],
    orientation: relevant[0]?.orientation ?? "as original",
    isSafetyCritical: relevant.some((s) => s.isSafetyCritical),
  };
  const rest = relevant.map((s, i) => ({
    ...cloneJson(s),
    order: i + 2,
    dependsOn: i === 0 ? ["REPL-S0"] : cloneJson(s.dependsOn),
  }));
  return {
    recipeId: source.assembly.recipeId,
    recipeVersion: source.assembly.recipeVersion,
    estimatedMinutes: Math.max(15, relevant.length * 10),
    people: source.assembly.people,
    workspaceNote: `Replacement from ${source.releaseKey}. Original assembly recipe ${source.assembly.recipeId} v${source.assembly.recipeVersion}.`,
    tools: source.assembly.tools,
    steps: [notice, ...rest],
  };
}

/**
 * FR-12 / PRD §7.2: a single-part production job cloned from an immutable
 * release. Never recompiles the current template — that would overwrite the
 * original structure if the catalog has moved on.
 */
export function buildReplacementRelease(input: ReplacementReleaseInput): ProductionRelease {
  const source = input.source;
  if (source.kind === "replacement") {
    throw new Error("Replacement jobs must be copied from the original production package, not from another replacement.");
  }
  const replacement: ReplacementRecord = {
    sourceReleaseKey: source.releaseKey,
    serviceCaseId: input.serviceCaseId,
    partKind: input.partKind,
    partRef: input.partRef,
    copiedFrom: {
      engineeringHash: source.engineeringHash,
      designVersion: source.designVersion,
      templateId: source.versions.templateId,
      templateVersion: source.versions.templateVersion,
      constructionId: source.versions.constructionId,
      constructionVersion: source.versions.constructionVersion,
    },
  };

  let panels: Panel[] = [];
  let hardware: HardwareBom;
  if (input.partKind === "panel") {
    const panel = source.panels.find((p) => p.id === input.partRef);
    if (!panel) throw new Error(`Panel ${input.partRef} is not in release ${source.releaseKey}.`);
    panels = [cloneJson(panel)];
    hardware = {
      hardwareSystemId: source.hardware.hardwareSystemId,
      hardwareSystemVersion: source.hardware.hardwareSystemVersion,
      lines: [],
      bags: [],
    };
  } else {
    const bag = source.hardware.bags.find((b) => b.bagCode === input.partRef);
    if (!bag) throw new Error(`Hardware bag ${input.partRef} is not in release ${source.releaseKey}.`);
    hardware = {
      hardwareSystemId: source.hardware.hardwareSystemId,
      hardwareSystemVersion: source.hardware.hardwareSystemVersion,
      lines: cloneJson(source.hardware.lines.filter((l) => l.bagCode === bag.bagCode)),
      bags: [cloneJson(bag)],
    };
  }

  const packaging = planReplacementPackaging({
    kind: input.partKind,
    panel: panels[0],
    bagCode: input.partKind === "hardware_bag" ? input.partRef : undefined,
    bom: input.partKind === "hardware_bag" ? hardware : source.hardware,
    factory: input.factory,
  });

  const panelIds = panels.map((p) => p.id);
  const joints = cloneJson(source.joints.filter((j) => (input.partKind === "panel" ? j.panelIds.includes(input.partRef) : j.hardware.some((h) => hardware.lines.some((l) => l.sku === h.sku)))));
  const labels =
    input.partKind === "panel"
      ? panels.map((p) => ({
          panelId: p.id,
          label: p.label,
          line1: `${p.label}  ${p.name}`,
          line2: `${umToMmRounded(p.finished.length_um)} × ${umToMmRounded(p.finished.width_um)} × ${umToMmRounded(p.thickness_um)} mm  ${p.materialId}`,
          line3: `REPLACEMENT of ${source.releaseKey}  v${source.designVersion}`,
          qrPayload: `cfp:release/${releaseKeyFor(source.orderId, source.designVersion, source.engineeringHash, input.sequence)}/panel/${p.id}`,
        }))
      : [];

  const releaseKey = releaseKeyFor(source.orderId, source.designVersion, source.engineeringHash, input.sequence);
  if (labels[0]) labels[0].qrPayload = `cfp:release/${releaseKey}/panel/${labels[0].panelId}`;

  const payload: ProductionReleasePayload = {
    releaseKey,
    orderId: source.orderId,
    designVersion: source.designVersion,
    sequence: input.sequence,
    engineeringHash: source.engineeringHash,
    versions: cloneJson(source.versions),
    design: cloneJson(source.design),
    summary: {
      ...cloneJson(source.summary),
      panelCount: panels.length,
      weight_kg: panels[0]?.weight_kg ?? packaging.totalWeight_kg,
      flags: [...source.summary.flags, "REPLACEMENT"],
    },
    approval: cloneJson(source.approval),
    confirmation: cloneJson(source.confirmation),
    quote: cloneJson(source.quote),
    panels,
    joints,
    modules: cloneJson(source.modules),
    dims: cloneJson(source.dims),
    hardware,
    packaging,
    assembly: replacementAssembly(source, input.partKind, input.partRef, panelIds),
    labels,
    documents: input.partKind === "panel" ? ["REPLACEMENT_CUTLIST", "PACKING_LIST"] : ["HARDWARE_LIST", "PACKING_LIST"],
    ruleReport: cloneJson(source.ruleReport),
    kind: "replacement",
    replacement,
  };
  return { payload, contentHash: contentHash(payload) };
}

/** Cut list rows for the factory adapter (manual V0: CSV import into the cabinet software). */
export interface CutListRow {
  label: string;
  panelId: string;
  name: string;
  material: string;
  thickness_mm: number;
  finishedLength_mm: number;
  finishedWidth_mm: number;
  cutLength_mm: number;
  cutWidth_mm: number;
  edgesBanded: string;
  drills: number;
  pockets: number;
  qty: number;
}

export function cutListRows(release: ProductionReleasePayload): CutListRow[] {
  return release.panels.map((p) => ({
    label: p.label,
    panelId: p.id,
    name: p.name,
    material: p.materialId,
    thickness_mm: umToMmRounded(p.thickness_um),
    finishedLength_mm: umToMmRounded(p.finished.length_um),
    finishedWidth_mm: umToMmRounded(p.finished.width_um),
    cutLength_mm: umToMmRounded(p.cut.length_um),
    cutWidth_mm: umToMmRounded(p.cut.width_um),
    edgesBanded: p.edges.filter((e) => e.banded).map((e) => e.cabinetEdge).join("+") || "-",
    drills: p.operations.filter((o) => o.kind === "DRILL").length,
    pockets: p.operations.filter((o) => o.kind === "POCKET").length,
    qty: 1,
  }));
}

export function cutListCsv(release: ProductionReleasePayload): string {
  const rows = cutListRows(release);
  const header = [
    "label",
    "panel_id",
    "name",
    "material",
    "thickness_mm",
    "finished_length_mm",
    "finished_width_mm",
    "cut_length_mm",
    "cut_width_mm",
    "edges_banded",
    "drills",
    "pockets",
    "qty",
  ];
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    header.join(","),
    ...rows.map((r) =>
      [r.label, r.panelId, r.name, r.material, r.thickness_mm, r.finishedLength_mm, r.finishedWidth_mm, r.cutLength_mm, r.cutWidth_mm, r.edgesBanded, r.drills, r.pockets, r.qty]
        .map(esc)
        .join(","),
    ),
  ].join("\n");
}

/** Operation list in panel-local µm for the factory adapter. */
export function operationsCsv(release: ProductionReleasePayload): string {
  const header = ["label", "panel_id", "face", "kind", "purpose", "x_um", "y_um", "diameter_um", "length_um", "width_um", "depth_um", "through", "rotation_deg", "joint_id"];
  const lines = [header.join(",")];
  for (const p of release.panels) {
    for (const op of p.operations) {
      if (op.kind === "DRILL") {
        lines.push([p.label, p.id, op.face, op.kind, op.purpose, op.x_um, op.y_um, op.diameter_um, "", "", op.depth_um, op.through ? 1 : 0, "", op.jointId].join(","));
      } else {
        lines.push([p.label, p.id, op.face, op.kind, op.purpose, op.x_um, op.y_um, "", op.length_um, op.width_um, op.depth_um, 0, op.rotationDeg, op.jointId].join(","));
      }
    }
  }
  return lines.join("\n");
}

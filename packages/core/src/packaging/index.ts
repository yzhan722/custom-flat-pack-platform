import type { FactoryCapability } from "../catalog";
import type { HardwareBom } from "../hardware";
import type { CompiledCabinet, Panel } from "../panels";
import { mmToUm, umToM } from "../units";

export interface PackageItem {
  kind: "panel" | "hardware_bag" | "document";
  ref: string;
  label: string;
}

export interface PackageSpec {
  code: string;
  title: string;
  moduleIndex: number | null;
  contents: PackageItem[];
  outer: { length_um: number; width_um: number; height_um: number };
  weight_kg: number;
  volume_m3: number;
  exceedsParcelLimits: boolean;
  exceedsLocalLimits: boolean;
  /** Assembly step ids that first need this package, so packages can be opened in order (PRD §9.2). */
  neededFromStep: string | null;
}

export interface PackagingPlan {
  packages: PackageSpec[];
  totalWeight_kg: number;
  largestLength_um: number;
  anyExceedsParcel: boolean;
  anyExceedsLocal: boolean;
}

const PADDING_UM = mmToUm(20);
const STACK_PADDING_UM = mmToUm(10);
const PACKAGING_WEIGHT_KG = 0.6;
const HARDWARE_BAG_WEIGHT_KG = 0.05;

function packPanels(code: string, title: string, moduleIndex: number | null, panels: Panel[], factory: FactoryCapability, neededFromStep: string | null): PackageSpec {
  const length = Math.max(...panels.map((p) => Math.max(p.finished.length_um, p.finished.width_um))) + PADDING_UM;
  const width = Math.max(...panels.map((p) => Math.min(p.finished.length_um, p.finished.width_um))) + PADDING_UM;
  const height = panels.reduce((acc, p) => acc + p.thickness_um, 0) + STACK_PADDING_UM;
  const weight = round2(panels.reduce((acc, p) => acc + p.weight_kg, 0) + PACKAGING_WEIGHT_KG);
  return finalise(
    {
      code,
      title,
      moduleIndex,
      contents: panels.map((p) => ({ kind: "panel", ref: p.id, label: `${p.label} ${p.name}` })),
      outer: { length_um: length, width_um: width, height_um: height },
      weight_kg: weight,
      volume_m3: 0,
      exceedsParcelLimits: false,
      exceedsLocalLimits: false,
      neededFromStep,
    },
    factory,
  );
}

function finalise(pkg: PackageSpec, factory: FactoryCapability): PackageSpec {
  const d = factory.delivery;
  const volume = umToM(pkg.outer.length_um) * umToM(pkg.outer.width_um) * umToM(pkg.outer.height_um);
  const exceedsParcel =
    pkg.outer.length_um > d.parcelMaxLength_um || pkg.weight_kg > d.parcelMaxWeight_kg || volume > d.parcelMaxVolume_m3;
  const exceedsLocal = pkg.outer.length_um > d.localMaxLength_um || pkg.weight_kg > d.localMaxWeight_kg;
  return { ...pkg, volume_m3: round4(volume), exceedsParcelLimits: exceedsParcel, exceedsLocalLimits: exceedsLocal };
}

/**
 * Groups panels into packages ordered by assembly sequence: carcass first,
 * then shelves/doors, then the spanning top, then hardware and documents.
 */
export function planPackaging(cabinet: CompiledCabinet, bom: HardwareBom, factory: FactoryCapability): PackagingPlan {
  const byId = new Map(cabinet.panels.map((p) => [p.id, p]));
  const packages: PackageSpec[] = [];
  let n = 1;
  const code = () => `P${n < 10 ? `0${n++}` : n++}`;

  for (const m of cabinet.modules) {
    const carcassRoles = new Set(["SIDE_L", "SIDE_R", "BOTTOM", "TOP", "BACK"]);
    const carcass = m.panelIds
      .map((id) => byId.get(id)!)
      .filter((p) => p.moduleIndex === m.index && carcassRoles.has(p.role));
    packages.push(packPanels(code(), `Module ${m.index} carcass`, m.index, carcass, factory, `M${m.index}-S1`));
    const fittings = m.panelIds
      .map((id) => byId.get(id)!)
      .filter((p) => p.moduleIndex === m.index && (p.role === "SHELF" || p.role === "DOOR"));
    if (fittings.length) {
      packages.push(packPanels(code(), `Module ${m.index} shelves and doors`, m.index, fittings, factory, `M${m.index}-S7`));
    }
  }
  const rowTop = byId.get("ROW-TOP");
  if (rowTop) packages.push(packPanels(code(), "Top panel", null, [rowTop], factory, "ROW-S2"));

  const bagWeight = round2(bom.lines.reduce((acc, l) => acc + l.qty * HARDWARE_BAG_WEIGHT_KG, 0) + 0.3);
  packages.push(
    finalise(
      {
        code: code(),
        title: "Hardware bags and assembly guide",
        moduleIndex: null,
        contents: [
          ...bom.bags.map((b) => ({ kind: "hardware_bag" as const, ref: b.bagCode, label: `Bag ${b.bagCode}: ${b.skus.join(", ")}` })),
          { kind: "document", ref: "ASSEMBLY_GUIDE", label: "Printed assembly guide with QR code" },
          ...(cabinet.antiTipRequired ? [{ kind: "document" as const, ref: "TOPPLING_WARNING", label: "Toppling warning label and instructions" }] : []),
        ],
        outer: { length_um: mmToUm(300), width_um: mmToUm(220), height_um: mmToUm(80) },
        weight_kg: bagWeight,
        volume_m3: 0,
        exceedsParcelLimits: false,
        exceedsLocalLimits: false,
        neededFromStep: "M1-S1",
      },
      factory,
    ),
  );

  return {
    packages,
    totalWeight_kg: round2(packages.reduce((acc, p) => acc + p.weight_kg, 0)),
    largestLength_um: Math.max(...packages.map((p) => p.outer.length_um)),
    anyExceedsParcel: packages.some((p) => p.exceedsParcelLimits),
    anyExceedsLocal: packages.some((p) => p.exceedsLocalLimits),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

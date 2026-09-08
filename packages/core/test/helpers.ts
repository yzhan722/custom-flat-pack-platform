import {
  Catalog,
  defaultDesign,
  runEngineering,
  type DeliveryZone,
  type DesignSpec,
  type EngineeringResult,
  type MeasurementSet,
  type Purpose,
} from "../src";

export const catalog = Catalog.development();
export const factory = catalog.getFactory("FAC-PILOT-01");
export const priceList = catalog.getPriceList("PL-PILOT");

export const ZONES: Record<string, DeliveryZone> = {
  "3000": priceList.delivery.zones[0]!,
  "3001": priceList.delivery.zones[0]!,
  "3100": priceList.delivery.zones[1]!,
};

export function resolveZone(postcode: string): DeliveryZone | null {
  return ZONES[postcode] ?? null;
}

export function design(
  templateId: "TPL-LOW-O" | "TPL-LOW-D",
  overrides: Partial<DesignSpec> & { purpose?: Purpose; width_mm?: number; height_mm?: number; depth_mm?: number } = {},
): DesignSpec {
  const ctx = catalog.resolveTemplate(templateId);
  const base = defaultDesign(ctx, {
    purpose: overrides.purpose ?? "general_storage",
    deliveryPostcode: "3000",
    width_mm: overrides.width_mm,
    height_mm: overrides.height_mm,
    depth_mm: overrides.depth_mm,
  });
  const { purpose: _p, width_mm: _w, height_mm: _h, depth_mm: _d, ...rest } = overrides;
  return { ...base, ...rest };
}

export function run(d: unknown, measurement: MeasurementSet | null = null): EngineeringResult {
  return runEngineering({ design: d, catalog, factory, priceList, measurement, resolveZone });
}

export function ruleIds(result: EngineeringResult, severity: "UNSUPPORTED" | "REVIEW_REQUIRED" | "PASS"): string[] {
  return [...new Set((result.report?.results ?? []).filter((r) => r.severity === severity).map((r) => r.ruleId))];
}

export const freeStanding: MeasurementSet = {
  spaceConstrained: false,
  internalRequirements: [],
  obstacles: [],
  evidence: [],
};

export const verifiedMeasurement = (width_mm: number, extra: Partial<MeasurementSet> = {}): MeasurementSet => ({
  spaceConstrained: true,
  availableSpace: {
    widths: [
      { value_mm: width_mm, source: "manual_remeasured", location: "floor" },
      { value_mm: width_mm + 3, source: "manual_remeasured", location: "600 mm" },
      { value_mm: width_mm + 1, source: "manual_remeasured", location: "top" },
    ],
  },
  internalRequirements: [],
  obstacles: [],
  evidence: [],
  ...extra,
});

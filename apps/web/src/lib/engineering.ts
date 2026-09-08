import { runEngineering, type EngineeringResult, type MeasurementSet } from "@cfp/core";
import type { StoredEngineering } from "@/db/schema";
import { catalog, pilotFactory, pilotPriceList, zoneResolverFor } from "./catalog";

/** Runs the deterministic kernel for a design against the pilot factory and price list. */
export async function evaluateDesign(design: unknown, measurement: MeasurementSet | null): Promise<EngineeringResult> {
  const postcode = typeof design === "object" && design !== null ? String((design as { installation?: { deliveryPostcode?: string } }).installation?.deliveryPostcode ?? "") : "";
  const resolveZone = await zoneResolverFor(postcode);
  return runEngineering({
    design,
    catalog,
    factory: pilotFactory(),
    priceList: pilotPriceList(),
    measurement,
    resolveZone,
  });
}

export function toStored(result: EngineeringResult): StoredEngineering {
  return {
    ok: result.ok,
    schemaErrors: result.schemaErrors,
    cabinet: result.cabinet,
    bom: result.bom,
    packaging: result.packaging,
    assembly: result.assembly,
    report: result.report,
    price: result.price,
    engineeringHash: result.engineeringHash,
    versions: result.versions,
  };
}

/** What the configurator needs back from a live evaluation. Kept small enough to send on every edit. */
export interface LiveEvaluation {
  ok: boolean;
  schemaErrors: string[];
  design: EngineeringResult["design"];
  verdict: "PASS" | "REVIEW_REQUIRED" | "UNSUPPORTED" | null;
  compiled: boolean;
  results: NonNullable<EngineeringResult["report"]>["results"];
  flags: string[];
  price: EngineeringResult["price"];
  cabinet: EngineeringResult["cabinet"];
  packaging: { packages: Array<{ code: string; title: string; weight_kg: number; length_mm: number }>; totalWeight_kg: number } | null;
  assemblyMinutes: number | null;
  engineeringHash: string | null;
}

export function toLive(result: EngineeringResult): LiveEvaluation {
  return {
    ok: result.ok,
    schemaErrors: result.schemaErrors,
    design: result.design,
    verdict: result.report?.verdict ?? null,
    compiled: result.report?.compiled ?? false,
    results: result.report?.results ?? [],
    flags: result.report?.flags ?? [],
    price: result.price,
    cabinet: result.cabinet,
    packaging: result.packaging
      ? {
          packages: result.packaging.packages.map((p) => ({ code: p.code, title: p.title, weight_kg: p.weight_kg, length_mm: Math.round(p.outer.length_um / 1000) })),
          totalWeight_kg: result.packaging.totalWeight_kg,
        }
      : null,
    assemblyMinutes: result.assembly?.estimatedMinutes ?? null,
    engineeringHash: result.engineeringHash,
  };
}

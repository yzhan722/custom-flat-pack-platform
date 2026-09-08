import { buildAssemblyGuide, type AssemblyGuide } from "./assembly";
import type { Catalog, DeliveryZone, FactoryCapability, PriceList, TemplateContext } from "./catalog";
import { safeParseDesignSpec, type DesignSpec } from "./design";
import { buildHardwareBom, type HardwareBom } from "./hardware";
import { contentHash } from "./ids";
import type { MeasurementSet } from "./measurement";
import { planPackaging, type PackagingPlan } from "./packaging";
import { compileCabinet, type CompiledCabinet } from "./panels";
import { priceCabinet, type PriceBreakdown } from "./pricing";
import { preCompileRules, runRules, RULES, type EvaluationReport, type RuleContext } from "./rules";

/**
 * The engineering pipeline. Given customer intent and catalog versions it
 * produces everything downstream steps need, deterministically. The web layer
 * stores the result per design version; the production release later binds a
 * specific result by hash (PRD FR-08).
 */

export interface EngineeringInput {
  design: unknown;
  catalog: Catalog;
  factory: FactoryCapability;
  priceList: PriceList;
  measurement: MeasurementSet | null;
  /** Resolves a postcode to a delivery zone; null when outside the service area. */
  resolveZone: (postcode: string) => DeliveryZone | null;
}

export interface EngineeringResult {
  ok: boolean;
  design: DesignSpec | null;
  /** Schema errors when the design could not even be parsed. */
  schemaErrors: string[];
  templateContext: TemplateContext | null;
  cabinet: CompiledCabinet | null;
  bom: HardwareBom | null;
  packaging: PackagingPlan | null;
  assembly: AssemblyGuide | null;
  report: EvaluationReport | null;
  price: PriceBreakdown | null;
  /** Hash over design + versions + compiled output; identical inputs yield identical hashes. */
  engineeringHash: string | null;
  versions: {
    ruleSetVersion: string;
    factoryId: string;
    factoryVersion: number;
    priceListId: string;
    priceListVersion: number;
  } | null;
}

export function runEngineering(input: EngineeringInput): EngineeringResult {
  const parsed = safeParseDesignSpec(input.design);
  if (!parsed.success) {
    return {
      ok: false,
      design: null,
      schemaErrors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
      templateContext: null,
      cabinet: null,
      bom: null,
      packaging: null,
      assembly: null,
      report: null,
      price: null,
      engineeringHash: null,
      versions: null,
    };
  }
  const design = parsed.data;
  let ctx: TemplateContext;
  try {
    ctx = input.catalog.resolveTemplate(design.templateId, design.templateVersion);
  } catch (err) {
    return {
      ok: false,
      design,
      schemaErrors: [(err as Error).message],
      templateContext: null,
      cabinet: null,
      bom: null,
      packaging: null,
      assembly: null,
      report: null,
      price: null,
      engineeringHash: null,
      versions: null,
    };
  }

  const zone = design.installation.deliveryMethod === "pickup" ? null : input.resolveZone(design.installation.deliveryPostcode);
  const base: RuleContext = {
    design,
    ctx,
    factory: input.factory,
    measurement: input.measurement,
    deliveryZone: zone,
    cabinet: null,
    bom: null,
    packaging: null,
    assembly: null,
  };

  const pre = runRules(base, preCompileRules());
  let cabinet: CompiledCabinet | null = null;
  let bom: HardwareBom | null = null;
  let packaging: PackagingPlan | null = null;
  let assembly: AssemblyGuide | null = null;
  let price: PriceBreakdown | null = null;

  const configurationBlocked = pre.results.some((r) => r.severity === "UNSUPPORTED" && r.category === "configuration");
  if (!configurationBlocked) {
    cabinet = compileCabinet(design, ctx);
    bom = buildHardwareBom(cabinet, ctx.hardware);
    packaging = planPackaging(cabinet, bom, input.factory);
    assembly = buildAssemblyGuide(cabinet, ctx.template.toolsRequired);
    price = priceCabinet({
      cabinet,
      bom,
      packaging,
      priceList: input.priceList,
      deliveryMethod: design.installation.deliveryMethod,
      deliveryZone: zone,
    });
  }

  const report = runRules({ ...base, cabinet, bom, packaging, assembly }, RULES);
  const versions = {
    ruleSetVersion: report.ruleSetVersion,
    factoryId: input.factory.id,
    factoryVersion: input.factory.version,
    priceListId: input.priceList.id,
    priceListVersion: input.priceList.version,
  };
  const engineeringHash = contentHash({
    design,
    versions: { ...(cabinet?.versions ?? {}), ...versions },
    panels: cabinet?.panels ?? null,
    joints: cabinet?.joints ?? null,
    bom: bom?.lines ?? null,
    verdict: report.verdict,
  });

  return {
    ok: report.verdict !== "UNSUPPORTED",
    design,
    schemaErrors: [],
    templateContext: ctx,
    cabinet,
    bom,
    packaging,
    assembly,
    report,
    price,
    engineeringHash,
    versions,
  };
}

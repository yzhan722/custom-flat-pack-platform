import type { DeliveryZone, FactoryCapability, TemplateContext } from "../catalog";
import type { AssemblyGuide } from "../assembly";
import type { DesignSpec } from "../design";
import type { HardwareBom } from "../hardware";
import type { MeasurementSet } from "../measurement";
import type { PackagingPlan } from "../packaging";
import type { CompiledCabinet } from "../panels";

export type Severity = "PASS" | "REVIEW_REQUIRED" | "UNSUPPORTED";

export type RuleCategory =
  | "purpose"
  | "catalog"
  | "configuration"
  | "measurement"
  | "geometry"
  | "structure"
  | "manufacturing"
  | "assembly"
  | "fulfilment";

export interface RuleResult {
  ruleId: string;
  category: RuleCategory;
  severity: Severity;
  message: string;
  /** Design fields involved, e.g. `finished.width_mm`, `modules[1].doorSwing`. */
  fields: string[];
  suggestion?: string;
  /** Machine-readable flags consumed by downstream steps (labels, release). */
  flags?: string[];
}

export interface RuleContext {
  design: DesignSpec;
  ctx: TemplateContext;
  factory: FactoryCapability;
  measurement: MeasurementSet | null;
  deliveryZone: DeliveryZone | null;
  /** Null until configuration rules allow compilation. */
  cabinet: CompiledCabinet | null;
  bom: HardwareBom | null;
  packaging: PackagingPlan | null;
  assembly: AssemblyGuide | null;
}

export interface Rule {
  id: string;
  category: RuleCategory;
  description: string;
  /** Whether the rule needs a compiled cabinet. */
  needsCabinet: boolean;
  check(rc: RuleContext): RuleResult | RuleResult[];
}

export interface EvaluationReport {
  ruleSetVersion: string;
  verdict: Severity;
  compiled: boolean;
  results: RuleResult[];
  unsupported: RuleResult[];
  reviewRequired: RuleResult[];
  flags: string[];
}

export const SEVERITY_RANK: Record<Severity, number> = { PASS: 0, REVIEW_REQUIRED: 1, UNSUPPORTED: 2 };

export function worst(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

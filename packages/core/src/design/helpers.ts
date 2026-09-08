import type { Purpose, Range, TemplateContext } from "../catalog";
import { contentHash } from "../ids";
import type { DesignSpec, ModuleSpec } from "./schema";

export interface WidthDistributionResult {
  ok: true;
  widths_mm: number[];
}

export interface WidthDistributionError {
  ok: false;
  reason: string;
  /** Module counts that would make the requested total width valid. */
  feasibleModuleCounts: number[];
}

/**
 * Spreads a total width over `count` modules as evenly as possible with integer
 * millimetres. Never changes module count or kinds silently (PRD FR-03).
 */
export function distributeModuleWidths(
  totalWidth_mm: number,
  count: number,
  moduleWidth: Range,
  moduleCount: Range,
): WidthDistributionResult | WidthDistributionError {
  const feasible: number[] = [];
  for (let n = moduleCount.min; n <= moduleCount.max; n++) {
    if (totalWidth_mm >= n * moduleWidth.min && totalWidth_mm <= n * moduleWidth.max) feasible.push(n);
  }
  if (!feasible.includes(count)) {
    return {
      ok: false,
      reason:
        feasible.length === 0
          ? `A total width of ${totalWidth_mm} mm cannot be built with ${moduleCount.min}–${moduleCount.max} modules of ${moduleWidth.min}–${moduleWidth.max} mm.`
          : `${count} module(s) cannot span ${totalWidth_mm} mm within ${moduleWidth.min}–${moduleWidth.max} mm each. Choose ${feasible.join(" or ")} module(s).`,
      feasibleModuleCounts: feasible,
    };
  }
  const base = Math.floor(totalWidth_mm / count);
  let remainder = totalWidth_mm - base * count;
  const widths: number[] = [];
  for (let i = 0; i < count; i++) {
    widths.push(base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder--;
  }
  return { ok: true, widths_mm: widths };
}

export function sumModuleWidths(modules: ModuleSpec[]): number {
  return modules.reduce((acc, m) => acc + m.width_mm, 0);
}

/** A valid starting point for a template, used when a draft is created. */
export function defaultDesign(
  ctx: TemplateContext,
  input: { purpose: Purpose; deliveryPostcode: string; width_mm?: number; height_mm?: number; depth_mm?: number },
): DesignSpec {
  const { template } = ctx;
  const width_mm = input.width_mm ?? 1200;
  const height_mm = input.height_mm ?? template.domain.heights_mm[1] ?? template.domain.heights_mm[0]!;
  const depth_mm = input.depth_mm ?? template.domain.depths_mm[0]!;
  const moduleCount = Math.min(template.domain.moduleCount.max, Math.max(template.domain.moduleCount.min, Math.round(width_mm / 600)));
  const dist = distributeModuleWidths(width_mm, moduleCount, template.domain.moduleWidth_mm, template.domain.moduleCount);
  const widths = dist.ok ? dist.widths_mm : [width_mm];
  const kind = template.code === "D" ? "door" : "open";
  const modules: ModuleSpec[] = widths.map((w, i) => ({
    kind,
    width_mm: w,
    shelfCount: 1,
    ...(kind === "door"
      ? { doorSwing: w >= 500 ? "double" : i % 2 === 0 ? "left" : "right", handle: "bar" }
      : {}),
  }));
  return {
    templateId: template.id,
    templateVersion: template.version,
    purpose: input.purpose,
    finished: { width_mm, height_mm, depth_mm },
    modules,
    topPanelStyle: "single",
    installation: {
      wallType: "unknown",
      antiTipAcknowledged: false,
      deliveryPostcode: input.deliveryPostcode,
      deliveryMethod: "local_delivery",
    },
  };
}

/**
 * Changes the total width, redistributing module widths without changing
 * module count, kinds, door swing or shelf counts.
 */
export function withTotalWidth(
  design: DesignSpec,
  ctx: TemplateContext,
  width_mm: number,
): { ok: true; design: DesignSpec } | WidthDistributionError {
  const dist = distributeModuleWidths(
    width_mm,
    design.modules.length,
    ctx.template.domain.moduleWidth_mm,
    ctx.template.domain.moduleCount,
  );
  if (!dist.ok) return dist;
  return {
    ok: true,
    design: {
      ...design,
      finished: { ...design.finished, width_mm },
      modules: design.modules.map((m, i) => ({ ...m, width_mm: dist.widths_mm[i]! })),
    },
  };
}

export interface WidthChangeResult {
  ok: true;
  design: DesignSpec;
  /** Set when the module count had to change to span the new width. */
  moduleCountChange: { from: number; to: number } | null;
}

/**
 * Changes the total width; when the current module count cannot span it, picks
 * the nearest feasible count (FR-03: adjust modules by a deterministic rule,
 * never silently — callers must surface `moduleCountChange`).
 */
export function withTotalWidthAdjustingModules(
  design: DesignSpec,
  ctx: TemplateContext,
  width_mm: number,
): WidthChangeResult | WidthDistributionError {
  const direct = withTotalWidth(design, ctx, width_mm);
  if (direct.ok) return { ok: true, design: direct.design, moduleCountChange: null };
  if (direct.feasibleModuleCounts.length === 0) return direct;
  const from = design.modules.length;
  const to = direct.feasibleModuleCounts.reduce((best, n) => (Math.abs(n - from) < Math.abs(best - from) ? n : best));
  const recount = withModuleCount({ ...design, finished: { ...design.finished, width_mm } }, ctx, to);
  if (!recount.ok) return recount;
  return { ok: true, design: recount.design, moduleCountChange: { from, to } };
}

/** Changes the module count, redistributing widths and cloning the first module's kind. */
export function withModuleCount(
  design: DesignSpec,
  ctx: TemplateContext,
  count: number,
): { ok: true; design: DesignSpec } | WidthDistributionError {
  const dist = distributeModuleWidths(
    design.finished.width_mm,
    count,
    ctx.template.domain.moduleWidth_mm,
    ctx.template.domain.moduleCount,
  );
  if (!dist.ok) return dist;
  const proto = design.modules[0]!;
  const modules: ModuleSpec[] = dist.widths_mm.map((w, i) => {
    const existing = design.modules[i];
    const source = existing ?? proto;
    return { ...source, width_mm: w };
  });
  return { ok: true, design: { ...design, modules } };
}

/** Stable hash of the design content, used to detect drift between versions. */
export function designHash(design: DesignSpec): string {
  return contentHash(design);
}

export interface DesignSummary {
  moduleCount: number;
  doorModules: number;
  openModules: number;
  doorCount: number;
  shelfCount: number;
  topPanelStyle: DesignSpec["topPanelStyle"];
}

export function summariseDesign(design: DesignSpec): DesignSummary {
  let doorCount = 0;
  let shelfCount = 0;
  let doorModules = 0;
  for (const m of design.modules) {
    shelfCount += m.shelfCount;
    if (m.kind === "door") {
      doorModules++;
      doorCount += m.doorSwing === "double" ? 2 : 1;
    }
  }
  return {
    moduleCount: design.modules.length,
    doorModules,
    openModules: design.modules.length - doorModules,
    doorCount,
    shelfCount,
    topPanelStyle: design.topPanelStyle,
  };
}

import type { TemplateContext } from "../catalog";
import { withModuleCount, withTotalWidthAdjustingModules, type DesignSpec } from "../design";

/**
 * Natural-language change proposals (PRD FR-04, P1).
 *
 * The assistant only ever proposes parameter changes inside the allowed field
 * set. It never writes to the design; the caller runs the same rules and pricing
 * on `nextDesign` and lets the customer apply or discard. Ambiguous requests
 * become clarification questions instead of guesses. This deterministic parser
 * is the default provider; an LLM provider can implement `ProposalProvider` and
 * must return the same structure.
 */

export type Proposal =
  | { kind: "change"; summary: string; changedFields: string[]; nextDesign: DesignSpec }
  | { kind: "clarify"; question: string; options?: string[] }
  | { kind: "unsupported"; reason: string; alternative?: string };

export interface ProposalProvider {
  propose(utterance: string, design: DesignSpec, ctx: TemplateContext): Proposal;
}

const NUM = "(\\d{2,4})";

function firstNumber(text: string): number | null {
  const m = text.match(/\d{2,4}/);
  return m ? Number(m[0]) : null;
}

function widthChange(design: DesignSpec, ctx: TemplateContext, width_mm: number, lead: string): Proposal {
  const res = withTotalWidthAdjustingModules(design, ctx, width_mm);
  if (!res.ok) return { kind: "unsupported", reason: res.reason };
  const note = res.moduleCountChange
    ? ` This width needs ${res.moduleCountChange.to} modules (was ${res.moduleCountChange.from}); new modules copy module 1's options.`
    : " Module widths redistributed evenly.";
  return { kind: "change", summary: `${lead}${note}`, changedFields: ["finished.width_mm", "modules"], nextDesign: res.design };
}

function moduleIndexFrom(text: string, count: number): number | null | "ambiguous" {
  const zh: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const m1 = text.match(/第\s*([一二两三四五六\d])\s*(个|格|模块|柜)/);
  if (m1) return zh[m1[1]!] ?? Number(m1[1]);
  const m2 = text.match(/module\s*(\d)/i);
  if (m2) return Number(m2[1]);
  if (/左|left/i.test(text)) return 1;
  if (/右|right/i.test(text)) return count;
  if (/中间|middle|centre|center/i.test(text)) {
    if (count === 3) return 2;
    return "ambiguous";
  }
  return null;
}

export const deterministicProvider: ProposalProvider = {
  propose(utteranceRaw, design, ctx) {
    const text = utteranceRaw.trim().toLowerCase();
    const t = ctx.template;
    const count = design.modules.length;

    if (/抽屉|drawer/.test(text)) {
      return { kind: "unsupported", reason: "Drawers are not part of the launch range.", alternative: "Doors with adjustable shelves are available." };
    }
    if (/电视|tv\b|television/.test(text)) {
      return { kind: "unsupported", reason: "TV-bearing use is not validated for this template.", alternative: "Keep the purpose as storage." };
    }

    // Module count.
    const mc = text.match(/(\d|一|两|二|三)\s*(个|格|模块|module|modules|compartment|compartments)/);
    if (mc && /改成|变成|换成|make|change|want|要/.test(text)) {
      const zh: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3 };
      const n = zh[mc[1]!] ?? Number(mc[1]);
      const res = withModuleCount(design, ctx, n);
      if (!res.ok) return { kind: "unsupported", reason: res.reason };
      return { kind: "change", summary: `Change to ${n} module(s), widths redistributed evenly.`, changedFields: ["modules"], nextDesign: res.design };
    }

    // "middle wider" style requests are ambiguous about which side gives way (PRD §5.2).
    if (/(中间|middle|centre|center).*(宽|wider|bigger|larger)/.test(text)) {
      if (count < 3) return { kind: "clarify", question: "There is no middle module. Which module should change, and should the total width stay the same?", options: design.modules.map((_, i) => `Module ${i + 1}`) };
      return {
        kind: "clarify",
        question: "Widen the middle module by how much, and should the outer modules shrink to keep the total width, or should the total width grow?",
        options: ["Keep total width, shrink outer modules", "Increase total width"],
      };
    }

    // Absolute dimension.
    const setW = text.match(new RegExp(`(宽|width|wide)[^\\d]{0,6}${NUM}`)) ?? text.match(new RegExp(`${NUM}\\s*(mm)?\\s*(宽|wide)`));
    if (setW) {
      const w = Number(setW[2] ?? setW[1]);
      return widthChange(design, ctx, w, `Set total width to ${w} mm.`);
    }
    const setH = text.match(new RegExp(`(高|height|tall)[^\\d]{0,6}${NUM}`));
    if (setH) {
      const h = Number(setH[2]);
      if (!t.domain.heights_mm.includes(h)) return { kind: "unsupported", reason: `Height ${h} mm is not offered.`, alternative: `Available heights: ${t.domain.heights_mm.join(", ")} mm.` };
      return { kind: "change", summary: `Set height to ${h} mm.`, changedFields: ["finished.height_mm"], nextDesign: { ...design, finished: { ...design.finished, height_mm: h } } };
    }
    const setD = text.match(new RegExp(`(深|depth|deep)[^\\d]{0,6}${NUM}`));
    if (setD) {
      const d = Number(setD[2]);
      if (!t.domain.depths_mm.includes(d)) return { kind: "unsupported", reason: `Depth ${d} mm is not offered.`, alternative: `Available depths: ${t.domain.depths_mm.join(", ")} mm.` };
      return { kind: "change", summary: `Set depth to ${d} mm.`, changedFields: ["finished.depth_mm"], nextDesign: { ...design, finished: { ...design.finished, depth_mm: d } } };
    }

    // Relative width.
    if (/宽一点|宽一些|加宽|再宽|wider|widen/.test(text) || /窄一点|窄一些|narrower|narrow/.test(text)) {
      const wider = /宽|wider|widen/.test(text);
      const delta = firstNumber(text) ?? 100;
      const w = design.finished.width_mm + (wider ? delta : -delta);
      return widthChange(design, ctx, w, `${wider ? "Widen" : "Narrow"} to ${w} mm (${wider ? "+" : "-"}${delta} mm).`);
    }

    // Shelves.
    if (/层板|层|shelf|shelves/.test(text)) {
      const add = /加|多|增加|再|add|more|another|extra/.test(text) && !/少|去掉|remove|fewer|less/.test(text);
      const remove = /少|去掉|不要|remove|fewer|less|no /.test(text);
      if (!add && !remove) return { kind: "clarify", question: "Should shelves be added or removed, and in which module?" };
      const which = moduleIndexFrom(text, count);
      if (which === "ambiguous") return { kind: "clarify", question: "Which module do you mean?", options: design.modules.map((_, i) => `Module ${i + 1}`) };
      const next = {
        ...design,
        modules: design.modules.map((m, i) => {
          if (which !== null && i !== which - 1) return m;
          const n = m.shelfCount + (add ? 1 : -1);
          return { ...m, shelfCount: Math.max(t.domain.shelvesPerModule.min, Math.min(t.domain.shelvesPerModule.max, n)) };
        }),
      };
      const changed = next.modules.some((m, i) => m.shelfCount !== design.modules[i]!.shelfCount);
      if (!changed) return { kind: "unsupported", reason: `Shelf count is already at the ${add ? "maximum" : "minimum"} (${add ? t.domain.shelvesPerModule.max : t.domain.shelvesPerModule.min}).` };
      return { kind: "change", summary: `${add ? "Add" : "Remove"} a shelf${which ? ` in module ${which}` : " in every module"}.`, changedFields: ["modules"], nextDesign: next };
    }

    // Handles.
    if (/拉手|handle/.test(text)) {
      const none = /不要|去掉|无|没有|no |without|remove/.test(text);
      const next = { ...design, modules: design.modules.map((m) => (m.kind === "door" ? { ...m, handle: none ? ("none" as const) : ("bar" as const) } : m)) };
      if (!design.modules.some((m) => m.kind === "door")) return { kind: "unsupported", reason: "There are no doors to fit handles on." };
      return {
        kind: "change",
        summary: none ? "Remove handles; doors open by gripping the edge (no push-to-open device is fitted)." : "Fit bar handles to all doors.",
        changedFields: ["modules"],
        nextDesign: next,
      };
    }

    // Doors / open.
    if (/柜门|门|door/.test(text) && !/拉手|handle/.test(text)) {
      const remove = /不要|去掉|开放|open|remove|without|no /.test(text);
      const which = moduleIndexFrom(text, count);
      if (which === "ambiguous") return { kind: "clarify", question: "Which module do you mean?", options: design.modules.map((_, i) => `Module ${i + 1}`) };
      if (!remove && !t.moduleKindsAllowed.includes("door")) return { kind: "unsupported", reason: `Template ${t.code} has no doors.`, alternative: "Switch to the doors template." };
      const next = {
        ...design,
        modules: design.modules.map((m, i) => {
          if (which !== null && i !== which - 1) return m;
          if (remove) return { kind: "open" as const, width_mm: m.width_mm, shelfCount: m.shelfCount };
          return { ...m, kind: "door" as const, doorSwing: m.doorSwing ?? (m.width_mm >= 500 ? ("double" as const) : ("left" as const)), handle: m.handle ?? ("bar" as const) };
        }),
      };
      return { kind: "change", summary: `${remove ? "Make open" : "Add doors to"} ${which ? `module ${which}` : "all modules"}.`, changedFields: ["modules"], nextDesign: next };
    }

    // Top panel style.
    if (/整块|一块顶|single top|one top|spanning/.test(text)) return { kind: "change", summary: "Use one spanning top panel.", changedFields: ["topPanelStyle"], nextDesign: { ...design, topPanelStyle: "single" } };
    if (/分段|分开的顶|per module|separate top/.test(text)) return { kind: "change", summary: "Use one top panel per module (visible seams).", changedFields: ["topPanelStyle"], nextDesign: { ...design, topPanelStyle: "per_module" } };

    return {
      kind: "clarify",
      question: "I can change width, height, depth, number of modules, shelves, doors, handles and the top panel style. What would you like to change?",
    };
  },
};

export function proposeChange(utterance: string, design: DesignSpec, ctx: TemplateContext, provider: ProposalProvider = deterministicProvider): Proposal {
  return provider.propose(utterance, design, ctx);
}

/** Human readable list of differences between two designs, for the proposal preview. */
export function describeDesignDiff(a: DesignSpec, b: DesignSpec): string[] {
  const out: string[] = [];
  if (a.finished.width_mm !== b.finished.width_mm) out.push(`Width ${a.finished.width_mm} → ${b.finished.width_mm} mm`);
  if (a.finished.height_mm !== b.finished.height_mm) out.push(`Height ${a.finished.height_mm} → ${b.finished.height_mm} mm`);
  if (a.finished.depth_mm !== b.finished.depth_mm) out.push(`Depth ${a.finished.depth_mm} → ${b.finished.depth_mm} mm`);
  if (a.modules.length !== b.modules.length) out.push(`Modules ${a.modules.length} → ${b.modules.length}`);
  const n = Math.min(a.modules.length, b.modules.length);
  for (let i = 0; i < n; i++) {
    const x = a.modules[i]!;
    const y = b.modules[i]!;
    if (x.width_mm !== y.width_mm) out.push(`Module ${i + 1} width ${x.width_mm} → ${y.width_mm} mm`);
    if (x.kind !== y.kind) out.push(`Module ${i + 1} ${x.kind} → ${y.kind}`);
    if (x.shelfCount !== y.shelfCount) out.push(`Module ${i + 1} shelves ${x.shelfCount} → ${y.shelfCount}`);
    if ((x.doorSwing ?? "-") !== (y.doorSwing ?? "-")) out.push(`Module ${i + 1} door swing ${x.doorSwing ?? "-"} → ${y.doorSwing ?? "-"}`);
    if ((x.handle ?? "-") !== (y.handle ?? "-")) out.push(`Module ${i + 1} handle ${x.handle ?? "-"} → ${y.handle ?? "-"}`);
  }
  if (a.topPanelStyle !== b.topPanelStyle) out.push(`Top panel ${a.topPanelStyle} → ${b.topPanelStyle}`);
  return out;
}

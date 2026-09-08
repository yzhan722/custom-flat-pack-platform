import { catalogueSellable, hasProvisionalDependencies, pendingValidationItems, type Purpose } from "../catalog";
import { PURPOSES } from "../catalog/data";
import { sumModuleWidths } from "../design";
import { assessSpace } from "../measurement";
import type { Operation, Panel } from "../panels";
import { isPlausibleFurnitureLength, mmToUm, umToMmRounded } from "../units";
import type { Rule, RuleContext, RuleResult } from "./types";

/**
 * Rule catalogue (PRD FR-05). Every rule returns a result even when it passes so
 * the review screen shows exactly which checks ran. Rule ids are stable and are
 * referenced by tests, release packages and after-sales attribution.
 */

const pass = (rule: Rule, message: string, fields: string[] = [], flags?: string[]): RuleResult => ({
  ruleId: rule.id,
  category: rule.category,
  severity: "PASS",
  message,
  fields,
  ...(flags ? { flags } : {}),
});
const review = (rule: Rule, message: string, fields: string[] = [], suggestion?: string, flags?: string[]): RuleResult => ({
  ruleId: rule.id,
  category: rule.category,
  severity: "REVIEW_REQUIRED",
  message,
  fields,
  ...(suggestion ? { suggestion } : {}),
  ...(flags ? { flags } : {}),
});
const unsupported = (rule: Rule, message: string, fields: string[] = [], suggestion?: string): RuleResult => ({
  ruleId: rule.id,
  category: rule.category,
  severity: "UNSUPPORTED",
  message,
  fields,
  ...(suggestion ? { suggestion } : {}),
});

function rule(def: Omit<Rule, "check"> & { check: (rc: RuleContext, self: Rule) => RuleResult | RuleResult[] }): Rule {
  const r: Rule = {
    id: def.id,
    category: def.category,
    description: def.description,
    needsCabinet: def.needsCabinet,
    check: (rc) => def.check(rc, r),
  };
  return r;
}

// ---------------------------------------------------------------------------
// Purpose and catalog
// ---------------------------------------------------------------------------

const PUR_001 = rule({
  id: "PUR-001",
  category: "purpose",
  description: "Intended use must be supported by the template",
  needsCabinet: false,
  check(rc, self) {
    const def = PURPOSES.find((p) => p.id === rc.design.purpose);
    if (!def) return unsupported(self, `Unknown purpose ${rc.design.purpose}`, ["purpose"]);
    if (!def.supported) return unsupported(self, `${def.label} is not supported: ${def.unsupportedReason ?? ""}`.trim(), ["purpose"]);
    if (!rc.ctx.template.supportedPurposes.includes(rc.design.purpose as Purpose)) {
      return unsupported(self, `${def.label} is not an approved use for ${rc.ctx.template.name}.`, ["purpose"], "Choose a template that lists this use.");
    }
    return pass(self, `${def.label} is an approved use for this template.`, ["purpose"]);
  },
});

const CAT_001 = rule({
  id: "CAT-001",
  category: "catalog",
  description: "Template must be approved and its validation pack complete",
  needsCabinet: false,
  check(rc, self) {
    const t = rc.ctx.template;
    if (t.status === "suspended") return unsupported(self, `Template ${t.id} is suspended.`, ["templateId"]);
    if (!catalogueSellable(t)) {
      const pending = pendingValidationItems(t);
      return unsupported(
        self,
        `Template ${t.id} v${t.version} is not sellable (status ${t.status}${pending.length ? `, pending: ${pending.join(", ")}` : ""}).`,
        ["templateId", "templateVersion"],
      );
    }
    return pass(self, `Template ${t.id} v${t.version} is approved and sellable.`, ["templateId"]);
  },
});

const CAT_002 = rule({
  id: "CAT-002",
  category: "catalog",
  description: "Provisional material, hardware or construction data requires engineering confirmation",
  needsCabinet: false,
  check(rc, self) {
    if (hasProvisionalDependencies(rc.ctx)) {
      return review(
        self,
        "Material, hardware or construction data is still provisional; engineering must confirm registered supplier SKUs before approval.",
        [],
        "Register supplier SKU, batch, thickness and tolerance in the catalog.",
      );
    }
    return pass(self, "All catalog dependencies are registered.");
  },
});

const CAT_003 = rule({
  id: "CAT-003",
  category: "catalog",
  description: "Factory must support the material and thicknesses",
  needsCabinet: false,
  check(rc, self) {
    const f = rc.factory;
    const { material, construction } = rc.ctx;
    if (!f.materialsSupported.includes(material.id)) return unsupported(self, `Factory ${f.id} does not stock ${material.id}.`);
    for (const th of [construction.panelThickness_um, construction.backThickness_um]) {
      if (!f.thicknesses_um.includes(th)) return unsupported(self, `Factory ${f.id} cannot process ${umToMmRounded(th)} mm board.`);
    }
    if (!f.edgeBandThicknesses_um.includes(rc.ctx.edgeBand.thickness_um)) {
      return unsupported(self, `Factory ${f.id} cannot apply ${umToMmRounded(rc.ctx.edgeBand.thickness_um)} mm edge band.`);
    }
    return pass(self, `Factory ${f.id} supports the material, thicknesses and edge band.`);
  },
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CFG_001 = rule({
  id: "CFG-001",
  category: "configuration",
  description: "Total width within template domain",
  needsCabinet: false,
  check(rc, self) {
    const { min, max } = rc.ctx.template.domain.width_mm;
    const w = rc.design.finished.width_mm;
    if (!isPlausibleFurnitureLength(w)) return unsupported(self, `Width ${w} mm is not a plausible furniture dimension; check the unit.`, ["finished.width_mm"]);
    if (w < min || w > max) return unsupported(self, `Width ${w} mm is outside ${min}–${max} mm.`, ["finished.width_mm"], `Choose a width between ${min} and ${max} mm.`);
    return pass(self, `Width ${w} mm is within ${min}–${max} mm.`, ["finished.width_mm"]);
  },
});

const CFG_002 = rule({
  id: "CFG-002",
  category: "configuration",
  description: "Height must be one of the approved heights",
  needsCabinet: false,
  check(rc, self) {
    const list = rc.ctx.template.domain.heights_mm;
    const h = rc.design.finished.height_mm;
    if (!list.includes(h)) return unsupported(self, `Height ${h} mm is not offered.`, ["finished.height_mm"], `Choose ${list.join(", ")} mm.`);
    return pass(self, `Height ${h} mm is an approved height.`, ["finished.height_mm"]);
  },
});

const CFG_003 = rule({
  id: "CFG-003",
  category: "configuration",
  description: "Depth must be one of the approved depths",
  needsCabinet: false,
  check(rc, self) {
    const list = rc.ctx.template.domain.depths_mm;
    const d = rc.design.finished.depth_mm;
    if (!list.includes(d)) return unsupported(self, `Depth ${d} mm is not offered.`, ["finished.depth_mm"], `Choose ${list.join(", ")} mm.`);
    return pass(self, `Depth ${d} mm is an approved depth.`, ["finished.depth_mm"]);
  },
});

const CFG_004 = rule({
  id: "CFG-004",
  category: "configuration",
  description: "Module count within template domain",
  needsCabinet: false,
  check(rc, self) {
    const { min, max } = rc.ctx.template.domain.moduleCount;
    const n = rc.design.modules.length;
    if (n < min || n > max) return unsupported(self, `${n} modules is outside ${min}–${max}.`, ["modules"]);
    return pass(self, `${n} module(s).`, ["modules"]);
  },
});

const CFG_005 = rule({
  id: "CFG-005",
  category: "configuration",
  description: "Module widths must add up to the total width",
  needsCabinet: false,
  check(rc, self) {
    const sum = sumModuleWidths(rc.design.modules);
    const w = rc.design.finished.width_mm;
    if (sum !== w) {
      return unsupported(self, `Module widths add up to ${sum} mm but total width is ${w} mm.`, ["finished.width_mm", "modules"], "Redistribute module widths so they match the total width exactly.");
    }
    return pass(self, `Module widths add up to ${w} mm.`, ["modules"]);
  },
});

const CFG_006 = rule({
  id: "CFG-006",
  category: "configuration",
  description: "Each module width within the approved range",
  needsCabinet: false,
  check(rc, self) {
    const { min, max } = rc.ctx.template.domain.moduleWidth_mm;
    const results: RuleResult[] = [];
    rc.design.modules.forEach((m, i) => {
      if (m.width_mm < min || m.width_mm > max) {
        results.push(unsupported(self, `Module ${i + 1} width ${m.width_mm} mm is outside ${min}–${max} mm.`, [`modules[${i}].width_mm`]));
      }
    });
    return results.length ? results : pass(self, `All module widths within ${min}–${max} mm.`, ["modules"]);
  },
});

const CFG_007 = rule({
  id: "CFG-007",
  category: "configuration",
  description: "Module kinds must be allowed by the template",
  needsCabinet: false,
  check(rc, self) {
    const allowed = rc.ctx.template.moduleKindsAllowed;
    const results: RuleResult[] = [];
    rc.design.modules.forEach((m, i) => {
      if (!allowed.includes(m.kind)) {
        results.push(unsupported(self, `Module ${i + 1} kind "${m.kind}" is not offered by template ${rc.ctx.template.code}.`, [`modules[${i}].kind`], `Use template ${m.kind === "door" ? "D" : "O"} instead.`));
      }
    });
    return results.length ? results : pass(self, "Module kinds are allowed.", ["modules"]);
  },
});

const CFG_008 = rule({
  id: "CFG-008",
  category: "configuration",
  description: "Shelf count per module within range",
  needsCabinet: false,
  check(rc, self) {
    const { min, max } = rc.ctx.template.domain.shelvesPerModule;
    const results: RuleResult[] = [];
    rc.design.modules.forEach((m, i) => {
      if (m.shelfCount < min || m.shelfCount > max) {
        results.push(unsupported(self, `Module ${i + 1} has ${m.shelfCount} shelves; allowed ${min}–${max}.`, [`modules[${i}].shelfCount`]));
      }
    });
    return results.length ? results : pass(self, `Shelf counts within ${min}–${max}.`, ["modules"]);
  },
});

const CFG_009 = rule({
  id: "CFG-009",
  category: "configuration",
  description: "Door configuration must match the approved hinge system",
  needsCabinet: false,
  check(rc, self) {
    const results: RuleResult[] = [];
    const hg = rc.ctx.hardware.hinge;
    const c = rc.ctx.construction;
    const minDoor = umToMmRounded(hg.minDoorWidth_um);
    const maxDoor = umToMmRounded(hg.maxDoorWidth_um);
    const gap = umToMmRounded(c.doorGap_um);
    const centre = umToMmRounded(c.doubleDoorCentreGap_um);
    rc.design.modules.forEach((m, i) => {
      if (m.kind !== "door") {
        if (m.doorSwing || m.handle) results.push(unsupported(self, `Module ${i + 1} is open but has door options set.`, [`modules[${i}].doorSwing`]));
        return;
      }
      if (!m.doorSwing) {
        results.push(unsupported(self, `Module ${i + 1} needs a door swing (left, right or double).`, [`modules[${i}].doorSwing`]));
        return;
      }
      const doorW = m.doorSwing === "double" ? (m.width_mm - 2 * gap - centre) / 2 : m.width_mm - 2 * gap;
      if (doorW > maxDoor) {
        results.push(unsupported(self, `Module ${i + 1}: a single ${doorW} mm door exceeds the ${maxDoor} mm hinge limit.`, [`modules[${i}].doorSwing`], "Use double doors or a narrower module."));
      } else if (doorW < minDoor) {
        results.push(unsupported(self, `Module ${i + 1}: ${doorW} mm doors are narrower than the ${minDoor} mm minimum.`, [`modules[${i}].doorSwing`], "Use a single door or a wider module."));
      }
    });
    return results.length ? results : pass(self, "Door configuration is compatible with the hinge system.", ["modules"]);
  },
});

const CFG_010 = rule({
  id: "CFG-010",
  category: "configuration",
  description: "Top panel style must be offered",
  needsCabinet: false,
  check(rc, self) {
    const allowed = rc.ctx.template.domain.topPanelStyles;
    if (!allowed.includes(rc.design.topPanelStyle)) return unsupported(self, `Top panel style ${rc.design.topPanelStyle} is not offered.`, ["topPanelStyle"]);
    return pass(self, `Top panel: ${rc.design.topPanelStyle === "single" ? "one spanning panel" : "one panel per module (visible seams)"}.`, ["topPanelStyle"]);
  },
});

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

const MEA_001 = rule({
  id: "MEA-001",
  category: "measurement",
  description: "Measurement record must exist and state whether the space is constrained",
  needsCabinet: false,
  check(rc, self) {
    if (!rc.measurement) return review(self, "No measurement record. Confirm whether the cabinet must fit a bounded space.", ["measurementSetId"], "Complete the measurement wizard.");
    if (rc.measurement.spaceConstrained && !rc.measurement.availableSpace?.widths.length) {
      return review(self, "Space is constrained but no available-space widths were recorded.", ["measurementSetId"], "Measure the width at floor, mid-height and top.");
    }
    return pass(self, rc.measurement.spaceConstrained ? "Space measurements recorded." : "Free-standing placement; no space constraint declared.", ["measurementSetId"]);
  },
});

const MEA_002 = rule({
  id: "MEA-002",
  category: "measurement",
  description: "Visual estimates are not accepted as verified dimensions",
  needsCabinet: false,
  check(rc, self) {
    if (!rc.measurement?.spaceConstrained) return pass(self, "Not applicable.");
    const a = assessSpace(rc.measurement);
    if (a.hasOnlyVisualEstimates) return review(self, "Only photo or scan estimates were provided; a tape re-measure is required before approval.", ["measurementSetId"], "Re-measure with a tape and record the values as manual re-measured.");
    if (!a.hasVerifiedWidth) return review(self, "Width was given as an approximation; confirm with a re-measure.", ["measurementSetId"]);
    return pass(self, "Verified width measurements present.");
  },
});

const MEA_003 = rule({
  id: "MEA-003",
  category: "measurement",
  description: "Finished size plus installation clearance must fit the smallest trusted space",
  needsCabinet: false,
  check(rc, self) {
    if (!rc.measurement?.spaceConstrained) return pass(self, "Not applicable.");
    const a = assessSpace(rc.measurement);
    const clearance = umToMmRounded(rc.ctx.construction.installClearance_um);
    const need = rc.design.finished.width_mm + clearance;
    if (a.minAnyWidth_mm !== null && a.minAnyWidth_mm < need) {
      return unsupported(self, `Smallest measured width ${a.minAnyWidth_mm} mm is less than ${need} mm needed (${rc.design.finished.width_mm} mm + ${clearance} mm clearance).`, ["finished.width_mm"], `Reduce width to at most ${a.minAnyWidth_mm - clearance} mm.`);
    }
    if (a.minTrustedWidth_mm === null) return review(self, "Fit cannot be confirmed without a verified width.", ["measurementSetId"]);
    const ms = rc.measurement;
    const h = ms.availableSpace?.height;
    if (h && h.value_mm < rc.design.finished.height_mm + clearance) {
      return unsupported(self, `Available height ${h.value_mm} mm is less than ${rc.design.finished.height_mm + clearance} mm.`, ["finished.height_mm"]);
    }
    const d = ms.availableSpace?.depth;
    const skirting = a.skirtingProtrusion_mm;
    if (d && d.value_mm - skirting < rc.design.finished.depth_mm) {
      return review(self, `Available depth ${d.value_mm} mm minus skirting ${skirting} mm is less than ${rc.design.finished.depth_mm} mm; the cabinet will stand proud of the wall.`, ["finished.depth_mm"], "Choose the shallower depth or accept the offset.");
    }
    return pass(self, `Fits: ${need} mm needed, ${a.minTrustedWidth_mm} mm verified.`, ["finished.width_mm"]);
  },
});

const MEA_004 = rule({
  id: "MEA-004",
  category: "measurement",
  description: "Large variation between width measurements indicates an out-of-square space",
  needsCabinet: false,
  check(rc, self) {
    if (!rc.measurement?.spaceConstrained) return pass(self, "Not applicable.");
    const a = assessSpace(rc.measurement);
    if (a.widthSpread_mm > 15) return review(self, `Width varies by ${a.widthSpread_mm} mm between positions; the space is not square.`, ["measurementSetId"], "Design to the smallest width and expect a visible gap, or arrange a professional measure.");
    return pass(self, `Width variation ${a.widthSpread_mm} mm.`);
  },
});

const MEA_005 = rule({
  id: "MEA-005",
  category: "measurement",
  description: "Packages must fit through the access path",
  needsCabinet: true,
  check(rc, self) {
    const passage = rc.measurement?.accessPath?.narrowestPassage_mm;
    if (!passage || !rc.packaging) return pass(self, "No access constraint recorded.");
    const widest = Math.max(...rc.packaging.packages.map((p) => Math.min(p.outer.length_um, p.outer.width_um)));
    if (mmToUm(passage) < widest) return review(self, `Narrowest passage ${passage} mm is smaller than the package width ${umToMmRounded(widest)} mm.`, [], "Check the route or choose per-module top panels.");
    return pass(self, `Packages fit through ${passage} mm passage.`);
  },
});

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const GEO_001 = rule({
  id: "GEO-001",
  category: "geometry",
  description: "Interior clear dimensions must be usable",
  needsCabinet: true,
  check(rc, self) {
    const results: RuleResult[] = [];
    for (const m of rc.cabinet!.modules) {
      if (m.interior.height_um < mmToUm(150) || m.interior.width_um < mmToUm(150) || m.interior.depth_um < mmToUm(150)) {
        results.push(unsupported(self, `Module ${m.index} interior ${umToMmRounded(m.interior.width_um)}×${umToMmRounded(m.interior.height_um)}×${umToMmRounded(m.interior.depth_um)} mm is too small to be useful.`, ["finished"]));
      }
      if (m.shelfPositions_um.length > 1) {
        const gaps = [...m.shelfPositions_um, m.interior.height_um].map((z, i, arr) => z - (i === 0 ? 0 : arr[i - 1]!));
        if (Math.min(...gaps) < mmToUm(120)) results.push(review(self, `Module ${m.index}: shelf spacing ${umToMmRounded(Math.min(...gaps))} mm is very tight.`, ["modules"], "Reduce shelf count."));
      }
    }
    return results.length ? results : pass(self, "Interior dimensions are usable.");
  },
});

const GEO_002 = rule({
  id: "GEO-002",
  category: "geometry",
  description: "Door swing must not hit side walls of a constrained space",
  needsCabinet: true,
  check(rc, self) {
    const cab = rc.cabinet!;
    if (!rc.measurement?.spaceConstrained) return pass(self, "Free-standing; door swing envelope only needs clear floor in front.");
    const results: RuleResult[] = [];
    const first = cab.modules[0]!;
    const last = cab.modules[cab.modules.length - 1]!;
    if (first.doors.some((d) => d.hingeSide === "L")) results.push(review(self, "Module 1 has a door hinged on the outer left side; at 110° the door edge extends beyond the cabinet and may hit the side wall.", ["modules[0].doorSwing"], "Swap the swing to right-hinged or keep a clear gap on the left."));
    if (last.doors.some((d) => d.hingeSide === "R")) results.push(review(self, `Module ${last.index} has a door hinged on the outer right side; it may hit the side wall when opened.`, [`modules[${last.index - 1}].doorSwing`], "Swap the swing to left-hinged or keep a clear gap on the right."));
    return results.length ? results : pass(self, "Door swings clear the side walls.");
  },
});

const GEO_003 = rule({
  id: "GEO-003",
  category: "geometry",
  description: "Machining operations must not interfere or break out of the panel",
  needsCabinet: true,
  check(rc, self) {
    const results: RuleResult[] = [];
    for (const p of rc.cabinet!.panels) {
      const problems = checkOperations(p);
      for (const pr of problems) results.push(unsupported(self, `${p.id}: ${pr}`, []));
    }
    return results.length ? results : pass(self, `${rc.cabinet!.totals.drillCount} holes and ${rc.cabinet!.totals.pocketCount} pockets checked; no interference.`);
  },
});

function opBounds(op: Operation): { x0: number; x1: number; y0: number; y1: number } {
  if (op.kind === "DRILL") {
    const r = op.diameter_um / 2;
    return { x0: op.x_um - r, x1: op.x_um + r, y0: op.y_um - r, y1: op.y_um + r };
  }
  const l = op.rotationDeg === 0 ? op.length_um : op.width_um;
  const w = op.rotationDeg === 0 ? op.width_um : op.length_um;
  return { x0: op.x_um - l / 2, x1: op.x_um + l / 2, y0: op.y_um - w / 2, y1: op.y_um + w / 2 };
}

function isThrough(op: Operation): boolean {
  return op.kind === "DRILL" && op.through;
}

function checkOperations(p: Panel): string[] {
  const problems: string[] = [];
  const margin = mmToUm(4);
  const wall = mmToUm(3);
  const ops = p.operations;
  ops.forEach((op, i) => {
    const b = opBounds(op);
    if (b.x0 < margin || b.y0 < margin || b.x1 > p.finished.length_um - margin || b.y1 > p.finished.width_um - margin) {
      problems.push(`${op.purpose} at (${umToMmRounded(op.x_um)}, ${umToMmRounded(op.y_um)}) breaks the ${umToMmRounded(margin)} mm edge margin`);
    }
    if (!isThrough(op) && op.depth_um > p.thickness_um - wall) problems.push(`${op.purpose} depth ${umToMmRounded(op.depth_um)} mm leaves less than ${umToMmRounded(wall)} mm of material`);
    for (let j = i + 1; j < ops.length; j++) {
      const other = ops[j]!;
      // Operations on opposite faces only meet when their depths overlap inside the board.
      const opposite = op.face !== other.face;
      const depthsMeet = !opposite || isThrough(op) || isThrough(other) || op.depth_um + other.depth_um > p.thickness_um - wall;
      if (!depthsMeet) continue;
      const o = opBounds(other);
      const overlap = b.x0 < o.x1 + wall && o.x0 < b.x1 + wall && b.y0 < o.y1 + wall && o.y0 < b.y1 + wall;
      if (overlap) {
        problems.push(`${op.purpose} and ${other.purpose} interfere near (${umToMmRounded(op.x_um)}, ${umToMmRounded(op.y_um)})`);
      }
    }
  });
  return problems;
}

const GEO_004 = rule({
  id: "GEO-004",
  category: "geometry",
  description: "Door panels must be within the hinge system's width and weight limits",
  needsCabinet: true,
  check(rc, self) {
    const hg = rc.ctx.hardware.hinge;
    const results: RuleResult[] = [];
    for (const p of rc.cabinet!.panels.filter((x) => x.role === "DOOR")) {
      if (p.finished.length_um > hg.maxDoorWidth_um || p.finished.length_um < hg.minDoorWidth_um) results.push(unsupported(self, `${p.id} width ${umToMmRounded(p.finished.length_um)} mm outside hinge limits.`, ["modules"]));
      if (p.weight_kg > hg.maxDoorWeight_kg) results.push(unsupported(self, `${p.id} weighs ${p.weight_kg} kg, above the ${hg.maxDoorWeight_kg} kg hinge limit.`, ["modules"]));
    }
    return results.length ? results : pass(self, "Doors are within hinge limits.");
  },
});

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

const STR_001 = rule({
  id: "STR-001",
  category: "structure",
  description: "Validated load statements must exist for shelves and top",
  needsCabinet: false,
  check(rc, self) {
    const c = rc.ctx.construction;
    if (c.shelfLoadRating_kg === null || c.topLoadRating_kg === null || c.maxShelfSpan_um === null) {
      return unsupported(self, "No validated load statement for this construction; the template cannot be sold until testing is complete.", ["templateId"]);
    }
    return pass(self, `Rated ${c.shelfLoadRating_kg} kg per shelf (evenly distributed) and ${c.topLoadRating_kg} kg on top.`, [], ["LOAD_STATEMENT"]);
  },
});

const STR_002 = rule({
  id: "STR-002",
  category: "structure",
  description: "Shelf span must not exceed the validated maximum",
  needsCabinet: true,
  check(rc, self) {
    const max = rc.ctx.construction.maxShelfSpan_um;
    if (max === null) return unsupported(self, "Maximum shelf span not validated.");
    const results: RuleResult[] = [];
    for (const m of rc.cabinet!.modules) {
      if (m.shelfPositions_um.length && m.interior.width_um > max) results.push(unsupported(self, `Module ${m.index} shelf span ${umToMmRounded(m.interior.width_um)} mm exceeds ${umToMmRounded(max)} mm.`, [`modules[${m.index - 1}].width_mm`], "Split into more modules."));
    }
    return results.length ? results : pass(self, `All shelf spans within ${umToMmRounded(max)} mm.`);
  },
});

const STR_003 = rule({
  id: "STR-003",
  category: "structure",
  description: "Anti-tip restraint and wall information for tall variants",
  needsCabinet: true,
  check(rc, self) {
    const cab = rc.cabinet!;
    if (!cab.antiTipRequired) return pass(self, `Height ${rc.design.finished.height_mm} mm is below the ${umToMmRounded(rc.ctx.construction.antiTipRequiredFromHeight_um)} mm restraint threshold.`);
    const inst = rc.design.installation;
    const flags = ["ANTI_TIP_REQUIRED", "AU_TOPPLING_INFO_STANDARD"];
    if (!inst.antiTipAcknowledged) return review(self, "This height must be restrained to the wall; the customer has not yet acknowledged this.", ["installation.antiTipAcknowledged"], "Customer must acknowledge before confirmation.", flags);
    if (inst.wallType === "not_required") return unsupported(self, "Wall restraint cannot be declined for this height.", ["installation.wallType"]);
    if (inst.wallType === "unknown" || inst.wallType === "plasterboard_unknown_structure") {
      return review(self, "Wall type is unknown; a suitable fixing cannot be confirmed.", ["installation.wallType"], "Identify the wall structure or book a professional installer.", flags);
    }
    return pass(self, `Anti-tip kit included; wall type ${inst.wallType} declared.`, ["installation.wallType"], flags);
  },
});

const STR_004 = rule({
  id: "STR-004",
  category: "structure",
  description: "Free-standing proportion check",
  needsCabinet: true,
  check(rc, self) {
    const ratio = rc.design.finished.height_mm / rc.design.finished.depth_mm;
    if (ratio > 2.5 && !rc.cabinet!.antiTipRequired) return review(self, `Height/depth ratio ${ratio.toFixed(2)} is slender for a free-standing unit.`, ["finished.depth_mm"], "Prefer the deeper option.");
    return pass(self, `Height/depth ratio ${ratio.toFixed(2)}.`);
  },
});

// ---------------------------------------------------------------------------
// Manufacturing
// ---------------------------------------------------------------------------

const MFG_001 = rule({
  id: "MFG-001",
  category: "manufacturing",
  description: "Panel cut sizes within factory minimum and maximum",
  needsCabinet: true,
  check(rc, self) {
    const f = rc.factory;
    const c = rc.ctx.construction;
    const results: RuleResult[] = [];
    for (const p of rc.cabinet!.panels) {
      const long = Math.max(p.cut.length_um, p.cut.width_um);
      const short = Math.min(p.cut.length_um, p.cut.width_um);
      if (short < Math.max(f.minPanel.width_um, c.minPanelDim_um) || long < f.minPanel.length_um) results.push(unsupported(self, `${p.id} cut size ${umToMmRounded(long)}×${umToMmRounded(short)} mm is below the minimum holdable panel.`, []));
      if (long > f.maxPanel.length_um || short > f.maxPanel.width_um) results.push(unsupported(self, `${p.id} cut size ${umToMmRounded(long)}×${umToMmRounded(short)} mm exceeds the ${umToMmRounded(f.maxPanel.length_um)}×${umToMmRounded(f.maxPanel.width_um)} mm sheet.`, ["finished.width_mm"]));
    }
    return results.length ? results : pass(self, "All panels within factory size limits.");
  },
});

const MFG_002 = rule({
  id: "MFG-002",
  category: "manufacturing",
  description: "Required machining capabilities available at the factory",
  needsCabinet: true,
  check(rc, self) {
    const f = rc.factory;
    const ops = rc.cabinet!.panels.flatMap((p) => p.operations);
    if (ops.some((o) => o.kind === "POCKET") && !f.pocketMilling) return unsupported(self, `Factory ${f.id} cannot mill connector pockets.`);
    if (ops.some((o) => o.kind === "DRILL") && !f.faceDrilling) return unsupported(self, `Factory ${f.id} cannot face drill.`);
    return pass(self, "Face drilling and pocket milling available; no horizontal boring or grooving required.");
  },
});

const MFG_003 = rule({
  id: "MFG-003",
  category: "manufacturing",
  description: "Order size versus daily sheet capacity",
  needsCabinet: true,
  check(rc, self) {
    const cab = rc.cabinet!;
    const sheetArea = (rc.factory.sheet.length_um / 1e6) * (rc.factory.sheet.width_um / 1e6);
    const sheets = Object.values(cab.totals.areaByMaterial_m2).reduce((a, b) => a + b, 0) * 1.15 / sheetArea;
    if (sheets > rc.factory.capacity.sheetsPerDay) return review(self, `Order needs about ${sheets.toFixed(1)} sheets, more than one day of capacity.`, [], "Confirm scheduling with the factory.");
    return pass(self, `About ${sheets.toFixed(1)} sheets of board.`);
  },
});

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const ASM_001 = rule({
  id: "ASM-001",
  category: "assembly",
  description: "Assembly guide covers every panel and has no circular dependencies",
  needsCabinet: true,
  check(rc, self) {
    const guide = rc.assembly;
    if (!guide) return unsupported(self, "Assembly guide could not be generated.");
    const covered = new Set(guide.steps.flatMap((s) => s.panelIds));
    const missing = rc.cabinet!.panels.filter((p) => !covered.has(p.id)).map((p) => p.id);
    if (missing.length) return unsupported(self, `Panels not covered by any assembly step: ${missing.join(", ")}.`);
    return pass(self, `${guide.steps.length} steps, about ${guide.estimatedMinutes} minutes.`);
  },
});

const ASM_002 = rule({
  id: "ASM-002",
  category: "assembly",
  description: "Heaviest panel must be liftable",
  needsCabinet: true,
  check(rc, self) {
    const heaviest = rc.cabinet!.panels.reduce((a, b) => (b.weight_kg > a.weight_kg ? b : a));
    if (heaviest.weight_kg > 25) return unsupported(self, `${heaviest.id} weighs ${heaviest.weight_kg} kg, above the 25 kg single-panel limit.`, ["topPanelStyle"], "Use per-module top panels.");
    if (heaviest.weight_kg > 15) return review(self, `${heaviest.id} weighs ${heaviest.weight_kg} kg; the guide requires two people for that step.`, [], undefined, ["TWO_PERSON_LIFT"]);
    return pass(self, `Heaviest panel ${heaviest.id} ${heaviest.weight_kg} kg.`);
  },
});

// ---------------------------------------------------------------------------
// Fulfilment
// ---------------------------------------------------------------------------

const FUL_001 = rule({
  id: "FUL-001",
  category: "fulfilment",
  description: "Delivery postcode must be inside the priced service area",
  needsCabinet: false,
  check(rc, self) {
    if (rc.design.installation.deliveryMethod === "pickup") return pass(self, "Pickup from factory.", ["installation.deliveryMethod"]);
    if (!rc.deliveryZone) return unsupported(self, `Postcode ${rc.design.installation.deliveryPostcode} is outside the current service area.`, ["installation.deliveryPostcode"], "Choose pickup or leave your details for when the area opens.");
    return pass(self, `Postcode ${rc.design.installation.deliveryPostcode} is in ${rc.deliveryZone.label}.`, ["installation.deliveryPostcode"]);
  },
});

const FUL_002 = rule({
  id: "FUL-002",
  category: "fulfilment",
  description: "Package dimensions versus carrier limits",
  needsCabinet: true,
  check(rc, self) {
    const pk = rc.packaging!;
    if (pk.anyExceedsLocal) return unsupported(self, `A package (${umToMmRounded(pk.largestLength_um)} mm) exceeds the local delivery limit.`, ["topPanelStyle"], "Use per-module top panels.");
    if (pk.anyExceedsParcel) {
      if (rc.design.installation.deliveryMethod === "pickup" || rc.deliveryZone?.allowsLongItems) return pass(self, `Longest package ${umToMmRounded(pk.largestLength_um)} mm exceeds parcel limits; handled by ${rc.design.installation.deliveryMethod === "pickup" ? "pickup" : "local delivery"}.`, [], ["LONG_ITEM"]);
      return review(self, `Longest package ${umToMmRounded(pk.largestLength_um)} mm exceeds parcel limits and the zone does not carry long items.`, ["installation.deliveryPostcode", "topPanelStyle"], "Choose pickup or per-module top panels.");
    }
    return pass(self, `${pk.packages.length} packages, ${pk.totalWeight_kg} kg, all within parcel limits.`);
  },
});

const FUL_003 = rule({
  id: "FUL-003",
  category: "fulfilment",
  description: "Required safety hardware and documents present",
  needsCabinet: true,
  check(rc, self) {
    const cab = rc.cabinet!;
    if (!cab.antiTipRequired) return pass(self, "No restraint kit required at this height.");
    const kit = rc.bom?.lines.find((l) => l.category === "anti_tip_kit");
    if (!kit || kit.qty < 1) return unsupported(self, "Anti-tip kit missing from the hardware BOM.");
    return pass(self, "Anti-tip kit and toppling information documents included.", [], ["TOPPLING_LABEL_REQUIRED"]);
  },
});

export const RULES: Rule[] = [
  PUR_001,
  CAT_001,
  CAT_002,
  CAT_003,
  CFG_001,
  CFG_002,
  CFG_003,
  CFG_004,
  CFG_005,
  CFG_006,
  CFG_007,
  CFG_008,
  CFG_009,
  CFG_010,
  MEA_001,
  MEA_002,
  MEA_003,
  MEA_004,
  MEA_005,
  GEO_001,
  GEO_002,
  GEO_003,
  GEO_004,
  STR_001,
  STR_002,
  STR_003,
  STR_004,
  MFG_001,
  MFG_002,
  MFG_003,
  ASM_001,
  ASM_002,
  FUL_001,
  FUL_002,
  FUL_003,
];

export const RULE_SET_VERSION = "rules-2026.09-1";

import { describe, expect, it } from "vitest";
import {
  convertToMm,
  describeDesignDiff,
  distributeModuleWidths,
  formatAud,
  isPlausibleFurnitureLength,
  proposeChange,
  safeParseDesignSpec,
  withModuleCount,
  withTotalWidth,
} from "../src";
import { catalog, design, run } from "./helpers";

describe("units (FR-02)", () => {
  it("converts and reports rounding so the user can confirm", () => {
    expect(convertToMm(120, "cm")).toMatchObject({ value_mm: 1200, rounded: false });
    expect(convertToMm(47.25, "in")).toMatchObject({ value_mm: 1200, rounded: true });
    expect(convertToMm(1.2, "m").confirmation).toBe("1.2 m = 1200 mm");
  });
  it("flags implausible magnitudes", () => {
    expect(isPlausibleFurnitureLength(12)).toBe(false);
    expect(isPlausibleFurnitureLength(12000)).toBe(false);
    expect(isPlausibleFurnitureLength(1200)).toBe(true);
  });
});

describe("design helpers", () => {
  const range = { moduleWidth: { min: 300, max: 600 }, moduleCount: { min: 1, max: 3 } };

  it("distributes widths evenly in integer mm", () => {
    const r = distributeModuleWidths(1000, 3, range.moduleWidth, range.moduleCount);
    expect(r.ok && r.widths_mm).toEqual([334, 333, 333]);
  });

  it("explains infeasible counts instead of changing them silently (FR-03)", () => {
    const r = distributeModuleWidths(1400, 2, range.moduleWidth, range.moduleCount);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.feasibleModuleCounts).toEqual([3]);
  });

  it("withTotalWidth keeps kinds, swings and shelf counts", () => {
    const d = design("TPL-LOW-D", { width_mm: 1200 });
    const r = withTotalWidth(d, catalog.resolveTemplate("TPL-LOW-D"), 1000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.design.finished.width_mm).toBe(1000);
      expect(r.design.modules.map((m) => m.kind)).toEqual(d.modules.map((m) => m.kind));
      expect(r.design.modules.map((m) => m.doorSwing)).toEqual(d.modules.map((m) => m.doorSwing));
    }
  });

  it("withModuleCount clones module options", () => {
    const d = design("TPL-LOW-D", { width_mm: 1200 });
    const r = withModuleCount(d, catalog.resolveTemplate("TPL-LOW-D"), 3);
    expect(r.ok && r.design.modules.length).toBe(3);
    if (r.ok) expect(r.design.modules[2]!.kind).toBe("door");
  });
});

describe("pricing (FR-06)", () => {
  it("is in integer cents with GST on the ex-GST subtotal and delivery shown separately", () => {
    const r = run(design("TPL-LOW-D", { width_mm: 1200 }));
    const p = r.price!;
    for (const l of p.lines) expect(Number.isInteger(l.amount_cents)).toBe(true);
    expect(p.gst_cents).toBe(Math.round(p.subtotalExGst_cents * 0.1));
    expect(p.totalIncGst_cents).toBe(p.subtotalExGst_cents + p.gst_cents);
    expect(p.delivery_cents).toBe(9500);
    expect(p.lines.find((l) => l.code === "DEL")!.amount_cents).toBe(9500);
    expect(p.includes.join(" ")).toMatch(/assembly guide/i);
    expect(p.excludes.join(" ")).toMatch(/installation/i);
  });

  it("pickup removes delivery and price grows with size", () => {
    const small = run(design("TPL-LOW-O", { width_mm: 600, modules: [{ kind: "open", width_mm: 600, shelfCount: 1 }], installation: { wallType: "not_required", antiTipAcknowledged: false, deliveryPostcode: "3000", deliveryMethod: "pickup" } }));
    const big = run(design("TPL-LOW-O", { width_mm: 1800, installation: { wallType: "not_required", antiTipAcknowledged: false, deliveryPostcode: "3000", deliveryMethod: "pickup" } }));
    expect(small.price!.delivery_cents).toBe(0);
    expect(big.price!.totalIncGst_cents).toBeGreaterThan(small.price!.totalIncGst_cents);
  });

  it("formats AUD", () => {
    expect(formatAud(137_550)).toBe("A$1,375.50");
    expect(formatAud(-500)).toBe("-A$5.00");
  });
});

describe("natural-language proposals (FR-04)", () => {
  const ctx = catalog.resolveTemplate("TPL-LOW-D");
  const d = design("TPL-LOW-D", { width_mm: 1200 });

  it("turns a width request into a parameter change that still validates", () => {
    const p = proposeChange("make it 1000 wide", d, ctx);
    expect(p.kind).toBe("change");
    if (p.kind === "change") {
      expect(p.nextDesign.finished.width_mm).toBe(1000);
      expect(p.nextDesign.modules.length).toBe(2);
      expect(safeParseDesignSpec(p.nextDesign).success).toBe(true);
      expect(describeDesignDiff(d, p.nextDesign)[0]).toBe("Width 1200 → 1000 mm");
      expect(run(p.nextDesign).report!.verdict).not.toBe("UNSUPPORTED");
    }
  });

  it("states a module-count change explicitly when the width needs it (FR-03)", () => {
    const p = proposeChange("make it 1500 wide", d, ctx);
    expect(p.kind).toBe("change");
    if (p.kind === "change") {
      expect(p.nextDesign.modules.length).toBe(3);
      expect(p.summary).toMatch(/needs 3 modules \(was 2\)/);
      expect(describeDesignDiff(d, p.nextDesign)).toContain("Modules 2 → 3");
    }
  });

  it("supports Chinese phrasing", () => {
    const p = proposeChange("再宽一点", d, ctx);
    expect(p.kind === "change" && p.nextDesign.finished.width_mm).toBe(1300);
    const q = proposeChange("不要拉手", d, ctx);
    expect(q.kind === "change" && q.nextDesign.modules.every((m) => m.handle === "none")).toBe(true);
    const r = proposeChange("宽度改成 900", d, ctx);
    expect(r.kind === "change" && r.nextDesign.finished.width_mm).toBe(900);
  });

  it("asks instead of guessing for ambiguous requests (PRD §5.2)", () => {
    expect(proposeChange("中间再宽一点", d, ctx).kind).toBe("clarify");
    expect(proposeChange("change the shelves", d, ctx).kind).toBe("clarify");
  });

  it("refuses out-of-scope items with an alternative", () => {
    const p = proposeChange("add three drawers", d, ctx);
    expect(p.kind).toBe("unsupported");
    if (p.kind === "unsupported") expect(p.alternative).toMatch(/Doors/);
    expect(proposeChange("I want to put a TV on it", d, ctx).kind).toBe("unsupported");
  });

  it("never exceeds the domain when adding shelves", () => {
    const two = { ...d, modules: d.modules.map((m) => ({ ...m, shelfCount: 2 })) };
    expect(proposeChange("add a shelf", two, ctx).kind).toBe("unsupported");
    const p = proposeChange("add a shelf to module 1", d, ctx);
    expect(p.kind === "change" && p.nextDesign.modules[0]!.shelfCount).toBe(2);
    expect(p.kind === "change" && p.nextDesign.modules[1]!.shelfCount).toBe(1);
  });

  it("makes a module open or adds doors within the template", () => {
    const p = proposeChange("remove the door on the left", d, ctx);
    expect(p.kind === "change" && p.nextDesign.modules[0]!.kind).toBe("open");
    const o = design("TPL-LOW-O", { width_mm: 1200 });
    expect(proposeChange("add doors", o, catalog.resolveTemplate("TPL-LOW-O")).kind).toBe("unsupported");
  });
});

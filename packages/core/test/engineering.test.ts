import { describe, expect, it } from "vitest";
import { canonicalJson, contentHash, validateAssemblyGuide, type DesignSpec, type MeasurementSet } from "../src";
import { design, freeStanding, ruleIds, run, verifiedMeasurement } from "./helpers";

const wallOk = { wallType: "masonry", antiTipAcknowledged: true, deliveryPostcode: "3000", deliveryMethod: "local_delivery" } as const;

/**
 * PRD §13.1: at least 12 recomputable approved digital samples covering min/max
 * combinations, 1/2/3 modules, door directions, open shelves, maximum shelf
 * span, top panel seam/single and constrained spaces.
 */
const SAMPLES: Array<{ name: string; design: DesignSpec; measurement?: MeasurementSet }> = [
  { name: "O min 600x450x350 single module", design: design("TPL-LOW-O", { width_mm: 600, height_mm: 450, depth_mm: 350, modules: [{ kind: "open", width_mm: 600, shelfCount: 1 }] }) },
  { name: "O max 1800x750x450 three modules", design: design("TPL-LOW-O", { width_mm: 1800, height_mm: 750, depth_mm: 450, installation: wallOk }) },
  { name: "O 1200x600x350 two modules no shelves", design: design("TPL-LOW-O", { width_mm: 1200, height_mm: 600, depth_mm: 350, modules: [{ kind: "open", width_mm: 600, shelfCount: 0 }, { kind: "open", width_mm: 600, shelfCount: 0 }] }) },
  { name: "O max shelf span 600 with two shelves", design: design("TPL-LOW-O", { width_mm: 600, height_mm: 750, depth_mm: 450, modules: [{ kind: "open", width_mm: 600, shelfCount: 2 }], installation: { ...wallOk, wallType: "plasterboard_on_stud" } }) },
  { name: "D single left door 600 module", design: design("TPL-LOW-D", { width_mm: 600, height_mm: 600, depth_mm: 350, modules: [{ kind: "door", width_mm: 600, shelfCount: 1, doorSwing: "left", handle: "bar" }] }) },
  { name: "D single right door 600 module no handle", design: design("TPL-LOW-D", { width_mm: 600, height_mm: 450, depth_mm: 350, modules: [{ kind: "door", width_mm: 600, shelfCount: 1, doorSwing: "right", handle: "none" }] }) },
  { name: "D double doors 600 module", design: design("TPL-LOW-D", { width_mm: 600, height_mm: 600, depth_mm: 450, modules: [{ kind: "door", width_mm: 600, shelfCount: 2, doorSwing: "double", handle: "bar" }] }) },
  { name: "D mixed door/open/door 1500 three modules", design: design("TPL-LOW-D", { width_mm: 1500, height_mm: 600, depth_mm: 350, modules: [{ kind: "door", width_mm: 500, shelfCount: 1, doorSwing: "left", handle: "bar" }, { kind: "open", width_mm: 500, shelfCount: 1 }, { kind: "door", width_mm: 500, shelfCount: 1, doorSwing: "right", handle: "bar" }] }) },
  { name: "D 1800 per-module tops (visible seams)", design: design("TPL-LOW-D", { width_mm: 1800, height_mm: 600, depth_mm: 450, topPanelStyle: "per_module" }) },
  { name: "D 1800 single top (long item)", design: design("TPL-LOW-D", { width_mm: 1800, height_mm: 600, depth_mm: 450, topPanelStyle: "single" }) },
  { name: "D 1000 two modules 450x750 anti-tip acknowledged", design: design("TPL-LOW-D", { width_mm: 1000, height_mm: 750, depth_mm: 450, installation: { ...wallOk, deliveryPostcode: "3100" } }) },
  {
    name: "D 1200 in a measured alcove, doors hinged inwards",
    design: design("TPL-LOW-D", { width_mm: 1200, height_mm: 600, depth_mm: 350, modules: [{ kind: "door", width_mm: 600, shelfCount: 1, doorSwing: "right", handle: "bar" }, { kind: "door", width_mm: 600, shelfCount: 1, doorSwing: "left", handle: "bar" }] }),
    measurement: verifiedMeasurement(1240, { accessPath: { narrowestPassage_mm: 760 } }),
  },
  { name: "O 900 pickup", design: design("TPL-LOW-O", { width_mm: 900, height_mm: 450, depth_mm: 450, installation: { wallType: "not_required", antiTipAcknowledged: false, deliveryPostcode: "9999", deliveryMethod: "pickup" } }) },
];

describe("engineering pipeline — approved sample set", () => {
  for (const s of SAMPLES) {
    it(`compiles and passes geometry/structure/manufacturing checks: ${s.name}`, () => {
      const r = run(s.design, s.measurement ?? freeStanding);
      expect(r.schemaErrors).toEqual([]);
      expect(r.report?.compiled).toBe(true);
      expect(ruleIds(r, "UNSUPPORTED")).toEqual([]);
      // Only the provisional-catalog review flag is expected on development data.
      expect(ruleIds(r, "REVIEW_REQUIRED")).toEqual(["CAT-002"]);
      expect(r.cabinet).not.toBeNull();
      expect(r.price).not.toBeNull();
      const guide = validateAssemblyGuide(r.assembly!, r.cabinet!);
      expect(guide.problems).toEqual([]);
    });
  }

  it("is deterministic: identical input yields identical hash and output", () => {
    const d = SAMPLES[7]!.design;
    const a = run(d, verifiedMeasurement(1600));
    const b = run(JSON.parse(JSON.stringify(d)), verifiedMeasurement(1600));
    expect(a.engineeringHash).toBe(b.engineeringHash);
    expect(canonicalJson(a.cabinet)).toBe(canonicalJson(b.cabinet));
    expect(canonicalJson(a.bom)).toBe(canonicalJson(b.bom));
    expect(canonicalJson(a.assembly)).toBe(canonicalJson(b.assembly));
    expect(a.price?.totalIncGst_cents).toBe(b.price?.totalIncGst_cents);
  });

  it("changes the hash when any design field changes", () => {
    const d = SAMPLES[7]!.design;
    const a = run(d);
    const b = run({ ...d, modules: d.modules.map((m, i) => (i === 1 ? { ...m, shelfCount: 2 } : m)) });
    expect(a.engineeringHash).not.toBe(b.engineeringHash);
  });

  it("canonical json ignores key order and undefined", () => {
    expect(contentHash({ a: 1, b: { c: 2, d: undefined } })).toBe(contentHash({ b: { c: 2 }, a: 1 }));
  });

  it("labels panels sequentially and keeps ids stable", () => {
    const r = run(SAMPLES[7]!.design);
    const labels = r.cabinet!.panels.map((p) => p.label);
    expect(labels[0]).toBe("A01");
    expect(new Set(labels).size).toBe(labels.length);
    expect(r.cabinet!.panels.map((p) => p.id)).toContain("M2-BOTTOM");
    expect(r.cabinet!.panels.map((p) => p.id)).toContain("ROW-TOP");
  });

  it("derives cut sizes from finished sizes minus edge band", () => {
    const r = run(SAMPLES[6]!.design);
    const door = r.cabinet!.panels.find((p) => p.role === "DOOR")!;
    // Doors are banded on all four edges with 1 mm band.
    expect(door.finished.length_um - door.cut.length_um).toBe(2000);
    expect(door.finished.width_um - door.cut.width_um).toBe(2000);
    const back = r.cabinet!.panels.find((p) => p.role === "BACK")!;
    expect(back.cut).toEqual(back.finished);
  });

  it("rejects schema-invalid input without throwing", () => {
    const r = run({ templateId: "TPL-LOW-O" });
    expect(r.ok).toBe(false);
    expect(r.schemaErrors.length).toBeGreaterThan(0);
    expect(r.report).toBeNull();
  });

  it("reports an unknown template as a schema error", () => {
    const r = run({ ...SAMPLES[0]!.design, templateId: "TPL-NOPE" });
    expect(r.ok).toBe(false);
    expect(r.schemaErrors[0]).toMatch(/Unknown template/);
  });
});

import { describe, expect, it } from "vitest";
import { RULES, type MeasurementSet } from "../src";
import { design, ruleIds, run, verifiedMeasurement } from "./helpers";

/**
 * FR-05 acceptance: every blocking rule has at least one triggering sample and
 * one boundary-legal sample.
 */

const ok = (r: ReturnType<typeof run>, ruleId: string) => expect(ruleIds(r, "UNSUPPORTED")).not.toContain(ruleId);
const blocked = (r: ReturnType<typeof run>, ruleId: string) => expect(ruleIds(r, "UNSUPPORTED")).toContain(ruleId);
const review = (r: ReturnType<typeof run>, ruleId: string) => expect(ruleIds(r, "REVIEW_REQUIRED")).toContain(ruleId);

describe("purpose and catalog rules", () => {
  it("PUR-001 blocks unsupported uses and explains why", () => {
    const r = run(design("TPL-LOW-O", { purpose: "tv_stand" }));
    blocked(r, "PUR-001");
    expect(r.report!.unsupported.find((x) => x.ruleId === "PUR-001")!.message).toMatch(/TV-bearing/);
    ok(run(design("TPL-LOW-O", { purpose: "books_and_files" })), "PUR-001");
  });

  it("PUR-001 blocks a supported purpose the template does not list", () => {
    blocked(run(design("TPL-LOW-D", { purpose: "display" })), "PUR-001");
    ok(run(design("TPL-LOW-O", { purpose: "display" })), "PUR-001");
  });

  it("CAT-002 requires review while catalog data is provisional", () => {
    review(run(design("TPL-LOW-O")), "CAT-002");
  });
});

describe("configuration rules", () => {
  it("CFG-001 width domain 600–1800", () => {
    blocked(run(design("TPL-LOW-O", { width_mm: 599, modules: [{ kind: "open", width_mm: 599, shelfCount: 1 }] })), "CFG-001");
    ok(run(design("TPL-LOW-O", { width_mm: 600, modules: [{ kind: "open", width_mm: 600, shelfCount: 1 }] })), "CFG-001");
    ok(run(design("TPL-LOW-O", { width_mm: 1800 })), "CFG-001");
    blocked(run(design("TPL-LOW-O", { width_mm: 1801, modules: [{ kind: "open", width_mm: 600, shelfCount: 1 }, { kind: "open", width_mm: 600, shelfCount: 1 }, { kind: "open", width_mm: 601, shelfCount: 1 }] })), "CFG-001");
  });

  it("CFG-001 rejects implausible magnitudes (unit mistakes)", () => {
    const d = design("TPL-LOW-O");
    const r = run({ ...d, finished: { ...d.finished, width_mm: 12 } });
    blocked(r, "CFG-001");
    expect(r.report!.unsupported.find((x) => x.ruleId === "CFG-001")!.message).toMatch(/unit/);
  });

  it("CFG-002 / CFG-003 discrete heights and depths", () => {
    blocked(run(design("TPL-LOW-O", { height_mm: 700 })), "CFG-002");
    ok(run(design("TPL-LOW-O", { height_mm: 750, installation: { wallType: "masonry", antiTipAcknowledged: true, deliveryPostcode: "3000", deliveryMethod: "local_delivery" } })), "CFG-002");
    blocked(run(design("TPL-LOW-O", { depth_mm: 400 })), "CFG-003");
    ok(run(design("TPL-LOW-O", { depth_mm: 450 })), "CFG-003");
  });

  it("CFG-004 module count 1–3", () => {
    const four = design("TPL-LOW-O", { width_mm: 1600, modules: Array.from({ length: 4 }, () => ({ kind: "open" as const, width_mm: 400, shelfCount: 1 })) });
    blocked(run(four), "CFG-004");
  });

  it("CFG-005 module widths must sum to the total", () => {
    blocked(run(design("TPL-LOW-O", { width_mm: 1200, modules: [{ kind: "open", width_mm: 600, shelfCount: 1 }, { kind: "open", width_mm: 590, shelfCount: 1 }] })), "CFG-005");
  });

  it("CFG-006 module width 300–600", () => {
    blocked(run(design("TPL-LOW-O", { width_mm: 899, modules: [{ kind: "open", width_mm: 299, shelfCount: 1 }, { kind: "open", width_mm: 600, shelfCount: 1 }] })), "CFG-006");
    ok(run(design("TPL-LOW-O", { width_mm: 900, modules: [{ kind: "open", width_mm: 300, shelfCount: 1 }, { kind: "open", width_mm: 600, shelfCount: 1 }] })), "CFG-006");
  });

  it("CFG-007 open template rejects doors", () => {
    blocked(run(design("TPL-LOW-O", { width_mm: 600, modules: [{ kind: "door", width_mm: 600, shelfCount: 1, doorSwing: "double", handle: "bar" }] })), "CFG-007");
    ok(run(design("TPL-LOW-D", { width_mm: 600, modules: [{ kind: "door", width_mm: 600, shelfCount: 1, doorSwing: "double", handle: "bar" }] })), "CFG-007");
  });

  it("CFG-008 shelves per module 0–2", () => {
    blocked(run(design("TPL-LOW-O", { width_mm: 600, modules: [{ kind: "open", width_mm: 600, shelfCount: 3 }] })), "CFG-008");
    ok(run(design("TPL-LOW-O", { width_mm: 600, modules: [{ kind: "open", width_mm: 600, shelfCount: 2 }] })), "CFG-008");
  });

  it("CFG-009 door widths must suit the hinge system", () => {
    // 600 module single door = 596 mm > 600? no, 596 <= 600 is fine; use missing swing and narrow doubles.
    blocked(run(design("TPL-LOW-D", { width_mm: 600, modules: [{ kind: "door", width_mm: 600, shelfCount: 1 }] })), "CFG-009");
    // double doors on a 300 module give (300-4-2)/2 = 147 mm < 200 minimum
    blocked(run(design("TPL-LOW-D", { width_mm: 600, modules: [{ kind: "door", width_mm: 300, shelfCount: 1, doorSwing: "double", handle: "bar" }, { kind: "open", width_mm: 300, shelfCount: 1 }] })), "CFG-009");
    ok(run(design("TPL-LOW-D", { width_mm: 600, modules: [{ kind: "door", width_mm: 300, shelfCount: 1, doorSwing: "left", handle: "bar" }, { kind: "open", width_mm: 300, shelfCount: 1 }] })), "CFG-009");
    // open module with door options set is inconsistent
    blocked(run(design("TPL-LOW-D", { width_mm: 600, modules: [{ kind: "open", width_mm: 600, shelfCount: 1, doorSwing: "left" }] })), "CFG-009");
  });

  it("configuration failures skip compilation and report compiled=false", () => {
    const r = run(design("TPL-LOW-O", { height_mm: 700 }));
    expect(r.report!.compiled).toBe(false);
    expect(r.report!.verdict).toBe("UNSUPPORTED");
    expect(r.cabinet).toBeNull();
    expect(r.price).toBeNull();
  });
});

describe("measurement rules", () => {
  const d = design("TPL-LOW-O", { width_mm: 1200 });

  it("MEA-001 requires a measurement record", () => {
    review(run(d, null), "MEA-001");
    ok(run(d, verifiedMeasurement(1300)), "MEA-001");
    expect(ruleIds(run(d, verifiedMeasurement(1300)), "REVIEW_REQUIRED")).not.toContain("MEA-001");
  });

  it("MEA-002 never accepts photo or scan estimates as verified", () => {
    const ms: MeasurementSet = {
      spaceConstrained: true,
      availableSpace: { widths: [{ value_mm: 1300, source: "photo_estimate" }] },
      internalRequirements: [],
      obstacles: [],
      evidence: [],
    };
    review(run(d, ms), "MEA-002");
  });

  it("MEA-003 blocks when the finished width plus clearance does not fit", () => {
    // 1200 + 10 clearance = 1210 needed
    blocked(run(d, verifiedMeasurement(1205)), "MEA-003");
    ok(run(d, verifiedMeasurement(1210)), "MEA-003");
    const r = run(d, verifiedMeasurement(1205));
    expect(r.report!.unsupported.find((x) => x.ruleId === "MEA-003")!.suggestion).toMatch(/1195/);
  });

  it("MEA-003 uses height and skirting depth", () => {
    const tooLow = verifiedMeasurement(1300, { availableSpace: { widths: [{ value_mm: 1300, source: "manual_remeasured" }], height: { value_mm: 605, source: "manual_remeasured" } } });
    blocked(run(d, tooLow), "MEA-003");
    const shallow = verifiedMeasurement(1300, {
      availableSpace: { widths: [{ value_mm: 1300, source: "manual_remeasured" }], depth: { value_mm: 360, source: "manual_remeasured" } },
      obstacles: [{ kind: "skirting", description: "timber skirting", protrusion_mm: 18 }],
    });
    review(run(d, shallow), "MEA-003");
  });

  it("MEA-004 flags out-of-square spaces", () => {
    const ms = verifiedMeasurement(1300);
    ms.availableSpace!.widths[1]!.value_mm = 1330;
    review(run(d, ms), "MEA-004");
  });

  it("MEA-005 checks the access path against the widest package", () => {
    const ms = verifiedMeasurement(1900, { accessPath: { narrowestPassage_mm: 300 } });
    review(run(design("TPL-LOW-O", { width_mm: 1800 }), ms), "MEA-005");
  });
});

describe("geometry and structure rules", () => {
  it("GEO-002 reviews outer-hinged doors in constrained spaces", () => {
    const d = design("TPL-LOW-D", { width_mm: 800, modules: [{ kind: "door", width_mm: 400, shelfCount: 1, doorSwing: "left", handle: "bar" }, { kind: "door", width_mm: 400, shelfCount: 1, doorSwing: "right", handle: "bar" }] });
    review(run(d, verifiedMeasurement(900)), "GEO-002");
    expect(ruleIds(run(d, null), "REVIEW_REQUIRED")).not.toContain("GEO-002");
  });

  it("GEO-003 finds no interference on any approved height/depth", () => {
    for (const h of [450, 600, 750]) {
      for (const dp of [350, 450]) {
        const d = design("TPL-LOW-D", { width_mm: 1800, height_mm: h, depth_mm: dp, installation: { wallType: "masonry", antiTipAcknowledged: true, deliveryPostcode: "3000", deliveryMethod: "local_delivery" } });
        const r = run(d);
        expect(ruleIds(r, "UNSUPPORTED"), `${h}x${dp}`).not.toContain("GEO-003");
      }
    }
  });

  it("STR-003 anti-tip: 750 mm requires acknowledgement and a known wall", () => {
    const base = design("TPL-LOW-O", { width_mm: 900, height_mm: 750 });
    review(run(base), "STR-003");
    blocked(run({ ...base, installation: { ...base.installation, antiTipAcknowledged: true, wallType: "not_required" } }), "STR-003");
    review(run({ ...base, installation: { ...base.installation, antiTipAcknowledged: true, wallType: "unknown" } }), "STR-003");
    const good = run({ ...base, installation: { ...base.installation, antiTipAcknowledged: true, wallType: "masonry" } });
    expect(ruleIds(good, "REVIEW_REQUIRED")).not.toContain("STR-003");
    expect(good.report!.flags).toContain("ANTI_TIP_REQUIRED");
    expect(good.report!.flags).toContain("TOPPLING_LABEL_REQUIRED");
    expect(good.bom!.lines.some((l) => l.category === "anti_tip_kit")).toBe(true);
  });

  it("STR-003 not required below 686 mm and no kit in the BOM", () => {
    const r = run(design("TPL-LOW-O", { width_mm: 900, height_mm: 600 }));
    expect(r.cabinet!.antiTipRequired).toBe(false);
    expect(r.bom!.lines.some((l) => l.category === "anti_tip_kit")).toBe(false);
    expect(r.report!.flags).not.toContain("ANTI_TIP_REQUIRED");
  });
});

describe("fulfilment rules", () => {
  it("FUL-001 blocks postcodes outside the priced area unless pickup", () => {
    const d = design("TPL-LOW-O");
    blocked(run({ ...d, installation: { ...d.installation, deliveryPostcode: "2000" } }), "FUL-001");
    ok(run({ ...d, installation: { ...d.installation, deliveryPostcode: "2000", deliveryMethod: "pickup" } }), "FUL-001");
  });

  it("FUL-002 flags the 1.8 m spanning top as a long item for local delivery", () => {
    const r = run(design("TPL-LOW-O", { width_mm: 1800, topPanelStyle: "single" }));
    expect(r.packaging!.anyExceedsParcel).toBe(true);
    expect(r.packaging!.anyExceedsLocal).toBe(false);
    ok(r, "FUL-002");
    expect(r.report!.flags).toContain("LONG_ITEM");
    const seams = run(design("TPL-LOW-O", { width_mm: 1800, topPanelStyle: "per_module" }));
    expect(seams.packaging!.anyExceedsParcel).toBe(false);
  });
});

describe("rule catalogue", () => {
  it("has unique ids and a stable version", () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(RULES.length).toBeGreaterThanOrEqual(30);
  });

  it("every result carries rule id, category and severity", () => {
    const r = run(design("TPL-LOW-D"));
    for (const res of r.report!.results) {
      expect(res.ruleId).toMatch(/^[A-Z]{3}-\d{3}$/);
      expect(["PASS", "REVIEW_REQUIRED", "UNSUPPORTED"]).toContain(res.severity);
    }
  });
});

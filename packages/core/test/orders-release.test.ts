import { describe, expect, it } from "vitest";
import {
  addDays,
  assertTransition,
  buildProductionRelease,
  canTransition,
  cutListCsv,
  cutListRows,
  derivePaymentStatus,
  evaluateReleaseGate,
  operationsCsv,
  quoteValidity,
  releaseKeyFor,
  type ProductionReleaseInput,
  type ReleaseGateInput,
} from "../src";
import { design, run, verifiedMeasurement } from "./helpers";

describe("order state machine (PRD §7.1)", () => {
  it("allows the main path and blocks skipping", () => {
    const path = ["draft", "submitted", "quoted", "confirmed", "released", "in_production", "qc_packing", "shipped", "delivered", "completed"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    expect(canTransition("draft", "released")).toBe(false);
    expect(canTransition("submitted", "in_production")).toBe(false);
    expect(() => assertTransition("cancelled", "draft")).toThrow(/Illegal/);
  });

  it("supports needs_changes loops and after-sales from late states", () => {
    expect(canTransition("quoted", "needs_changes")).toBe(true);
    expect(canTransition("needs_changes", "draft")).toBe(true);
    expect(canTransition("delivered", "aftersales")).toBe(true);
    expect(canTransition("completed", "aftersales")).toBe(true);
  });
});

describe("payment status", () => {
  const total = 137_500;
  const deposit = 68_750;
  it("derives from ledger totals", () => {
    expect(derivePaymentStatus({ total_cents: total, paid_cents: 0, refunded_cents: 0, depositRequired_cents: deposit, disputed: false })).toBe("unpaid");
    expect(derivePaymentStatus({ total_cents: total, paid_cents: 10_000, refunded_cents: 0, depositRequired_cents: deposit, disputed: false })).toBe("partially_paid");
    expect(derivePaymentStatus({ total_cents: total, paid_cents: deposit, refunded_cents: 0, depositRequired_cents: deposit, disputed: false })).toBe("deposit_paid");
    expect(derivePaymentStatus({ total_cents: total, paid_cents: total, refunded_cents: 0, depositRequired_cents: deposit, disputed: false })).toBe("settled");
    expect(derivePaymentStatus({ total_cents: total, paid_cents: total, refunded_cents: 20_000, depositRequired_cents: deposit, disputed: false })).toBe("partially_refunded");
    expect(derivePaymentStatus({ total_cents: total, paid_cents: total, refunded_cents: total, depositRequired_cents: deposit, disputed: false })).toBe("refunded");
    expect(derivePaymentStatus({ total_cents: total, paid_cents: total, refunded_cents: 0, depositRequired_cents: deposit, disputed: true })).toBe("disputed");
  });
});

describe("release gate", () => {
  const good: ReleaseGateInput = {
    orderStatus: "confirmed",
    engineeringStatus: "approved",
    paymentStatus: "settled",
    confirmedDesignVersion: 3,
    quotedDesignVersion: 3,
    approvedDesignVersion: 3,
    currentDesignVersion: 3,
    quoteStatus: "accepted",
    materialsConfirmed: true,
    capacityConfirmed: true,
    hasLabels: true,
    hasPackagingPlan: true,
    hasAssemblyGuide: true,
    antiTipAcknowledgedIfRequired: true,
    openBlocks: [],
  };

  it("passes only when every condition holds", () => {
    expect(evaluateReleaseGate(good)).toEqual({ ok: true, reasons: [] });
  });

  it("paid does not imply approved", () => {
    const r = evaluateReleaseGate({ ...good, engineeringStatus: "review_required" });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/Engineering status/);
  });

  it("version drift between confirmed, quoted and approved blocks release", () => {
    const r = evaluateReleaseGate({ ...good, currentDesignVersion: 4 });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/versions differ/);
  });

  it("deposit only, expired quote, missing labels and open blocks are all reasons", () => {
    const r = evaluateReleaseGate({ ...good, paymentStatus: "deposit_paid", quoteStatus: "expired", hasLabels: false, openBlocks: ["hardware HG-01 out of stock"] });
    expect(r.reasons.length).toBe(4);
  });
});

describe("quote validity", () => {
  const now = new Date("2026-09-08T00:00:00Z");
  const q = { validUntil: addDays(now, 7).toISOString(), status: "active" as const, designVersion: 2, engineeringHash: "abc" };
  it("valid inside the window for the same version and hash", () => {
    expect(quoteValidity(q, now, 2, "abc")).toEqual({ valid: true });
  });
  it("invalid when expired, superseded, version or engineering changed", () => {
    expect(quoteValidity(q, addDays(now, 8), 2, "abc").valid).toBe(false);
    expect(quoteValidity({ ...q, status: "superseded" }, now, 2, "abc").valid).toBe(false);
    expect(quoteValidity(q, now, 3, "abc").reason).toMatch(/design v2/);
    expect(quoteValidity(q, now, 2, "zzz").reason).toMatch(/Engineering data changed/);
  });
});

describe("production release package (FR-08)", () => {
  function input(): ProductionReleaseInput {
    const d = design("TPL-LOW-D", { width_mm: 1000, height_mm: 750, depth_mm: 450, installation: { wallType: "masonry", antiTipAcknowledged: true, deliveryPostcode: "3000", deliveryMethod: "local_delivery" } });
    const r = run(d, verifiedMeasurement(1100));
    return {
      orderId: "ord_test",
      designVersion: 2,
      engineeringHash: r.engineeringHash!,
      design: r.design!,
      cabinet: r.cabinet!,
      bom: r.bom!,
      packaging: r.packaging!,
      assembly: r.assembly!,
      report: r.report!,
      price: r.price!,
      quote: { id: "quo_1", total_cents: r.price!.totalIncGst_cents },
      approval: { reviewId: "rev_1", approvedBy: "eng", approvedAt: "2026-09-08T00:00:00Z", notes: "ok" },
      confirmation: { id: "cnf_1", confirmedAt: "2026-09-08T01:00:00Z", snapshotHash: "snap" },
      factory: { id: "FAC-PILOT-01", version: 1, adapter: "manual-csv" },
      versions: { ruleSetVersion: r.versions!.ruleSetVersion, priceListId: "PL-PILOT", priceListVersion: 1 },
      loadStatement: { shelf_kg: 15, top_kg: 30 },
      sequence: 1,
    };
  }

  it("is deterministic and keyed by order, version, hash and sequence", () => {
    const a = buildProductionRelease(input());
    const b = buildProductionRelease(input());
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.payload.releaseKey).toBe(releaseKeyFor("ord_test", 2, input().engineeringHash, 1));
    expect(buildProductionRelease({ ...input(), sequence: 2 }).payload.releaseKey).not.toBe(a.payload.releaseKey);
  });

  it("carries labels for every panel, documents and safety flags", () => {
    const rel = buildProductionRelease(input());
    expect(rel.payload.labels.length).toBe(rel.payload.panels.length);
    expect(rel.payload.labels[0]!.qrPayload).toMatch(/^cfp:release\/REL-[0-9A-F]{16}\/panel\//);
    expect(rel.payload.documents).toContain("TOPPLING_WARNING_LABEL");
    expect(rel.payload.summary.antiTipRequired).toBe(true);
    expect(rel.payload.summary.flags).toContain("ANTI_TIP_REQUIRED");
    expect(rel.payload.summary.loadStatement).toEqual({ shelf_kg: 15, top_kg: 30 });
  });

  it("refuses to build for an unsupported design", () => {
    const i = input();
    expect(() => buildProductionRelease({ ...i, report: { ...i.report, verdict: "UNSUPPORTED" } })).toThrow(/unsupported/);
  });

  it("exports a cut list and operation list with one row per panel / operation", () => {
    const rel = buildProductionRelease(input());
    const rows = cutListRows(rel.payload);
    expect(rows.length).toBe(rel.payload.panels.length);
    const csv = cutListCsv(rel.payload);
    expect(csv.split("\n").length).toBe(rows.length + 1);
    expect(csv.split("\n")[0]).toContain("cut_length_mm");
    const ops = operationsCsv(rel.payload);
    const opCount = rel.payload.panels.reduce((acc, p) => acc + p.operations.length, 0);
    expect(ops.split("\n").length).toBe(opCount + 1);
  });
});

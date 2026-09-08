import { beforeAll, describe, expect, it } from "vitest";
import { expectRedirect, form, jar } from "./next-mocks";
import type { DesignSpec, MeasurementSet } from "@cfp/core";
import { signInAdmin } from "@/lib/auth";
import {
  claimOrderAccess,
  confirmOrder,
  openServiceCase,
  recordCustomerPayment,
  saveDesign,
  saveMeasurement,
  startOrder,
  submitForReview,
  type ActionState,
} from "@/server/actions/customer";
import { addCost, inspectPanel, issueQuote, packPackage, recordPayment, recordReview, runProductionStep, seedDemoOrders, updateServiceCase } from "@/server/actions/admin";
import { contribution, releaseGateFor, shipmentBlockers } from "@/server/production";
import { getOrder, listAllOrders, listPayments, listReleases, loadOrderBundle } from "@/server/queries";

const INIT: ActionState = { ok: false };

async function bundle(orderId: string) {
  const order = await getOrder(orderId);
  if (!order) throw new Error("order missing");
  return loadOrderBundle(order);
}

describe("order lifecycle (PRD §4, §7)", () => {
  let orderId = "";

  beforeAll(async () => {
    jar.clear();
  });

  it("FR-01 gate refuses unsupported purposes and out-of-area delivery, keeps enquiry", async () => {
    const tv = await startOrder(INIT, form({ purpose: "tv_stand", templateId: "TPL-LOW-D", postcode: "3000", deliveryMethod: "local_delivery" }));
    expect(tv.ok).toBe(false);
    expect(tv.reasons?.join(" ")).toMatch(/TV-bearing/);
    const far = await startOrder(INIT, form({ purpose: "general_storage", templateId: "TPL-LOW-D", postcode: "2000", deliveryMethod: "local_delivery" }));
    expect(far.reasons?.join(" ")).toMatch(/outside the current delivery area/);
    const wrongTemplate = await startOrder(INIT, form({ purpose: "display", templateId: "TPL-LOW-D", postcode: "3000", deliveryMethod: "local_delivery" }));
    expect(wrongTemplate.reasons?.join(" ")).toMatch(/not approved for "Display/);
  });

  it("creates a draft order with design v1 and a customer identity cookie", async () => {
    const url = await expectRedirect(startOrder(INIT, form({ purpose: "general_storage", templateId: "TPL-LOW-D", postcode: "3000", deliveryMethod: "local_delivery", width_mm: "1200", budget: "1500", timeframe: "1-3 months" })));
    expect(url).toMatch(/^\/design\/ord_/);
    orderId = url.split("/")[2]!;
    expect(jar.get("cfp_customer")).toBeDefined();
    const b = await bundle(orderId);
    expect(b.order.status).toBe("draft");
    expect(b.current.version).toBe(1);
    expect(b.current.verdict).toBe("REVIEW_REQUIRED");
    expect(b.current.engineering.cabinet?.panels.length).toBeGreaterThan(10);
  });

  it("FR-03 saving an edit appends a version and re-runs engineering", async () => {
    const b = await bundle(orderId);
    const next: DesignSpec = {
      ...b.current.design,
      finished: { ...b.current.design.finished, height_mm: 750 },
      installation: { ...b.current.design.installation, wallType: "masonry", antiTipAcknowledged: true },
    };
    const res = await saveDesign(orderId, next, "taller");
    expect(res.ok).toBe(true);
    expect(res.version).toBe(2);
    const b2 = await bundle(orderId);
    expect(b2.current.engineering.cabinet?.antiTipRequired).toBe(true);
    expect(b2.current.engineering.report?.flags).toContain("ANTI_TIP_REQUIRED");
  });

  it("FR-03 rejects invalid designs without creating a version", async () => {
    const res = await saveDesign(orderId, { nonsense: true });
    expect(res.ok).toBe(false);
    expect((await bundle(orderId)).current.version).toBe(2);
  });

  it("FR-02 measurements are stored with sources and change the rule outcome", async () => {
    const ms: MeasurementSet = {
      spaceConstrained: true,
      availableSpace: { widths: [{ value_mm: 1250, source: "manual_remeasured", location: "floor" }, { value_mm: 1252, source: "manual_remeasured", location: "top" }] },
      internalRequirements: [],
      obstacles: [{ kind: "skirting", description: "timber skirting", protrusion_mm: 15 }],
      evidence: [{ kind: "photo", ref: "IMG_1.jpg" }],
      confirmedBy: "Jo",
    };
    const res = await saveMeasurement(orderId, ms);
    expect(res.ok).toBe(true);
    expect(res.version).toBe(3);
    const b = await bundle(orderId);
    const ids = b.current.engineering.report!.results.filter((r) => r.severity !== "PASS").map((r) => r.ruleId);
    expect(ids).not.toContain("MEA-001");
    expect(ids).not.toContain("MEA-003");
    // Outer-hinged doors in a bounded space are (correctly) flagged for the reviewer.
    expect(ids).toContain("GEO-002");
    expect(b.current.verdict).toBe("REVIEW_REQUIRED");
  });

  it("submission needs contact details and no blocking rules", async () => {
    const bad = await submitForReview(orderId, { name: "J", email: "nope", phone: "1" });
    expect(bad.ok).toBe(false);
    const ok = await submitForReview(orderId, { name: "Jo Bloggs", email: "jo@example.com", phone: "0400 000 000", referralSource: "friend" });
    expect(ok.ok).toBe(true);
    const b = await bundle(orderId);
    expect(b.order.status).toBe("submitted");
    expect(b.order.customerEmail).toBe("jo@example.com");
  });

  it("staff actions require sign-in", async () => {
    await expect(recordReview(INIT, form({ orderId, decision: "approved", notes: "looks fine" }))).rejects.toThrow(/sign-in/);
    expect(await signInAdmin("wrong")).toBe(false);
    expect(await signInAdmin("test-admin")).toBe(true);
  });

  it("FR-06 quote is refused before engineering approval, issued after", async () => {
    const early = await issueQuote(INIT, form({ orderId, leadTimeDays: "21", validityDays: "7" }));
    expect(early.ok).toBe(false);
    expect(early.error).toMatch(/approve/);
    const review = await recordReview(INIT, form({ orderId, decision: "approved", notes: "Checked span, restraint, fit against 1250 mm alcove." }));
    expect(review).toMatchObject({ ok: true });
    let b = await bundle(orderId);
    expect(b.order.engineeringStatus).toBe("approved");
    expect(b.order.approvedDesignVersion).toBe(3);
    const q = await issueQuote(INIT, form({ orderId, leadTimeDays: "21", validityDays: "10", notes: "Tuesday deliveries" }));
    expect(q).toMatchObject({ ok: true });
    b = await bundle(orderId);
    expect(b.order.status).toBe("quoted");
    expect(b.quote?.status).toBe("active");
    expect(b.quote?.totalCents).toBe(b.current.engineering.price?.totalIncGst_cents);
    expect(b.quote?.depositCents).toBe(Math.round(b.quote!.totalCents * 0.5));
    // validity capped at the price list's 7 days
    const days = (new Date(b.quote!.validUntil).getTime() - new Date(b.quote!.issuedAt).getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(7);
  });

  it("payments before confirmation are refused; release gate lists every missing condition", async () => {
    const pay = await recordCustomerPayment(orderId, "deposit");
    expect(pay.ok).toBe(false);
    const gate = releaseGateFor(await bundle(orderId));
    expect(gate.ok).toBe(false);
    expect(gate.reasons.join(" ")).toMatch(/must be confirmed/);
  });

  it("FR-07 confirmation requires every acknowledgement and stores a snapshot", async () => {
    const missing = await confirmOrder(INIT, form({ orderId, confirmedBy: "Jo Bloggs", ack_dimensions: "on" }));
    expect(missing.ok).toBe(false);
    expect(missing.reasons).toContain("anti_tip");
    const acks = Object.fromEntries(["dimensions", "structure", "price", "delivery", "installation", "consumer_rights", "anti_tip"].map((k) => [`ack_${k}`, "on"]));
    const url = await expectRedirect(confirmOrder(INIT, form({ orderId, confirmedBy: "Jo Bloggs", ...acks })));
    expect(url).toContain(`/orders/${orderId}`);
    const b = await bundle(orderId);
    expect(b.order.status).toBe("confirmed");
    expect(b.order.confirmedDesignVersion).toBe(3);
    expect(b.quote?.status).toBe("accepted");
    expect(b.confirmation?.snapshot.engineeringHash).toBe(b.current.engineeringHash);
    expect(b.confirmation?.snapshotHash).toHaveLength(64);
  });

  it("design is locked after confirmation", async () => {
    const b = await bundle(orderId);
    const res = await saveDesign(orderId, { ...b.current.design, finished: { ...b.current.design.finished, width_mm: 1100 } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/locked/);
  });

  it("customer deposit is idempotent; staff balance settles; duplicate references are ignored", async () => {
    expect((await recordCustomerPayment(orderId, "deposit")).ok).toBe(true);
    expect((await recordCustomerPayment(orderId, "deposit")).ok).toBe(true);
    let payments = await listPayments(orderId);
    expect(payments.filter((p) => p.kind === "deposit")).toHaveLength(1);
    let b = await bundle(orderId);
    expect(b.order.paymentStatus).toBe("deposit_paid");
    const balance = (b.quote!.totalCents - b.quote!.depositCents) / 100;
    const first = await recordPayment(INIT, form({ orderId, kind: "balance", amount: String(balance), method: "bank_transfer", idempotencyKey: "NAB-1" }));
    expect(first.message).toMatch(/recorded/i);
    const dup = await recordPayment(INIT, form({ orderId, kind: "balance", amount: String(balance), method: "bank_transfer", idempotencyKey: "NAB-1" }));
    expect(dup.message).toMatch(/Duplicate/);
    payments = await listPayments(orderId);
    expect(payments).toHaveLength(2);
    b = await bundle(orderId);
    expect(b.order.paymentStatus).toBe("settled");
  });

  it("FR-08 release only after materials and capacity are confirmed; the package is immutable and keyed", async () => {
    const blocked = await runProductionStep(INIT, form({ orderId, intent: "release" }));
    expect(blocked.ok).toBe(false);
    expect(blocked.reasons?.join(" ")).toMatch(/Material and hardware availability/);
    expect((await runProductionStep(INIT, form({ orderId, intent: "materials_confirmed", text: "batch 42" }))).ok).toBe(true);
    expect((await runProductionStep(INIT, form({ orderId, intent: "capacity_confirmed", text: "week 38" }))).ok).toBe(true);
    const rel = await runProductionStep(INIT, form({ orderId, intent: "release" }));
    expect(rel.ok).toBe(true);
    const b = await bundle(orderId);
    expect(b.order.status).toBe("released");
    expect(b.release).not.toBeNull();
    expect(b.release!.payload.labels).toHaveLength(b.release!.payload.panels.length);
    expect(b.release!.payload.documents).toContain("TOPPLING_WARNING_LABEL");
    expect(b.release!.payload.confirmation.snapshotHash).toBe(b.confirmation!.snapshotHash);
    expect(b.release!.payload.approval.approvedBy).toBe("staff");
    expect((await listReleases(orderId))).toHaveLength(1);
  });

  it("FR-10 dispatch is blocked until every panel is inspected and every package packed and verified", async () => {
    expect((await runProductionStep(INIT, form({ orderId, intent: "start_production" }))).ok).toBe(true);
    expect((await runProductionStep(INIT, form({ orderId, intent: "start_qc" }))).ok).toBe(true);
    let b = await bundle(orderId);
    expect(b.order.status).toBe("qc_packing");
    const ship = await runProductionStep(INIT, form({ orderId, intent: "ship", text: "van 1" }));
    expect(ship.ok).toBe(false);
    const rel = b.release!;
    // Wrong-version / unknown parts are rejected.
    const bogus = await inspectPanel(INIT, form({ orderId, releaseKey: rel.releaseKey, panelId: "M9-NOPE", result: "pass" }));
    expect(bogus.ok).toBe(false);
    for (const p of rel.payload.panels) {
      const r = await inspectPanel(INIT, form({ orderId, releaseKey: rel.releaseKey, panelId: p.id, result: p.id === "M1-DOOR-L" ? "fail" : "pass", notes: "" }));
      expect(r.ok).toBe(true);
    }
    b = await bundle(orderId);
    expect(shipmentBlockers(b).join(" ")).toMatch(/M1-DOOR-L\) failed/);
    // Re-inspection after rework passes.
    expect((await inspectPanel(INIT, form({ orderId, releaseKey: rel.releaseKey, panelId: "M1-DOOR-L", result: "pass", notes: "re-cut" }))).ok).toBe(true);
    for (const pkg of rel.payload.packaging.packages) {
      const unverified = await packPackage(INIT, form({ orderId, releaseKey: rel.releaseKey, code: pkg.code, weight_kg: String(pkg.weight_kg) }));
      expect(unverified.ok).toBe(false);
      const r = await packPackage(INIT, form({ orderId, releaseKey: rel.releaseKey, code: pkg.code, weight_kg: String(pkg.weight_kg + 0.1), verified: "on" }));
      expect(r.ok).toBe(true);
    }
    b = await bundle(orderId);
    expect(shipmentBlockers(b)).toEqual([]);
    expect((await runProductionStep(INIT, form({ orderId, intent: "ship", text: "van 1" }))).ok).toBe(true);
    expect((await runProductionStep(INIT, form({ orderId, intent: "delivered" }))).ok).toBe(true);
    expect((await bundle(orderId)).order.status).toBe("delivered");
  });

  it("FR-12 a service case is opened by part reference and tracked to resolution", async () => {
    const res = await openServiceCase(INIT, form({ orderId, partRef: "M1-DOOR-L", partKind: "panel", severity: "cosmetic", symptom: "Chipped edge on the left door, top corner." }));
    expect(res.ok).toBe(true);
    let b = await bundle(orderId);
    expect(b.order.status).toBe("aftersales");
    expect(b.cases[0]!.releaseKey).toBe(b.release!.releaseKey);
    const upd = await updateServiceCase(INIT, form({ caseId: b.cases[0]!.id, orderId, status: "resolved", cause: "packaging_transport", responsibility: "platform", resolution: "Re-cut from release", cost: "38.5" }));
    expect(upd.ok).toBe(true);
    b = await bundle(orderId);
    expect(b.cases[0]!.status).toBe("resolved");
    expect(b.cases[0]!.costCents).toBe(3850);
    expect((await runProductionStep(INIT, form({ orderId, intent: "complete" }))).ok).toBe(true);
    expect((await bundle(orderId)).order.status).toBe("completed");
  });

  it("FR-13 contribution is computed from recorded actuals and reports missing categories", async () => {
    expect((await addCost(INIT, form({ orderId, category: "board", amount: "210", note: "2 sheets" }))).ok).toBe(true);
    expect((await addCost(INIT, form({ orderId, category: "delivery", amount: "95" }))).ok).toBe(true);
    expect((await addCost(INIT, form({ orderId, category: "presales_engineering", amount: "60", minutes: "45" }))).ok).toBe(true);
    const b = await bundle(orderId);
    const c = contribution(b);
    expect(c.revenueInc).toBe(b.quote!.totalCents);
    expect(c.revenueEx).toBe(Math.round(b.quote!.totalCents / 1.1));
    expect(c.manufacturing).toBe(21_000);
    expect(c.fulfilment).toBe(15_500);
    expect(c.serviceCosts).toBe(3850);
    expect(c.cm1).toBe(c.revenueEx - 21_000 - 15_500 - 3850);
    expect(c.missingCategories).toContain("hardware");
    expect(c.missingCategories).not.toContain("board");
  });
});

describe("change control (PRD §7.2)", () => {
  it("editing after a quote supersedes the quote and returns the order to draft", async () => {
    jar.clear();
    const url = await expectRedirect(startOrder(INIT, form({ purpose: "general_storage", templateId: "TPL-LOW-O", postcode: "3100", deliveryMethod: "local_delivery", width_mm: "900" })));
    const id = url.split("/")[2]!;
    await saveMeasurement(id, { spaceConstrained: false, internalRequirements: [], obstacles: [], evidence: [] });
    expect(await submitForReview(id, { name: "Sam Lee", email: "sam@example.com", phone: "0400 111 222" })).toMatchObject({ ok: true });
    await signInAdmin("test-admin");
    expect(await recordReview(INIT, form({ orderId: id, decision: "approved", notes: "Checked and approved." }))).toMatchObject({ ok: true });
    expect(await issueQuote(INIT, form({ orderId: id, leadTimeDays: "14", validityDays: "7" }))).toMatchObject({ ok: true });
    let b = await bundle(id);
    expect(b.order.status).toBe("quoted");
    const res = await saveDesign(id, { ...b.current.design, finished: { ...b.current.design.finished, width_mm: 1000 }, modules: [{ kind: "open", width_mm: 500, shelfCount: 1 }, { kind: "open", width_mm: 500, shelfCount: 1 }] });
    expect(res.ok).toBe(true);
    b = await bundle(id);
    expect(b.order.status).toBe("draft");
    expect(b.quotes[0]!.status).toBe("superseded");
    expect(b.order.engineeringStatus).toBe("review_required");
    expect(b.order.approvedDesignVersion).toBe(2);
    expect(b.order.currentDesignVersion).toBe(3);
    // A stale approval can never open the gate.
    expect(releaseGateFor(b).reasons.join(" ")).toMatch(/versions differ|must be confirmed/);
  });

  it("access links: another device cannot act on the order until it claims it with the token (PRD §11)", async () => {
    jar.clear();
    const url = await expectRedirect(startOrder(INIT, form({ purpose: "general_storage", templateId: "TPL-LOW-O", postcode: "3000", deliveryMethod: "local_delivery" })));
    const id = url.split("/")[2]!;
    const order = (await getOrder(id))!;
    jar.clear(); // new device, no cookies
    const denied = await saveMeasurement(id, { spaceConstrained: false, internalRequirements: [], obstacles: [], evidence: [] });
    expect(denied.ok).toBe(false);
    expect(await claimOrderAccess(id, "not-the-token")).toBe(false);
    expect(await claimOrderAccess(id, order.accessToken)).toBe(true);
    const allowed = await saveMeasurement(id, { spaceConstrained: false, internalRequirements: [], obstacles: [], evidence: [] });
    expect(allowed.ok).toBe(true);
  });

  it("demo seed walks four orders through the real workflow", async () => {
    jar.clear();
    await signInAdmin("test-admin");
    const before = (await listAllOrders()).length;
    const res = await seedDemoOrders(INIT, new FormData());
    expect(res).toMatchObject({ ok: true });
    const demo = (await listAllOrders()).filter((o) => o.customerId === "cus_demo");
    expect(demo.length).toBe(4);
    expect((await listAllOrders()).length).toBe(before + 4);
    expect(demo.map((o) => o.status).sort()).toEqual(["draft", "qc_packing", "quoted", "submitted"]);
    const prod = demo.find((o) => o.status === "qc_packing")!;
    const b = await loadOrderBundle(prod);
    expect(b.release?.status).toBe("active");
    expect(b.order.paymentStatus).toBe("settled");
    expect(shipmentBlockers(b).length).toBeGreaterThan(0);
  });

  it("a reviewer cannot approve past an UNSUPPORTED verdict", async () => {
    jar.clear();
    const url = await expectRedirect(startOrder(INIT, form({ purpose: "general_storage", templateId: "TPL-LOW-O", postcode: "3000", deliveryMethod: "local_delivery" })));
    const id = url.split("/")[2]!;
    const b = await bundle(id);
    // Force a blocking version: width outside the domain.
    await saveDesign(id, { ...b.current.design, finished: { ...b.current.design.finished, width_mm: 2000 }, modules: [{ kind: "open", width_mm: 1000, shelfCount: 1 }, { kind: "open", width_mm: 1000, shelfCount: 1 }] });
    const b2 = await bundle(id);
    expect(b2.current.verdict).toBe("UNSUPPORTED");
    expect(b2.order.engineeringStatus).toBe("blocked");
    expect((await submitForReview(id, { name: "Sam Lee", email: "sam@example.com", phone: "0400 111 222" })).ok).toBe(false);
    await signInAdmin("test-admin");
    const r = await recordReview(INIT, form({ orderId: id, decision: "approved", notes: "trying to force it" }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/UNSUPPORTED/);
  });
});

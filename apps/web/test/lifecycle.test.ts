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
  uploadOrderMedia,
  type ActionState,
} from "@/server/actions/customer";
import { addCost, copyQuoteEstimateCosts, createReplacementRelease, deleteServiceArea, inspectPanel, issueQuote, packPackage, recordPayment, recordReview, runProductionStep, seedDemoOrders, updateServiceCase, upsertServiceArea } from "@/server/actions/admin";
import { contribution, quoteEstimateCosts, releaseGateFor, shipmentBlockers } from "@/server/production";
import { getOrder, getRelease, listAllOrders, listPayments, listReleases, listServiceAreas, loadOrderBundle } from "@/server/queries";
import { readMediaFile } from "@/server/media";

const INIT: ActionState = { ok: false };

/** 1×1 PNG used to exercise the photo-upload path. */
const PNG_1X1 = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQF/pYlY2wAAAABJRU5ErkJggg==", "base64"),
);

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

  it("payments before confirmation are refused except a refundable intent deposit", async () => {
    const pay = await recordCustomerPayment(orderId, "deposit");
    expect(pay.ok).toBe(false);
    const intent = await recordCustomerPayment(orderId, "intent_deposit");
    expect(intent).toMatchObject({ ok: true });
    expect((await recordCustomerPayment(orderId, "intent_deposit")).ok).toBe(true);
    const b = await bundle(orderId);
    expect(b.payments.filter((p) => p.kind === "intent_deposit")).toHaveLength(1);
    expect(b.totals.intent_cents).toBe(Math.round(b.quote!.totalCents * 0.1));
    expect(b.order.paymentStatus).toBe("unpaid");
    const gate = releaseGateFor(b);
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
    expect(payments.filter((p) => p.kind === "deposit")).toHaveLength(1);
    expect(payments.filter((p) => p.kind === "balance")).toHaveLength(1);
    expect(payments.filter((p) => p.kind === "intent_deposit")).toHaveLength(1);
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

    const missing = await createReplacementRelease(INIT, form({ orderId, caseId: b.cases[0]!.id, partRef: "M9-NOPE" }));
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/not in release/);

    const created = await createReplacementRelease(INIT, form({ orderId, caseId: b.cases[0]!.id }));
    expect(created.ok).toBe(true);
    b = await bundle(orderId);
    expect(b.release!.kind).not.toBe("replacement");
    const original = b.releases.find((r) => r.kind !== "replacement")!;
    const repl = b.releases.find((r) => r.kind === "replacement");
    expect(repl).toBeDefined();
    expect(repl!.payload.kind).toBe("replacement");
    expect(repl!.payload.panels).toHaveLength(1);
    expect(repl!.payload.panels[0]).toEqual(original.payload.panels.find((p) => p.id === "M1-DOOR-L"));
    expect(repl!.payload.design.finished).toEqual(original.payload.design.finished);
    expect(repl!.payload.replacement?.sourceReleaseKey).toBe(original.releaseKey);
    expect(repl!.payload.replacement?.serviceCaseId).toBe(b.cases[0]!.id);
    expect(repl!.serviceCaseId).toBe(b.cases[0]!.id);
    expect(b.release!.releaseKey).toBe(original.releaseKey);

    expect((await inspectPanel(INIT, form({ orderId, releaseKey: repl!.releaseKey, panelId: "M1-DOOR-L", result: "pass" }))).ok).toBe(true);
    const pkg = repl!.payload.packaging.packages[0]!;
    expect((await packPackage(INIT, form({ orderId, releaseKey: repl!.releaseKey, code: pkg.code, weight_kg: String(pkg.weight_kg), verified: "on" }))).ok).toBe(true);
    expect(shipmentBlockers(b, repl).length).toBeGreaterThan(0);
    b = await bundle(orderId);
    expect(shipmentBlockers(b, repl).join(" ")).not.toMatch(/not inspected|not packed/);
    const shipped = await runProductionStep(INIT, form({ orderId, intent: "ship_replacement", text: "courier", releaseKey: repl!.releaseKey }));
    expect(shipped.ok).toBe(true);
    b = await bundle(orderId);
    expect(b.order.status).toBe("aftersales");
    expect(b.release!.releaseKey).toBe(original.releaseKey);

    const upd = await updateServiceCase(INIT, form({ caseId: b.cases[0]!.id, orderId, status: "resolved", cause: "packaging_transport", responsibility: "platform", resolution: `Re-cut from ${original.releaseKey} as ${repl!.releaseKey}`, cost: "38.5" }));
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

  it("FR-12 photos are stored as files and a safety case pauses new production", async () => {
    const fd = form({
      orderId,
      partRef: "M1-SIDE_L",
      partKind: "panel",
      severity: "safety",
      symptom: "Crack along the left side near the hinge plate after assembly.",
    });
    fd.append("photos", new File([PNG_1X1], "crack.png", { type: "image/png" }));
    const opened = await openServiceCase(INIT, fd);
    expect(opened.ok).toBe(true);
    const b = await bundle(orderId);
    expect(b.order.status).toBe("aftersales");
    const safety = b.cases.find((c) => c.severity === "safety")!;
    expect(safety.photoRefs).toHaveLength(1);
    expect(safety.photoRefs[0]).toMatch(/^\/api\/media\/med_/);
    const mediaId = safety.photoRefs[0]!.split("/").pop()!;
    const stored = await readMediaFile(mediaId);
    expect(stored).not.toBeNull();
    expect(stored!.mime).toBe("image/png");
    expect(stored!.bytes[0]).toBe(0x89);
    expect(b.events.some((e) => e.kind === "block_opened" && String(e.payload.reason).toLowerCase().includes("safety"))).toBe(true);
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
    const photoFd = form({ orderId: id });
    photoFd.append("photos", new File([PNG_1X1], "alcove.png", { type: "image/png" }));
    const up = await uploadOrderMedia(photoFd);
    expect(up.ok).toBe(true);
    expect(up.refs?.[0]).toMatch(/^\/api\/media\/med_/);
    const withPhoto = await saveMeasurement(id, {
      spaceConstrained: false,
      internalRequirements: [],
      obstacles: [],
      evidence: [{ kind: "photo", ref: up.refs![0]! }],
    });
    expect(withPhoto.ok).toBe(true);
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

  it("service area postcodes can be added and removed by staff", async () => {
    await signInAdmin("test-admin");
    expect(await upsertServiceArea(INIT, form({ postcode: "3999", zone: "A", label: "Trial suburb" }))).toMatchObject({ ok: true });
    expect((await listServiceAreas()).some((r) => r.postcode === "3999")).toBe(true);
    expect(await deleteServiceArea(INIT, form({ postcode: "3999" }))).toMatchObject({ ok: true });
    expect((await listServiceAreas()).some((r) => r.postcode === "3999")).toBe(false);
  });

  it("quote estimate lines can be copied into the cost ledger once", async () => {
    jar.clear();
    const url = await expectRedirect(startOrder(INIT, form({ purpose: "general_storage", templateId: "TPL-LOW-O", postcode: "3000", deliveryMethod: "local_delivery", width_mm: "900" })));
    const id = url.split("/")[2]!;
    await saveMeasurement(id, { spaceConstrained: false, internalRequirements: [], obstacles: [], evidence: [] });
    expect((await submitForReview(id, { name: "Sam Lee", email: "sam@example.com", phone: "0400 111 222" })).ok).toBe(true);
    await signInAdmin("test-admin");
    expect(await recordReview(INIT, form({ orderId: id, decision: "approved", notes: "Checked and approved." }))).toMatchObject({ ok: true });
    expect(await issueQuote(INIT, form({ orderId: id, leadTimeDays: "14", validityDays: "7" }))).toMatchObject({ ok: true });
    const first = await copyQuoteEstimateCosts(INIT, form({ orderId: id }));
    expect(first).toMatchObject({ ok: true });
    const b = await bundle(id);
    expect(b.costs.length).toBe(quoteEstimateCosts(b.quote!.price).length);
    expect(b.costs.every((c) => c.note?.startsWith("Quote estimate at release"))).toBe(true);
    const second = await copyQuoteEstimateCosts(INIT, form({ orderId: id }));
    expect(second.message).toMatch(/already/);
    expect((await bundle(id)).costs.length).toBe(b.costs.length);
  });

  it("a release can be loaded by key for the public assembly guide without customer PII in the payload summary", async () => {
    jar.clear();
    await signInAdmin("test-admin");
    const demo = (await listAllOrders()).filter((o) => o.status === "qc_packing" && o.customerId === "cus_demo");
    expect(demo.length).toBeGreaterThan(0);
    const b = await loadOrderBundle(demo[0]!);
    const rel = await getRelease(b.release!.releaseKey);
    expect(rel).not.toBeNull();
    expect(JSON.stringify(rel!.payload.summary)).not.toMatch(/@example\.com/);
    expect(rel!.payload.design.installation.deliveryPostcode).toBeTruthy();
  });
});

"use server";

import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDays, buildProductionRelease, buildReplacementRelease, newId, type DesignSpec, type MeasurementSet } from "@cfp/core";
import { getDb } from "@/db/client";
import { confirmations, costRecords, designVersions, enquiries, media, orders, payments, productionEvents, quotes, releases, reviews, serviceAreas, serviceCases, type CostCategory, type Order } from "@/db/schema";
import { requireAdmin, setCustomerId, signInAdmin, signOutAdmin } from "@/lib/auth";
import { DEMO_CUSTOMER_ID, DEMO_ENQUIRY_NOTE, demoToolsEnabled } from "@/lib/demo";
import { catalog, DEFAULT_LEAD_TIME_DAYS, DEPOSIT_RATE, FACTORY_ADAPTER, pilotPriceList } from "@/lib/catalog";
import { evaluateDesign } from "@/lib/engineering";
import { nowIso } from "@/lib/format";
import { appendDesignVersion, confirmCurrentVersion, createDraftOrder, logEvent, recomputePaymentStatus, requiredAcknowledgements, transition, updateOrder } from "../orders";
import { releaseGateFor, shipmentBlockers, quoteEstimateCosts } from "../production";
import { currentDesignVersion, getOrder, getRelease, loadOrderBundle } from "../queries";
import type { ActionState } from "./customer";

export async function adminLogin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ok = await signInAdmin(String(formData.get("password") ?? ""));
  if (!ok) return { ok: false, error: "Incorrect password." };
  redirect("/admin");
}

export async function adminLogout(): Promise<void> {
  await signOutAdmin();
  redirect("/admin/login");
}

function refresh(orderId: string) {
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/admin");
}

async function staffOrder(orderId: string): Promise<{ actor: string; order: Order }> {
  const actor = await requireAdmin();
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found.");
  return { actor, order };
}

function fail(error: string): ActionState {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// Engineering review (FR-05)
// ---------------------------------------------------------------------------

const ReviewSchema = z.object({
  orderId: z.string().min(1),
  decision: z.enum(["approved", "needs_changes", "blocked"]),
  notes: z.string().trim().min(3).max(4000),
});

export async function recordReview(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = ReviewSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return fail("Decision and a note (min 3 characters) are required.");
  const { orderId, decision, notes } = parsed.data;
  const { actor, order } = await staffOrder(orderId);
  const current = await currentDesignVersion(order);
  if (decision === "approved") {
    if (current.verdict === "UNSUPPORTED" || !current.engineering.cabinet) {
      return fail("Automated rules report UNSUPPORTED for this version. A reviewer cannot approve past a rule gap; fix the template or rules first (PRD FR-05).");
    }
    if (order.status !== "submitted") return fail(`Only submitted orders can be approved (order is ${order.status}).`);
  }
  const db = await getDb();
  await db.insert(reviews).values({
    id: newId("rev"),
    orderId,
    designVersion: current.version,
    decision,
    notes,
    reviewer: actor,
    ruleSetVersion: current.engineering.report?.ruleSetVersion ?? null,
    createdAt: nowIso(),
  });
  if (decision === "approved") {
    await updateOrder(orderId, { engineeringStatus: "approved", approvedDesignVersion: current.version });
  } else {
    await updateOrder(orderId, { engineeringStatus: decision === "blocked" ? "blocked" : "review_required" });
    if (order.status === "submitted" || order.status === "quoted" || order.status === "confirmed") {
      await db.update(quotes).set({ status: "superseded" }).where(and(eq(quotes.orderId, orderId), eq(quotes.status, "active")));
      await transition({ ...order }, "needs_changes");
    }
  }
  refresh(orderId);
  return { ok: true, message: `Review recorded: ${decision}.` };
}

// ---------------------------------------------------------------------------
// Formal quote (FR-06)
// ---------------------------------------------------------------------------

const QuoteSchema = z.object({
  orderId: z.string().min(1),
  leadTimeDays: z.coerce.number().int().min(1).max(120).default(DEFAULT_LEAD_TIME_DAYS),
  // Capped further by the price list's quoteValidityDays when the quote is written.
  validityDays: z.coerce.number().int().min(1).max(30).default(7),
  notes: z.string().trim().max(2000).optional(),
});

export async function issueQuote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = QuoteSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return fail("Lead time (1–120 days) and validity (1–30 days) must be numbers.");
  const { orderId, leadTimeDays, validityDays, notes } = parsed.data;
  const { actor, order } = await staffOrder(orderId);
  if (order.status !== "submitted") return fail(`Quotes are issued on submitted orders (order is ${order.status}).`);
  if (order.engineeringStatus !== "approved" || order.approvedDesignVersion !== order.currentDesignVersion) {
    return fail("Engineering must approve the current design version before a quote is issued.");
  }
  const current = await currentDesignVersion(order);
  // Recompute on the server; never trust a stored or client-side total (FR-06 acceptance).
  const fresh = await evaluateDesign(current.design, current.measurement ?? null);
  if (!fresh.price || !fresh.engineeringHash) return fail("The design no longer prices; re-run engineering.");
  if (fresh.engineeringHash !== current.engineeringHash) {
    await updateOrder(orderId, { engineeringStatus: "review_required" });
    refresh(orderId);
    return fail("Engineering output changed since approval (catalog or rules updated). The version needs a new review.");
  }
  const db = await getDb();
  const now = new Date();
  await db.update(quotes).set({ status: "superseded" }).where(and(eq(quotes.orderId, orderId), eq(quotes.status, "active")));
  const pl = pilotPriceList();
  await db.insert(quotes).values({
    id: newId("quo"),
    orderId,
    designVersion: current.version,
    engineeringHash: fresh.engineeringHash,
    price: fresh.price,
    totalCents: fresh.price.totalIncGst_cents,
    deliveryCents: fresh.price.delivery_cents,
    depositCents: Math.round(fresh.price.totalIncGst_cents * DEPOSIT_RATE),
    priceListId: pl.id,
    priceListVersion: pl.version,
    factoryId: order.factoryId,
    factoryVersion: order.factoryVersion,
    leadTimeDays,
    notes: notes || null,
    status: "active",
    issuedBy: actor,
    issuedAt: now.toISOString(),
    validUntil: addDays(now, Math.min(validityDays, pl.quoteValidityDays)).toISOString(),
    acceptedAt: null,
  });
  await transition(order, "quoted", { quotedDesignVersion: current.version });
  await recomputePaymentStatus(orderId);
  refresh(orderId);
  return { ok: true, message: "Formal quote issued." };
}

// ---------------------------------------------------------------------------
// Payments ledger (FR-07)
// ---------------------------------------------------------------------------

const PaymentSchema = z.object({
  orderId: z.string().min(1),
  kind: z.enum(["intent_deposit", "deposit", "balance", "refund"]),
  amount: z.coerce.number().positive(),
  method: z.string().trim().min(2).max(50),
  reference: z.string().trim().max(100).optional(),
  idempotencyKey: z.string().trim().min(4).max(120),
  note: z.string().trim().max(500).optional(),
});

export async function recordPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = PaymentSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return fail("Amount, method and an idempotency key (e.g. the bank reference) are required.");
  const p = parsed.data;
  const { actor } = await staffOrder(p.orderId);
  const db = await getDb();
  const inserted = await db
    .insert(payments)
    .values({
      id: newId("pay"),
      orderId: p.orderId,
      idempotencyKey: p.idempotencyKey,
      kind: p.kind,
      amountCents: Math.round(p.amount * 100),
      method: p.method,
      reference: p.reference || null,
      note: p.note || null,
      recordedBy: actor,
      createdAt: nowIso(),
    })
    .onConflictDoNothing()
    .returning({ id: payments.id });
  await recomputePaymentStatus(p.orderId);
  refresh(p.orderId);
  return inserted.length ? { ok: true, message: "Payment recorded." } : { ok: true, message: "Duplicate notification ignored — this reference was already recorded." };
}

// ---------------------------------------------------------------------------
// Production release and shop-floor steps (FR-08, FR-09, FR-10)
// ---------------------------------------------------------------------------

const StepSchema = z.object({
  orderId: z.string().min(1),
  intent: z.enum(["materials_confirmed", "capacity_confirmed", "release", "start_production", "start_qc", "ship", "delivered", "complete", "open_block", "close_block", "note", "stop_release", "ship_replacement"]),
  text: z.string().trim().max(2000).optional(),
  blockId: z.string().optional(),
  releaseKey: z.string().optional(),
});

export async function runProductionStep(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = StepSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return fail("Invalid production step.");
  const { orderId, intent, text, blockId, releaseKey: stepReleaseKey } = parsed.data;
  const { actor, order } = await staffOrder(orderId);
  const bundle = await loadOrderBundle(order);
  const releaseKey = bundle.release?.releaseKey ?? null;

  switch (intent) {
    case "materials_confirmed":
    case "capacity_confirmed": {
      await logEvent(orderId, releaseKey, intent, { designVersion: order.currentDesignVersion, note: text ?? "" }, actor);
      break;
    }
    case "release": {
      const gate = releaseGateFor(bundle);
      if (!gate.ok) return { ok: false, error: "Release gate not satisfied.", reasons: gate.reasons };
      const eng = bundle.current.engineering;
      const approval = bundle.reviews.find((r) => r.decision === "approved" && r.designVersion === order.currentDesignVersion);
      if (!approval || !bundle.confirmation || !bundle.quote || !eng.cabinet || !eng.bom || !eng.packaging || !eng.assembly || !eng.report || !eng.price || !eng.versions) {
        return fail("Release inputs incomplete.");
      }
      const ctx = catalog.resolveTemplate(bundle.current.design.templateId, bundle.current.design.templateVersion);
      const sequence = bundle.releases.length + 1;
      const rel = buildProductionRelease({
        orderId,
        designVersion: bundle.current.version,
        engineeringHash: bundle.current.engineeringHash ?? "",
        design: bundle.current.design,
        cabinet: eng.cabinet,
        bom: eng.bom,
        packaging: eng.packaging,
        assembly: eng.assembly,
        report: eng.report,
        price: eng.price,
        quote: { id: bundle.quote.id, total_cents: bundle.quote.totalCents },
        approval: { reviewId: approval.id, approvedBy: approval.reviewer, approvedAt: approval.createdAt, notes: approval.notes },
        confirmation: { id: bundle.confirmation.id, confirmedAt: bundle.confirmation.confirmedAt, snapshotHash: bundle.confirmation.snapshotHash },
        factory: { id: order.factoryId, version: order.factoryVersion, adapter: FACTORY_ADAPTER },
        versions: { ruleSetVersion: eng.versions.ruleSetVersion, priceListId: bundle.quote.priceListId, priceListVersion: bundle.quote.priceListVersion },
        loadStatement: { shelf_kg: ctx.construction.shelfLoadRating_kg, top_kg: ctx.construction.topLoadRating_kg },
        sequence,
      });
      const db = await getDb();
      await db.update(releases).set({ status: "superseded" }).where(and(eq(releases.orderId, orderId), eq(releases.status, "active"), eq(releases.kind, "production")));
      // Same key -> same release: a retried request never creates a second executable task (FR-08).
      await db
        .insert(releases)
        .values({
          releaseKey: rel.payload.releaseKey,
          orderId,
          designVersion: bundle.current.version,
          sequence,
          payload: rel.payload,
          contentHash: rel.contentHash,
          status: "active",
          kind: "production",
          releasedBy: actor,
          releasedAt: nowIso(),
        })
        .onConflictDoUpdate({ target: releases.releaseKey, set: { status: "active" } });
      await transition(order, "released");
      await logEvent(orderId, rel.payload.releaseKey, "note", { note: `Release ${rel.payload.releaseKey} issued (content ${rel.contentHash.slice(0, 12)}…)` }, actor);
      break;
    }
    case "start_production": {
      if (!bundle.release) return fail("No active release.");
      await transition(order, "in_production");
      await logEvent(orderId, releaseKey, "production_started", { note: text ?? "" }, actor);
      break;
    }
    case "start_qc": {
      await transition(order, "qc_packing");
      break;
    }
    case "ship": {
      if (!bundle.release) return fail("No active release.");
      const missing = shipmentBlockers(bundle);
      if (missing.length) return { ok: false, error: "Cannot ship: dispatch checks incomplete.", reasons: missing };
      await transition(order, "shipped");
      await logEvent(orderId, releaseKey, "shipped", { carrier: text ?? "local delivery" }, actor);
      break;
    }
    case "ship_replacement": {
      const key = stepReleaseKey;
      if (!key) return fail("Replacement release key missing.");
      const repl = bundle.releases.find((r) => r.releaseKey === key);
      if (!repl || repl.kind !== "replacement") return fail("Not a replacement release.");
      if (repl.status !== "active") return fail("That replacement is not active.");
      const missing = shipmentBlockers(bundle, repl);
      if (missing.length) return { ok: false, error: "Cannot ship replacement: checks incomplete.", reasons: missing };
      await logEvent(orderId, key, "shipped", { carrier: text ?? "local delivery", kind: "replacement" }, actor);
      break;
    }
    case "delivered": {
      await transition(order, "delivered");
      await logEvent(orderId, releaseKey, "delivered", { note: text ?? "" }, actor);
      break;
    }
    case "complete": {
      await transition(order, "completed");
      break;
    }
    case "open_block": {
      if (!text) return fail("Describe the block.");
      await logEvent(orderId, releaseKey, "block_opened", { reason: text }, actor);
      break;
    }
    case "close_block": {
      if (!blockId) return fail("Block id missing.");
      await logEvent(orderId, releaseKey, "block_closed", { blockId, note: text ?? "" }, actor);
      break;
    }
    case "note": {
      if (!text) return fail("Empty note.");
      await logEvent(orderId, releaseKey, "note", { note: text }, actor);
      break;
    }
    case "stop_release": {
      if (!bundle.release) return fail("No active release.");
      const db = await getDb();
      await db.update(releases).set({ status: "stopped", stoppedReason: text ?? "Stopped by staff" }).where(eq(releases.releaseKey, bundle.release.releaseKey));
      if (order.status === "released") await transition(order, "confirmed");
      await logEvent(orderId, releaseKey, "block_opened", { reason: `Release ${bundle.release.releaseKey} stopped: ${text ?? ""}` }, actor);
      break;
    }
  }
  refresh(orderId);
  return { ok: true, message: `Done: ${intent.replace(/_/g, " ")}.` };
}

const InspectSchema = z.object({
  orderId: z.string().min(1),
  releaseKey: z.string().min(1),
  panelId: z.string().min(1),
  result: z.enum(["pass", "fail"]),
  notes: z.string().trim().max(500).optional(),
});

export async function inspectPanel(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = InspectSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return fail("Invalid inspection.");
  const i = parsed.data;
  const { actor, order } = await staffOrder(i.orderId);
  const release = await getRelease(i.releaseKey);
  if (!release || release.orderId !== order.id) return fail("Inspection must reference an active release; this release is not active (wrong-version parts are rejected).");
  if (release.status !== "active") return fail("Inspection must reference an active release; this release is not active (wrong-version parts are rejected).");
  if (!release.payload.panels.some((p) => p.id === i.panelId)) return fail(`Panel ${i.panelId} is not part of release ${i.releaseKey}.`);
  await logEvent(i.orderId, i.releaseKey, "panel_inspected", { panelId: i.panelId, pass: i.result === "pass", notes: i.notes ?? "" }, actor);
  refresh(i.orderId);
  return { ok: true };
}

const PackSchema = z.object({
  orderId: z.string().min(1),
  releaseKey: z.string().min(1),
  code: z.string().min(1),
  weight_kg: z.coerce.number().positive(),
  verified: z.string().optional(),
});

export async function packPackage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = PackSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return fail("Weigh the package and tick the contents check.");
  const i = parsed.data;
  const { actor, order } = await staffOrder(i.orderId);
  const release = await getRelease(i.releaseKey);
  if (!release || release.orderId !== order.id || release.status !== "active") return fail("Package must reference an active release.");
  const pkg = release.payload.packaging.packages.find((p) => p.code === i.code);
  if (!pkg) return fail(`Package ${i.code} is not in this release.`);
  if (i.verified !== "on") return fail("Contents must be verified against the packing list before the package counts as packed.");
  const deviation = Math.abs(i.weight_kg - pkg.weight_kg);
  await logEvent(i.orderId, i.releaseKey, "package_packed", { code: i.code, weight_kg: i.weight_kg, planned_kg: pkg.weight_kg, deviation_kg: Math.round(deviation * 100) / 100, verified: true }, actor);
  refresh(i.orderId);
  return { ok: true, message: deviation > Math.max(1, pkg.weight_kg * 0.2) ? `Packed. Weight differs from plan by ${deviation.toFixed(1)} kg — check contents.` : "Packed." };
}

// ---------------------------------------------------------------------------
// After-sales and costs (FR-12, FR-13)
// ---------------------------------------------------------------------------

const CaseUpdateSchema = z.object({
  caseId: z.string().min(1),
  orderId: z.string().min(1),
  status: z.enum(["open", "responded", "resolved", "closed"]),
  cause: z.string().trim().max(500).optional(),
  responsibility: z.string().trim().max(100).optional(),
  resolution: z.string().trim().max(2000).optional(),
  cost: z.coerce.number().min(0).default(0),
});

export async function updateServiceCase(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = CaseUpdateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return fail("Invalid case update.");
  const i = parsed.data;
  await staffOrder(i.orderId);
  const db = await getDb();
  const now = nowIso();
  await db
    .update(serviceCases)
    .set({
      status: i.status,
      cause: i.cause || null,
      responsibility: i.responsibility || null,
      resolution: i.resolution || null,
      costCents: Math.round(i.cost * 100),
      respondedAt: i.status === "open" ? null : now,
      resolvedAt: i.status === "resolved" || i.status === "closed" ? now : null,
    })
    .where(eq(serviceCases.id, i.caseId));
  refresh(i.orderId);
  return { ok: true, message: "Case updated." };
}

const ReplacementSchema = z.object({
  orderId: z.string().min(1),
  caseId: z.string().min(1),
  partRef: z.string().trim().max(40).optional(),
});

/** FR-12 / PRD §7.2: issue a single-part job copied from the original release package. */
export async function createReplacementRelease(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = ReplacementSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return fail("Case and order are required.");
  const i = parsed.data;
  const { actor, order } = await staffOrder(i.orderId);
  const bundle = await loadOrderBundle(order);
  const cse = bundle.cases.find((c) => c.id === i.caseId);
  if (!cse) return fail("Case not found.");
  if (cse.partKind !== "panel" && cse.partKind !== "hardware_bag") {
    return fail("Only panels and hardware bags can be manufactured as replacements. Handle documents another way.");
  }
  const partRef = i.partRef || cse.partRef;
  const source =
    bundle.releases.find((r) => r.releaseKey === cse.releaseKey && r.kind !== "replacement") ??
    bundle.release;
  if (!source) return fail("No original production release to copy from.");
  const existing = bundle.releases.find((r) => r.kind === "replacement" && r.serviceCaseId === cse.id && r.status === "active" && !i.partRef);
  if (existing) return { ok: true, message: `Replacement ${existing.releaseKey} already exists.` };
  let rel;
  try {
    rel = buildReplacementRelease({
      source: source.payload,
      sequence: bundle.releases.length + 1,
      serviceCaseId: cse.id,
      partKind: cse.partKind,
      partRef,
      factory: catalog.getFactory(order.factoryId),
      requestedAt: nowIso(),
    });
  } catch (err) {
    return fail((err as Error).message);
  }
  const db = await getDb();
  await db.insert(releases).values({
    releaseKey: rel.payload.releaseKey,
    orderId: order.id,
    designVersion: source.designVersion,
    sequence: rel.payload.sequence,
    payload: rel.payload,
    contentHash: rel.contentHash,
    status: "active",
    kind: "replacement",
    sourceReleaseKey: source.releaseKey,
    serviceCaseId: cse.id,
    releasedBy: actor,
    releasedAt: nowIso(),
  });
  await logEvent(order.id, rel.payload.releaseKey, "note", { note: `Replacement ${rel.payload.releaseKey} copied from ${source.releaseKey} for ${partRef} (case ${cse.id}).` }, actor);
  refresh(order.id);
  return { ok: true, message: `Replacement ${rel.payload.releaseKey} issued from ${source.releaseKey}.` };
}

const CostSchema = z.object({
  orderId: z.string().min(1),
  category: z.string().min(1),
  amount: z.coerce.number().min(0),
  minutes: z.coerce.number().int().min(0).optional(),
  note: z.string().trim().max(500).optional(),
});

export async function addCost(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = CostSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return fail("Category and amount are required.");
  const i = parsed.data;
  const { actor } = await staffOrder(i.orderId);
  const db = await getDb();
  await db.insert(costRecords).values({
    id: newId("cost"),
    orderId: i.orderId,
    category: i.category as CostCategory,
    amountCents: Math.round(i.amount * 100),
    minutes: i.minutes ?? null,
    note: i.note || null,
    recordedBy: actor,
    createdAt: nowIso(),
  });
  refresh(i.orderId);
  return { ok: true, message: "Cost recorded." };
}

export async function copyQuoteEstimateCosts(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orderId = String(formData.get("orderId") ?? "");
  const { actor, order } = await staffOrder(orderId);
  const bundle = await loadOrderBundle(order);
  if (!bundle.quote) return fail("No quote to copy from.");
  const db = await getDb();
  const existing = await db.select({ note: costRecords.note }).from(costRecords).where(eq(costRecords.orderId, orderId));
  if (existing.some((c) => c.note?.startsWith("Quote estimate at release"))) {
    return { ok: true, message: "Quote estimate lines are already on this order." };
  }
  const snapshot = quoteEstimateCosts(bundle.quote.price);
  if (!snapshot.length) return fail("Quote has no manufacturing or fulfilment lines to copy.");
  await db.insert(costRecords).values(
    snapshot.map((c) => ({
      id: newId("cost"),
      orderId,
      category: c.category,
      amountCents: c.amountCents,
      minutes: null,
      note: c.note,
      recordedBy: actor,
      createdAt: nowIso(),
    })),
  );
  refresh(orderId);
  return { ok: true, message: `Copied ${snapshot.length} estimate lines. Replace them with actuals as they come in.` };
}

const AreaSchema = z.object({
  postcode: z.string().trim().regex(/^\d{4}$/, "Australian postcodes have 4 digits"),
  zone: z.enum(["A", "B"]),
  label: z.string().trim().min(2).max(80),
});

export async function upsertServiceArea(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = AreaSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return fail("Postcode must be 4 digits and the zone must be A or B.");
  const db = await getDb();
  await db
    .insert(serviceAreas)
    .values(parsed.data)
    .onConflictDoUpdate({ target: serviceAreas.postcode, set: { zone: parsed.data.zone, label: parsed.data.label } });
  revalidatePath("/admin/service-areas");
  return { ok: true, message: `Postcode ${parsed.data.postcode} is in ${parsed.data.label}.` };
}

export async function deleteServiceArea(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const postcode = String(formData.get("postcode") ?? "").trim();
  if (!/^\d{4}$/.test(postcode)) return fail("Invalid postcode.");
  const db = await getDb();
  await db.delete(serviceAreas).where(eq(serviceAreas.postcode, postcode));
  revalidatePath("/admin/service-areas");
  return { ok: true, message: `Removed ${postcode}.` };
}

// ---------------------------------------------------------------------------
// Demo data (development aid): walks real orders through the real workflow.
// ---------------------------------------------------------------------------

export async function seedDemoOrders(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  if (!demoToolsEnabled()) return fail("Demo seeding is disabled in production.");
  const actor = await requireAdmin();
  try {
    await wipeDemoRecords();
    return await buildDemoPipeline(actor);
  } catch (err) {
    return fail(`Demo seed failed: ${(err as Error).message}`);
  }
}

export async function adoptDemoIdentity(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  if (!demoToolsEnabled()) return fail("Demo identity is disabled in production.");
  await requireAdmin();
  await setCustomerId(DEMO_CUSTOMER_ID);
  redirect("/orders");
}

async function buildDemoPipeline(actor: string): Promise<ActionState> {
  const db = await getDb();

  const freeStanding: MeasurementSet = { spaceConstrained: false, internalRequirements: [], obstacles: [], evidence: [], confirmedBy: "Demo Customer" };
  const alcove: MeasurementSet = {
    spaceConstrained: true,
    availableSpace: {
      widths: [
        { value_mm: 1540, source: "manual_remeasured", location: "floor" },
        { value_mm: 1548, source: "manual_remeasured", location: "600 mm" },
        { value_mm: 1544, source: "manual_remeasured", location: "top" },
      ],
    },
    obstacles: [{ kind: "skirting", description: "MDF skirting", protrusion_mm: 12 }],
    internalRequirements: [],
    evidence: [],
    confirmedBy: "Priya Nair",
  };

  // 1. Draft — open shelves, still in the configurator.
  await createDraftOrder({
    customerId: DEMO_CUSTOMER_ID,
    templateId: "TPL-LOW-O",
    purpose: "books_and_files",
    postcode: "3000",
    deliveryMethod: "local_delivery",
    width_mm: 900,
    budgetCents: 90_000,
    timeframe: "1-3 months",
    needsInstallation: false,
    customerName: "Jordan Blake",
    customerEmail: "jordan.blake@example.com",
    customerPhone: "0400 111 001",
    referralSource: "demo:draft",
  });

  // 2. Submitted — doors, 750 mm, alcove measured, waiting for engineering.
  const submittedId = await createDraftOrder({
    customerId: DEMO_CUSTOMER_ID,
    templateId: "TPL-LOW-D",
    purpose: "living_room_storage",
    postcode: "3100",
    deliveryMethod: "local_delivery",
    width_mm: 1500,
    budgetCents: 180_000,
    timeframe: "As soon as possible",
    needsInstallation: true,
    customerName: "Priya Nair",
    customerEmail: "priya.nair@example.com",
    customerPhone: "0400 111 002",
    referralSource: "demo:submitted",
  });
  let order = (await getOrder(submittedId))!;
  const current = await currentDesignVersion(order);
  const taller: DesignSpec = {
    ...current.design,
    finished: { ...current.design.finished, height_mm: 750, depth_mm: 450 },
    installation: { ...current.design.installation, wallType: "plasterboard_on_stud", antiTipAcknowledged: true },
  };
  await appendDesignVersion(order, taller, alcove, "customer", "Taller, deeper, alcove measured");
  order = (await getOrder(submittedId))!;
  await transition(order, "submitted", { customerName: "Priya Nair", customerEmail: "priya.nair@example.com", customerPhone: "0400 111 002" });

  // 3. Quoted — ready for the customer to confirm and pay an intent deposit.
  const quotedId = await createDraftOrder({
    customerId: DEMO_CUSTOMER_ID,
    templateId: "TPL-LOW-D",
    purpose: "general_storage",
    postcode: "3000",
    deliveryMethod: "local_delivery",
    width_mm: 1200,
    budgetCents: 150_000,
    timeframe: "1-3 months",
    needsInstallation: false,
    customerName: "Sam Okonkwo",
    customerEmail: "sam.okonkwo@example.com",
    customerPhone: "0400 111 003",
    referralSource: "demo:quoted",
  });
  await walkToQuoted(quotedId, { customerName: "Sam Okonkwo", customerEmail: "sam.okonkwo@example.com", customerPhone: "0400 111 003" }, freeStanding, actor);

  // 4. Confirmed and paid — release gate is open, not yet issued.
  const confirmedId = await createDraftOrder({
    customerId: DEMO_CUSTOMER_ID,
    templateId: "TPL-LOW-D",
    purpose: "general_storage",
    postcode: "3000",
    deliveryMethod: "local_delivery",
    width_mm: 1000,
    budgetCents: 140_000,
    timeframe: "1-3 months",
    needsInstallation: false,
    customerName: "Alex Chen",
    customerEmail: "alex.chen@example.com",
    customerPhone: "0400 111 004",
    referralSource: "demo:confirmed",
  });
  await walkToPaid(confirmedId, { customerName: "Alex Chen", customerEmail: "alex.chen@example.com", customerPhone: "0400 111 004" }, freeStanding, actor, "DEMO-CONF");

  // 5. Shop floor — QC started, some panels still pending so dispatch is blocked.
  const qcId = await createDraftOrder({
    customerId: DEMO_CUSTOMER_ID,
    templateId: "TPL-LOW-O",
    purpose: "general_storage",
    postcode: "3000",
    deliveryMethod: "pickup",
    width_mm: 1800,
    budgetCents: 160_000,
    timeframe: "1-3 months",
    needsInstallation: false,
    customerName: "Mei Tan",
    customerEmail: "mei.tan@example.com",
    customerPhone: "0400 111 005",
    referralSource: "demo:qc",
  });
  await walkToReleased(qcId, { customerName: "Mei Tan", customerEmail: "mei.tan@example.com", customerPhone: "0400 111 005" }, freeStanding, actor, "DEMO-QC");
  await mustStep(qcId, "start_production");
  await mustStep(qcId, "start_qc");
  let bundle = await loadOrderBundle((await getOrder(qcId))!);
  for (const p of bundle.release!.payload.panels.slice(0, 6)) {
    await logEvent(qcId, bundle.release!.releaseKey, "panel_inspected", { panelId: p.id, pass: true, notes: "demo" }, actor);
  }
  await db.insert(costRecords).values([
    { id: newId("cost"), orderId: qcId, category: "board", amountCents: 21_000, minutes: null, note: "2 sheets", recordedBy: actor, createdAt: nowIso() },
    { id: newId("cost"), orderId: qcId, category: "hardware", amountCents: 9_500, minutes: null, note: null, recordedBy: actor, createdAt: nowIso() },
    { id: newId("cost"), orderId: qcId, category: "presales_engineering", amountCents: 6_000, minutes: 40, note: "review + quote", recordedBy: actor, createdAt: nowIso() },
  ]);

  // 6. Delivered — every panel inspected, packed, shipped; assembly guide is live.
  const deliveredId = await createDraftOrder({
    customerId: DEMO_CUSTOMER_ID,
    templateId: "TPL-LOW-D",
    purpose: "living_room_storage",
    postcode: "3000",
    deliveryMethod: "local_delivery",
    width_mm: 1200,
    budgetCents: 170_000,
    timeframe: "1-3 months",
    needsInstallation: true,
    customerName: "Chris Walsh",
    customerEmail: "chris.walsh@example.com",
    customerPhone: "0400 111 006",
    referralSource: "demo:delivered",
  });
  await walkToReleased(deliveredId, { customerName: "Chris Walsh", customerEmail: "chris.walsh@example.com", customerPhone: "0400 111 006" }, freeStanding, actor, "DEMO-DEL", { height_mm: 750, antiTip: true });
  await finishShopFloor(deliveredId, actor);
  await mustStep(deliveredId, "ship", "local van");
  await mustStep(deliveredId, "delivered");
  const costs = await copyQuoteEstimateCosts({ ok: false }, formFields({ orderId: deliveredId }));
  if (!costs.ok) throw new Error(`Copy quote estimates failed: ${costs.error}`);

  // 7. After-sales — delivered, then a chipped door with a replacement job copied from the original release.
  const afterId = await createDraftOrder({
    customerId: DEMO_CUSTOMER_ID,
    templateId: "TPL-LOW-D",
    purpose: "general_storage",
    postcode: "3100",
    deliveryMethod: "local_delivery",
    width_mm: 1500,
    budgetCents: 190_000,
    timeframe: "1-3 months",
    needsInstallation: false,
    customerName: "Taylor Ng",
    customerEmail: "taylor.ng@example.com",
    customerPhone: "0400 111 007",
    referralSource: "demo:aftersales",
  });
  await walkToReleased(afterId, { customerName: "Taylor Ng", customerEmail: "taylor.ng@example.com", customerPhone: "0400 111 007" }, freeStanding, actor, "DEMO-AS", { height_mm: 750, antiTip: true });
  await finishShopFloor(afterId, actor);
  await mustStep(afterId, "ship", "local van");
  await mustStep(afterId, "delivered");
  order = (await getOrder(afterId))!;
  await transition(order, "aftersales");
  bundle = await loadOrderBundle((await getOrder(afterId))!);
  const door = bundle.release!.payload.panels.find((p) => p.role === "DOOR") ?? bundle.release!.payload.panels[0]!;
  const caseId = newId("case");
  await db.insert(serviceCases).values({
    id: caseId,
    orderId: afterId,
    releaseKey: bundle.release!.releaseKey,
    partRef: door.id,
    partKind: "panel",
    severity: "blocking",
    symptom: `Front edge of ${door.label} (${door.name}) arrived chipped in transit. Hole pattern matches the label; please remake from the original release.`,
    photoRefs: [],
    costCents: 0,
    status: "open",
    openedBy: "customer",
    createdAt: nowIso(),
  });
  const repl = await createReplacementRelease({ ok: false }, formFields({ orderId: afterId, caseId }));
  if (!repl.ok) throw new Error(`Replacement failed: ${repl.error}`);

  await db.insert(enquiries).values({
    id: newId("enq"),
    purpose: "tv_stand",
    postcode: "2000",
    budgetCents: 200_000,
    timeframe: "As soon as possible",
    needsInstallation: true,
    reasons: ["TV-bearing furniture is not in the launch range.", "Postcode 2000 is outside the current delivery area."],
    contact: "Riley Hart · 0400 111 000",
    notes: DEMO_ENQUIRY_NOTE,
    createdAt: nowIso(),
  });

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/cases");
  revalidatePath("/admin/demo");
  revalidatePath("/demo");
  revalidatePath("/orders");
  return { ok: true, message: "Demo pipeline ready: draft, submitted, quoted, confirmed (paid), QC, delivered, after-sales with replacement, plus one out-of-range enquiry." };
}

async function wipeDemoRecords(): Promise<void> {
  const db = await getDb();
  const demo = await db.select({ id: orders.id }).from(orders).where(eq(orders.customerId, DEMO_CUSTOMER_ID));
  const ids = demo.map((o) => o.id);
  if (ids.length) {
    await db.delete(media).where(inArray(media.orderId, ids));
    await db.delete(serviceCases).where(inArray(serviceCases.orderId, ids));
    await db.delete(costRecords).where(inArray(costRecords.orderId, ids));
    await db.delete(productionEvents).where(inArray(productionEvents.orderId, ids));
    await db.delete(releases).where(inArray(releases.orderId, ids));
    await db.delete(payments).where(inArray(payments.orderId, ids));
    await db.delete(confirmations).where(inArray(confirmations.orderId, ids));
    await db.delete(quotes).where(inArray(quotes.orderId, ids));
    await db.delete(reviews).where(inArray(reviews.orderId, ids));
    await db.delete(designVersions).where(inArray(designVersions.orderId, ids));
    await db.delete(orders).where(inArray(orders.id, ids));
  }
  await db.delete(enquiries).where(eq(enquiries.notes, DEMO_ENQUIRY_NOTE));
}

function formFields(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function stepForm(orderId: string, intent: string, text?: string): FormData {
  const fd = formFields({ orderId, intent });
  if (text) fd.set("text", text);
  return fd;
}

async function walkToQuoted(orderId: string, contact: Record<string, string>, measurement: MeasurementSet, actor: string): Promise<Order> {
  let order = (await getOrder(orderId))!;
  const current = await currentDesignVersion(order);
  await appendDesignVersion(order, current.design, measurement, "customer", "Free-standing placement confirmed");
  order = (await getOrder(orderId))!;
  await transition(order, "submitted", contact);
  order = (await getOrder(orderId))!;
  const review = await recordReview({ ok: false }, formFields({ orderId, decision: "approved", notes: `Demo approval by ${actor}: dimensions, span and delivery checked.` }));
  if (!review.ok) throw new Error(`Demo review failed: ${review.error}`);
  const quote = await issueQuote({ ok: false }, formFields({ orderId, leadTimeDays: "21", validityDays: "7" }));
  if (!quote.ok) throw new Error(`Demo quote failed: ${quote.error}`);
  return (await getOrder(orderId))!;
}

async function walkToPaid(orderId: string, contact: Record<string, string>, measurement: MeasurementSet, actor: string, payRef: string, opts?: { height_mm?: number; antiTip?: boolean }): Promise<Order> {
  if (opts?.height_mm) {
    let order = (await getOrder(orderId))!;
    const current = await currentDesignVersion(order);
    const next: DesignSpec = {
      ...current.design,
      finished: { ...current.design.finished, height_mm: opts.height_mm },
      installation: { ...current.design.installation, wallType: opts.antiTip ? "masonry" : current.design.installation.wallType, antiTipAcknowledged: opts.antiTip ?? current.design.installation.antiTipAcknowledged },
    };
    await appendDesignVersion(order, next, measurement, "customer", `Demo height ${opts.height_mm} mm`);
  }
  await walkToQuoted(orderId, contact, measurement, actor);
  const quotedOrder = (await getOrder(orderId))!;
  const current = await currentDesignVersion(quotedOrder);
  const acks = Object.fromEntries(requiredAcknowledgements(current.engineering.cabinet?.antiTipRequired ?? false).map((k) => [k, true]));
  const confirmed = await confirmCurrentVersion(quotedOrder, contact.customerName ?? "Demo Customer", acks);
  if (!confirmed.ok) throw new Error(`Demo confirmation failed: ${confirmed.error}`);
  const bundle = await loadOrderBundle((await getOrder(orderId))!);
  const db = await getDb();
  await db
    .insert(payments)
    .values({
      id: newId("pay"),
      orderId,
      idempotencyKey: `${orderId}:demo:${payRef}`,
      kind: "balance",
      amountCents: bundle.quote!.totalCents,
      method: "bank_transfer",
      reference: payRef,
      note: "Demo settlement",
      recordedBy: actor,
      createdAt: nowIso(),
    })
    .onConflictDoNothing();
  await recomputePaymentStatus(orderId);
  await logEvent(orderId, null, "materials_confirmed", { designVersion: bundle.order.currentDesignVersion, note: "demo batch" }, actor);
  await logEvent(orderId, null, "capacity_confirmed", { designVersion: bundle.order.currentDesignVersion, note: "demo slot" }, actor);
  return (await getOrder(orderId))!;
}

async function mustStep(orderId: string, intent: string, text?: string): Promise<void> {
  const res = await runProductionStep({ ok: false }, stepForm(orderId, intent, text));
  if (!res.ok) throw new Error(`${intent} failed: ${res.error} ${res.reasons?.join("; ") ?? ""}`);
}

async function walkToReleased(orderId: string, contact: Record<string, string>, measurement: MeasurementSet, actor: string, payRef: string, opts?: { height_mm?: number; antiTip?: boolean }): Promise<void> {
  await walkToPaid(orderId, contact, measurement, actor, payRef, opts);
  await mustStep(orderId, "release");
}

async function finishShopFloor(orderId: string, actor: string): Promise<void> {
  await mustStep(orderId, "start_production");
  await mustStep(orderId, "start_qc");
  const bundle = await loadOrderBundle((await getOrder(orderId))!);
  const rel = bundle.release!;
  for (const p of rel.payload.panels) {
    await logEvent(orderId, rel.releaseKey, "panel_inspected", { panelId: p.id, pass: true, notes: "demo" }, actor);
  }
  for (const pkg of rel.payload.packaging.packages) {
    await logEvent(orderId, rel.releaseKey, "package_packed", { code: pkg.code, weight_kg: pkg.weight_kg, planned_kg: pkg.weight_kg, deviation_kg: 0, verified: true }, actor);
  }
}

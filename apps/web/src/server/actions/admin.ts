"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDays, buildProductionRelease, newId, type DesignSpec, type MeasurementSet } from "@cfp/core";
import { getDb } from "@/db/client";
import { costRecords, payments, quotes, releases, reviews, serviceCases, type CostCategory, type Order } from "@/db/schema";
import { requireAdmin, signInAdmin, signOutAdmin } from "@/lib/auth";
import { catalog, DEFAULT_LEAD_TIME_DAYS, DEPOSIT_RATE, FACTORY_ADAPTER, pilotPriceList } from "@/lib/catalog";
import { evaluateDesign } from "@/lib/engineering";
import { nowIso } from "@/lib/format";
import { appendDesignVersion, confirmCurrentVersion, createDraftOrder, logEvent, recomputePaymentStatus, requiredAcknowledgements, transition, updateOrder } from "../orders";
import { releaseGateFor, shipmentBlockers } from "../production";
import { currentDesignVersion, getOrder, loadOrderBundle } from "../queries";
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
  intent: z.enum(["materials_confirmed", "capacity_confirmed", "release", "start_production", "start_qc", "ship", "delivered", "complete", "open_block", "close_block", "note", "stop_release"]),
  text: z.string().trim().max(2000).optional(),
  blockId: z.string().optional(),
});

export async function runProductionStep(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = StepSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return fail("Invalid production step.");
  const { orderId, intent, text, blockId } = parsed.data;
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
      await db.update(releases).set({ status: "superseded" }).where(and(eq(releases.orderId, orderId), eq(releases.status, "active")));
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
  const bundle = await loadOrderBundle(order);
  if (bundle.release?.releaseKey !== i.releaseKey) return fail("Inspection must reference the active release; this release is not active (wrong-version parts are rejected).");
  if (!bundle.release.payload.panels.some((p) => p.id === i.panelId)) return fail(`Panel ${i.panelId} is not part of release ${i.releaseKey}.`);
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
  const bundle = await loadOrderBundle(order);
  if (bundle.release?.releaseKey !== i.releaseKey) return fail("Package must reference the active release.");
  const pkg = bundle.release.payload.packaging.packages.find((p) => p.code === i.code);
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

// ---------------------------------------------------------------------------
// Demo data (development aid): walks real orders through the real workflow.
// ---------------------------------------------------------------------------

export async function seedDemoOrders(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") return fail("Demo seeding is disabled in production.");
  const actor = await requireAdmin();
  const customerId = "cus_demo";
  const contact = { customerName: "Demo Customer", customerEmail: "demo@example.com", customerPhone: "0400 000 000" };
  const freeStanding: MeasurementSet = { spaceConstrained: false, internalRequirements: [], obstacles: [], evidence: [], confirmedBy: "Demo Customer" };

  // 1. Draft, open shelves.
  await createDraftOrder({ customerId, templateId: "TPL-LOW-O", purpose: "books_and_files", postcode: "3000", deliveryMethod: "local_delivery", width_mm: 900, budgetCents: 90_000, timeframe: "1-3 months", needsInstallation: false });

  // 2. Submitted, waiting for review: doors, 750 high, alcove measured.
  const submittedId = await createDraftOrder({ customerId, templateId: "TPL-LOW-D", purpose: "living_room_storage", postcode: "3100", deliveryMethod: "local_delivery", width_mm: 1500, budgetCents: 180_000, timeframe: "As soon as possible", needsInstallation: true });
  let order = (await getOrder(submittedId))!;
  let current = await currentDesignVersion(order);
  const taller: DesignSpec = { ...current.design, finished: { ...current.design.finished, height_mm: 750, depth_mm: 450 }, installation: { ...current.design.installation, wallType: "plasterboard_on_stud", antiTipAcknowledged: true } };
  await appendDesignVersion(order, taller, { ...freeStanding, spaceConstrained: true, availableSpace: { widths: [{ value_mm: 1540, source: "manual_remeasured", location: "floor" }, { value_mm: 1548, source: "manual_remeasured", location: "600 mm" }, { value_mm: 1544, source: "manual_remeasured", location: "top" }] }, obstacles: [{ kind: "skirting", description: "MDF skirting", protrusion_mm: 12 }] }, "customer", "Taller, deeper, alcove measured");
  order = (await getOrder(submittedId))!;
  await transition(order, "submitted", contact);

  // 3. Quoted: approved and formally quoted.
  const quotedId = await createDraftOrder({ customerId, templateId: "TPL-LOW-D", purpose: "general_storage", postcode: "3000", deliveryMethod: "local_delivery", width_mm: 1200, budgetCents: 150_000, timeframe: "1-3 months", needsInstallation: false });
  await walkToQuoted(quotedId, contact, freeStanding, actor);

  // 4. In production: confirmed, paid, released, production started.
  const productionId = await createDraftOrder({ customerId, templateId: "TPL-LOW-O", purpose: "general_storage", postcode: "3000", deliveryMethod: "pickup", width_mm: 1800, budgetCents: 160_000, timeframe: "1-3 months", needsInstallation: false });
  const quotedOrder = await walkToQuoted(productionId, contact, freeStanding, actor);
  current = await currentDesignVersion(quotedOrder);
  const acks = Object.fromEntries(requiredAcknowledgements(current.engineering.cabinet?.antiTipRequired ?? false).map((k) => [k, true]));
  const confirmed = await confirmCurrentVersion(quotedOrder, "Demo Customer", acks);
  if (!confirmed.ok) return fail(`Demo seed failed at confirmation: ${confirmed.error}`);
  let bundle = await loadOrderBundle((await getOrder(productionId))!);
  const db = await getDb();
  await db.insert(payments).values({ id: newId("pay"), orderId: productionId, idempotencyKey: `${productionId}:demo:full`, kind: "balance", amountCents: bundle.quote!.totalCents, method: "bank_transfer", reference: "DEMO-001", note: "Demo settlement", recordedBy: actor, createdAt: nowIso() }).onConflictDoNothing();
  await recomputePaymentStatus(productionId);
  await logEvent(productionId, null, "materials_confirmed", { designVersion: bundle.order.currentDesignVersion, note: "demo batch" }, actor);
  await logEvent(productionId, null, "capacity_confirmed", { designVersion: bundle.order.currentDesignVersion, note: "demo slot" }, actor);
  const rel = await runProductionStep({ ok: false }, stepForm(productionId, "release"));
  if (!rel.ok) return fail(`Demo seed failed at release: ${rel.error} ${rel.reasons?.join("; ") ?? ""}`);
  await runProductionStep({ ok: false }, stepForm(productionId, "start_production"));
  await runProductionStep({ ok: false }, stepForm(productionId, "start_qc"));
  bundle = await loadOrderBundle((await getOrder(productionId))!);
  for (const p of bundle.release!.payload.panels.slice(0, 6)) {
    await logEvent(productionId, bundle.release!.releaseKey, "panel_inspected", { panelId: p.id, pass: true, notes: "demo" }, actor);
  }
  await db.insert(costRecords).values([
    { id: newId("cost"), orderId: productionId, category: "board", amountCents: 21_000, minutes: null, note: "2 sheets", recordedBy: actor, createdAt: nowIso() },
    { id: newId("cost"), orderId: productionId, category: "hardware", amountCents: 9_500, minutes: null, note: null, recordedBy: actor, createdAt: nowIso() },
    { id: newId("cost"), orderId: productionId, category: "presales_engineering", amountCents: 6_000, minutes: 40, note: "review + quote", recordedBy: actor, createdAt: nowIso() },
  ]);
  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  return { ok: true, message: "Created 4 demo orders: draft, submitted, quoted and in production (QC started)." };
}

function stepForm(orderId: string, intent: string): FormData {
  const fd = new FormData();
  fd.set("orderId", orderId);
  fd.set("intent", intent);
  return fd;
}

async function walkToQuoted(orderId: string, contact: Record<string, string>, measurement: MeasurementSet, actor: string): Promise<Order> {
  let order = (await getOrder(orderId))!;
  const current = await currentDesignVersion(order);
  await appendDesignVersion(order, current.design, measurement, "customer", "Free-standing placement confirmed");
  order = (await getOrder(orderId))!;
  await transition(order, "submitted", contact);
  order = (await getOrder(orderId))!;
  const reviewForm = new FormData();
  reviewForm.set("orderId", orderId);
  reviewForm.set("decision", "approved");
  reviewForm.set("notes", `Demo approval by ${actor}: dimensions, span and delivery checked.`);
  const review = await recordReview({ ok: false }, reviewForm);
  if (!review.ok) throw new Error(`Demo review failed: ${review.error}`);
  const quoteForm = new FormData();
  quoteForm.set("orderId", orderId);
  quoteForm.set("leadTimeDays", "21");
  quoteForm.set("validityDays", "7");
  const quote = await issueQuote({ ok: false }, quoteForm);
  if (!quote.ok) throw new Error(`Demo quote failed: ${quote.error}`);
  return (await getOrder(orderId))!;
}

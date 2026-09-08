import { eq } from "drizzle-orm";
import {
  assertTransition,
  contentHash,
  defaultDesign,
  derivePaymentStatus,
  newId,
  quoteValidity,
  type DesignSpec,
  type EngineeringStatus,
  type MeasurementSet,
  type OrderStatus,
  type Purpose,
} from "@cfp/core";
import { getDb } from "@/db/client";
import { confirmations, designVersions, orders, productionEvents, quotes, type ConfirmationSnapshot, type Order, type ProductionEventKind } from "@/db/schema";
import { newAccessToken } from "@/lib/auth";
import { catalog, pilotFactory, pilotPriceList } from "@/lib/catalog";
import { evaluateDesign, toStored } from "@/lib/engineering";
import { nowIso } from "@/lib/format";
import { activeOrAcceptedQuote, currentDesignVersion, listPayments, paymentTotals } from "./queries";

export interface NewOrderInput {
  customerId: string;
  templateId: string;
  purpose: Purpose;
  postcode: string;
  deliveryMethod: "local_delivery" | "pickup";
  width_mm?: number;
  budgetCents: number | null;
  timeframe: string | null;
  needsInstallation: boolean;
}

/** Creates a draft order with design version 1 from template defaults. */
export async function createDraftOrder(input: NewOrderInput): Promise<string> {
  const template = catalog.getTemplate(input.templateId);
  const ctx = catalog.resolveTemplate(template.id);
  const design: DesignSpec = defaultDesign(ctx, { purpose: input.purpose, deliveryPostcode: input.postcode, width_mm: input.width_mm });
  design.installation.deliveryMethod = input.deliveryMethod;
  const result = await evaluateDesign(design, null);
  const orderId = newId("ord");
  const db = await getDb();
  const now = nowIso();
  await db.insert(orders).values({
    id: orderId,
    customerId: input.customerId,
    accessToken: newAccessToken(),
    status: "draft",
    engineeringStatus: "unchecked",
    paymentStatus: "unpaid",
    purpose: input.purpose,
    postcode: input.postcode,
    budgetCents: input.budgetCents,
    timeframe: input.timeframe,
    needsInstallation: input.needsInstallation,
    templateId: template.id,
    currentDesignVersion: 1,
    factoryId: pilotFactory().id,
    factoryVersion: pilotFactory().version,
    priceListId: pilotPriceList().id,
    priceListVersion: pilotPriceList().version,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(designVersions).values({
    id: newId("dv"),
    orderId,
    version: 1,
    design,
    measurement: null,
    engineering: toStored(result),
    engineeringHash: result.engineeringHash,
    verdict: result.report?.verdict ?? null,
    createdBy: "customer",
    note: "Initial draft from template defaults",
    createdAt: now,
  });
  return orderId;
}

export const REQUIRED_ACKNOWLEDGEMENTS = ["dimensions", "structure", "price", "delivery", "installation", "consumer_rights"] as const;

export function requiredAcknowledgements(antiTipRequired: boolean): string[] {
  return antiTipRequired ? [...REQUIRED_ACKNOWLEDGEMENTS, "anti_tip"] : [...REQUIRED_ACKNOWLEDGEMENTS];
}

/**
 * FR-07: the customer confirms one specific version. A full snapshot (drawing
 * inputs, price, boundaries) is stored with its hash, not just a flag.
 */
export async function confirmCurrentVersion(
  order: Order,
  confirmedBy: string,
  acknowledgements: Record<string, boolean>,
): Promise<{ ok: true } | { ok: false; error: string; missing?: string[] }> {
  if (order.status !== "quoted") return { ok: false, error: `Order is ${order.status}; only quoted orders can be confirmed.` };
  const quote = await activeOrAcceptedQuote(order.id);
  const current = await currentDesignVersion(order);
  if (!quote || quote.status !== "active") return { ok: false, error: "There is no active quote to confirm." };
  const validity = quoteValidity(quote, new Date(), order.currentDesignVersion, current.engineeringHash);
  if (!validity.valid) return { ok: false, error: `Quote cannot be confirmed: ${validity.reason}` };
  const required = requiredAcknowledgements(current.engineering.cabinet?.antiTipRequired ?? false);
  const missing = required.filter((k) => !acknowledgements[k]);
  if (missing.length) return { ok: false, error: "Please tick every confirmation item before continuing.", missing };
  if (confirmedBy.trim().length < 2) return { ok: false, error: "Type your full name to sign the confirmation." };

  const ctx = catalog.resolveTemplate(current.design.templateId, current.design.templateVersion);
  const snapshot: ConfirmationSnapshot = {
    design: current.design,
    engineeringHash: current.engineeringHash ?? "",
    price: quote.price,
    quoteId: quote.id,
    leadTimeDays: quote.leadTimeDays,
    warnings: ctx.template.warnings,
    includes: quote.price.includes,
    excludes: quote.price.excludes,
    visibleStructure: visibleStructure(current.design),
    loadStatement: { shelf_kg: ctx.construction.shelfLoadRating_kg, top_kg: ctx.construction.topLoadRating_kg },
  };
  const db = await getDb();
  const now = nowIso();
  await db.insert(confirmations).values({
    id: newId("cnf"),
    orderId: order.id,
    designVersion: current.version,
    quoteId: quote.id,
    snapshot,
    snapshotHash: contentHash(snapshot),
    acknowledgements: Object.fromEntries(required.map((k) => [k, true])),
    confirmedBy: confirmedBy.trim(),
    confirmedAt: now,
  });
  await db.update(quotes).set({ status: "accepted", acceptedAt: now }).where(eq(quotes.id, quote.id));
  await transition(order, "confirmed", { confirmedDesignVersion: current.version });
  await recomputePaymentStatus(order.id);
  return { ok: true };
}

function visibleStructure(design: DesignSpec): string[] {
  const out: string[] = [];
  out.push(design.topPanelStyle === "single" ? "One continuous top panel across all modules" : "One top panel per module — visible seams between modules");
  design.modules.forEach((m, i) => {
    if (m.kind === "door") out.push(`Module ${i + 1}: ${m.doorSwing === "double" ? "two doors" : `one door hinged ${m.doorSwing}`}${m.handle === "none" ? ", no handle" : ", bar handle"}, ${m.shelfCount} shelf(s)`);
    else out.push(`Module ${i + 1}: open, ${m.shelfCount} shelf(s)`);
  });
  out.push("Adjustable feet (50 mm) under every module; 6 mm back panel");
  return out;
}

/** Shared order mutations used by both customer and staff actions. */

export function engineeringStatusFromVerdict(verdict: string | null | undefined): EngineeringStatus {
  if (verdict === "UNSUPPORTED" || !verdict) return "blocked";
  // PASS from the automated rules still needs human approval in V0/V1 (PRD FR-05).
  return "review_required";
}

export async function transition(order: Order, to: OrderStatus, extra: Partial<typeof orders.$inferInsert> = {}): Promise<void> {
  assertTransition(order.status, to);
  const db = await getDb();
  await db.update(orders).set({ status: to, updatedAt: nowIso(), ...extra }).where(eq(orders.id, order.id));
}

export function isDesignEditable(status: OrderStatus): boolean {
  return status === "draft" || status === "needs_changes" || status === "submitted" || status === "quoted";
}

export async function updateOrder(orderId: string, patch: Partial<typeof orders.$inferInsert>): Promise<void> {
  const db = await getDb();
  await db.update(orders).set({ ...patch, updatedAt: nowIso() }).where(eq(orders.id, orderId));
}

/**
 * Appends a design version: runs the kernel, stores the result and updates the
 * order's engineering status. Any pending approval or quote for an older
 * version becomes irrelevant through the version-match checks in the gate.
 */
export async function appendDesignVersion(
  order: Order,
  design: DesignSpec,
  measurement: MeasurementSet | null,
  createdBy: string,
  note: string | null,
): Promise<{ version: number; verdict: string | null; engineeringHash: string | null }> {
  const result = await evaluateDesign(design, measurement);
  const version = order.currentDesignVersion + 1;
  const db = await getDb();
  await db.insert(designVersions).values({
    id: newId("dv"),
    orderId: order.id,
    version,
    design,
    measurement,
    engineering: toStored(result),
    engineeringHash: result.engineeringHash,
    verdict: result.report?.verdict ?? null,
    createdBy,
    note,
    createdAt: nowIso(),
  });
  const patch: Partial<typeof orders.$inferInsert> = {
    currentDesignVersion: version,
    engineeringStatus: engineeringStatusFromVerdict(result.report?.verdict),
    templateId: design.templateId,
    postcode: design.installation.deliveryPostcode,
    purpose: design.purpose,
  };
  // A design change after submission or quotation invalidates the quote and
  // returns the order to draft for re-submission (PRD §7.2). This collapses the
  // legal path submitted/quoted -> needs_changes -> draft into one update.
  if (order.status === "quoted" || order.status === "submitted" || order.status === "needs_changes") {
    await db.update(quotes).set({ status: "superseded" }).where(eq(quotes.orderId, order.id));
    patch.status = "draft";
  }
  await updateOrder(order.id, patch);
  return { version, verdict: result.report?.verdict ?? null, engineeringHash: result.engineeringHash };
}

export async function recomputePaymentStatus(orderId: string): Promise<void> {
  const quote = await activeOrAcceptedQuote(orderId);
  const totals = paymentTotals(await listPayments(orderId));
  const status = quote
    ? derivePaymentStatus({
        total_cents: quote.totalCents,
        paid_cents: totals.paid_cents,
        refunded_cents: totals.refunded_cents,
        depositRequired_cents: quote.depositCents,
        disputed: false,
      })
    : totals.paid_cents - totals.refunded_cents > 0
      ? "partially_paid"
      : "unpaid";
  await updateOrder(orderId, { paymentStatus: status });
}

export async function logEvent(orderId: string, releaseKey: string | null, kind: ProductionEventKind, payload: Record<string, unknown>, actor: string): Promise<void> {
  const db = await getDb();
  await db.insert(productionEvents).values({ id: newId("evt"), orderId, releaseKey, kind, payload, actor, createdAt: nowIso() });
}

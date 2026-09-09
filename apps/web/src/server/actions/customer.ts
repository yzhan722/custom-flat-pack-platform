"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MeasurementSetSchema, newId, safeParseDesignSpec, type MeasurementSet, type Purpose } from "@cfp/core";
import { getDb } from "@/db/client";
import { enquiries, payments, serviceCases } from "@/db/schema";
import { ensureCustomerId, rememberClaim, tokenMatches } from "@/lib/auth";
import { catalog, lookupServiceArea } from "@/lib/catalog";
import { nowIso } from "@/lib/format";
import { isUploadedFile, saveUploads } from "@/server/media";
import { appendDesignVersion, confirmCurrentVersion, createDraftOrder, isDesignEditable, logEvent, recomputePaymentStatus, requiredAcknowledgements, transition, updateOrder } from "../orders";
import { activeOrAcceptedQuote, activeRelease, currentDesignVersion, getOrder, getOrderForViewer } from "../queries";

/** Called when a page is opened through its access link; makes later actions work without the token. */
export async function claimOrderAccess(orderId: string, token: string): Promise<boolean> {
  const order = await getOrder(orderId);
  if (!order || !tokenMatches(order.accessToken, token)) return false;
  await rememberClaim(orderId, token);
  return true;
}

export interface ActionState {
  ok: boolean;
  error?: string;
  reasons?: string[];
  fieldErrors?: Record<string, string>;
  message?: string;
  refs?: string[];
}

const PURPOSE_IDS = catalog.listPurposes().map((p) => p.id) as [Purpose, ...Purpose[]];

const StartSchema = z.object({
  purpose: z.enum(PURPOSE_IDS),
  templateId: z.string().min(1),
  postcode: z.string().trim().regex(/^\d{4}$/, "Australian postcodes have 4 digits"),
  deliveryMethod: z.enum(["local_delivery", "pickup"]),
  budget: z.string().trim().optional(),
  timeframe: z.string().trim().max(50).optional(),
  needsInstallation: z.string().optional(),
  width_mm: z.coerce.number().int().min(50).max(6000).optional(),
});

/** FR-01: service range and purpose gate. Creates a draft order only when everything is supported. */
export async function startOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = StartSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: "Please check the highlighted fields.", fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  }
  const input = parsed.data;
  const reasons: string[] = [];
  const purposeDef = catalog.getPurpose(input.purpose);
  if (!purposeDef.supported) reasons.push(`${purposeDef.label}: ${purposeDef.unsupportedReason ?? "not in the launch range."}`);

  let template;
  try {
    template = catalog.getTemplate(input.templateId);
  } catch {
    return { ok: false, error: "Unknown template." };
  }
  if (purposeDef.supported && !template.supportedPurposes.includes(input.purpose)) {
    const other = catalog.listTemplates().find((t) => t.supportedPurposes.includes(input.purpose));
    reasons.push(`${template.name} is not approved for "${purposeDef.label}".${other ? ` Choose "${other.name}" instead.` : ""}`);
  }
  const area = await lookupServiceArea(input.postcode);
  if (input.deliveryMethod === "local_delivery" && !area) {
    reasons.push(`Postcode ${input.postcode} is outside the current delivery area. You can continue with factory pickup, or leave your details for when the area opens.`);
  }
  if (reasons.length) return { ok: false, reasons };

  const customerId = await ensureCustomerId();
  const orderId = await createDraftOrder({
    customerId,
    templateId: template.id,
    purpose: input.purpose,
    postcode: input.postcode,
    deliveryMethod: input.deliveryMethod,
    width_mm: input.width_mm,
    budgetCents: input.budget ? Math.round(Number(input.budget.replace(/[^\d.]/g, "")) * 100) || null : null,
    timeframe: input.timeframe ?? null,
    needsInstallation: input.needsInstallation === "on",
  });
  redirect(`/design/${orderId}`);
}

const EnquirySchema = z.object({
  purpose: z.string().min(1),
  postcode: z.string().trim().min(3).max(10),
  budget: z.string().optional(),
  timeframe: z.string().optional(),
  needsInstallation: z.string().optional(),
  contact: z.string().trim().min(3).max(200),
  notes: z.string().trim().max(2000).optional(),
  reasons: z.string().optional(),
});

/** FR-01: keep the enquiry when we cannot serve the request, without entering the payment flow. */
export async function saveEnquiry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = EnquirySchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: "Please provide a way to contact you." };
  const i = parsed.data;
  const db = await getDb();
  await db.insert(enquiries).values({
    id: newId("enq"),
    purpose: i.purpose,
    postcode: i.postcode,
    budgetCents: i.budget ? Math.round(Number(i.budget.replace(/[^\d.]/g, "")) * 100) || null : null,
    timeframe: i.timeframe ?? null,
    needsInstallation: i.needsInstallation === "on",
    reasons: i.reasons ? i.reasons.split("\n").filter(Boolean) : [],
    contact: i.contact,
    notes: i.notes ?? null,
    createdAt: nowIso(),
  });
  return { ok: true, message: "Thanks — we have kept your details and will contact you if the range or service area changes." };
}

export interface SaveDesignResult {
  ok: boolean;
  error?: string;
  version?: number;
  verdict?: string | null;
}

/** FR-03: every saved edit is a new design version with its own engineering result. */
export async function saveDesign(orderId: string, design: unknown, note?: string): Promise<SaveDesignResult> {
  const order = await getOrderForViewer(orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (!isDesignEditable(order.status)) return { ok: false, error: `The design is locked while the order is ${order.status}. Contact us for a change order.` };
  const parsed = safeParseDesignSpec(design);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const current = await currentDesignVersion(order);
  const saved = await appendDesignVersion(order, parsed.data, current.measurement ?? null, "customer", note ?? null);
  revalidatePath(`/design/${orderId}`);
  revalidatePath(`/orders/${orderId}`);
  return { ok: true, version: saved.version, verdict: saved.verdict };
}

/** FR-02: measurement data is stored with its source and never promoted automatically. */
export async function saveMeasurement(orderId: string, measurement: unknown): Promise<SaveDesignResult> {
  const order = await getOrderForViewer(orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (!isDesignEditable(order.status)) return { ok: false, error: `The order is ${order.status}; measurements can no longer be changed here.` };
  const parsed = MeasurementSetSchema.safeParse(measurement);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const current = await currentDesignVersion(order);
  const saved = await appendDesignVersion(order, current.design, parsed.data as MeasurementSet, "customer", "Measurement updated");
  revalidatePath(`/design/${orderId}`);
  return { ok: true, version: saved.version, verdict: saved.verdict };
}

const ContactSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  phone: z.string().trim().min(6).max(30),
  referralSource: z.string().trim().max(100).optional(),
});

/** Moves a draft to the human review queue (PRD §4 "正式复核"). */
export async function submitForReview(orderId: string, contact: unknown): Promise<SaveDesignResult> {
  const order = await getOrderForViewer(orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status !== "draft" && order.status !== "needs_changes") return { ok: false, error: `Order is already ${order.status}.` };
  const parsedContact = ContactSchema.safeParse(contact);
  if (!parsedContact.success) return { ok: false, error: "Please provide your name, email and phone so we can send the formal quote." };
  const current = await currentDesignVersion(order);
  if (current.verdict === "UNSUPPORTED" || !current.engineering.cabinet) {
    return { ok: false, error: "The design still has blocking issues. Resolve every red item before submitting." };
  }
  await transition(order, "submitted", {
    customerName: parsedContact.data.name,
    customerEmail: parsedContact.data.email,
    customerPhone: parsedContact.data.phone,
    referralSource: parsedContact.data.referralSource || null,
  });
  revalidatePath(`/orders/${orderId}`);
  return { ok: true, version: current.version, verdict: current.verdict };
}

/** FR-07: the customer confirms one specific version; a full snapshot is stored, not a boolean. */
export async function confirmOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orderId = String(formData.get("orderId") ?? "");
  const order = await getOrderForViewer(orderId);
  if (!order) return { ok: false, error: "Order not found." };
  const current = await currentDesignVersion(order);
  const acks: Record<string, boolean> = {};
  for (const k of requiredAcknowledgements(current.engineering.cabinet?.antiTipRequired ?? false)) acks[k] = formData.get(`ack_${k}`) === "on";
  const res = await confirmCurrentVersion(order, String(formData.get("confirmedBy") ?? ""), acks);
  if (!res.ok) return { ok: false, error: res.error, reasons: res.missing };
  redirect(`/orders/${orderId}?confirmed=1`);
}

/**
 * Pilot payments are recorded manually (no gateway). The idempotency key makes a
 * double click or a retried request record the payment once (FR-07 acceptance).
 */
export async function recordCustomerPayment(orderId: string, kind: "intent_deposit" | "deposit" | "balance"): Promise<ActionState> {
  const order = await getOrderForViewer(orderId);
  if (!order) return { ok: false, error: "Order not found." };
  const quote = await activeOrAcceptedQuote(orderId);
  if (!quote) return { ok: false, error: "There is no quote to pay against." };
  if (kind === "intent_deposit") {
    if (quote.status !== "active" || order.status !== "quoted") return { ok: false, error: "Intent deposits are only taken on an active quote before confirmation." };
  } else if (quote.status !== "accepted" || order.status === "draft" || order.status === "submitted" || order.status === "quoted") {
    return { ok: false, error: "The 50% deposit and balance are taken after you confirm the quote." };
  }
  const existing = await getDb().then((db) => db.select().from(payments).where(eq(payments.orderId, orderId)));
  const paid = existing.filter((p) => p.kind === "deposit" || p.kind === "balance").reduce((a, p) => a + p.amountCents, 0);
  const amount = kind === "intent_deposit" ? Math.round(quote.totalCents * 0.1) : kind === "deposit" ? quote.depositCents : Math.max(0, quote.totalCents - paid);
  if (amount <= 0) return { ok: false, error: "Nothing left to pay." };
  const db = await getDb();
  await db
    .insert(payments)
    .values({
      id: newId("pay"),
      orderId,
      idempotencyKey: `${orderId}:${quote.id}:${kind}`,
      kind,
      amountCents: amount,
      method: "simulated_pilot",
      reference: null,
      note: kind === "intent_deposit" ? "Refundable intent deposit (pilot). Does not start production." : "Recorded from the customer order page (pilot — no live gateway).",
      recordedBy: "customer",
      createdAt: nowIso(),
    })
    .onConflictDoNothing();
  await recomputePaymentStatus(orderId);
  revalidatePath(`/orders/${orderId}`);
  return { ok: true, message: kind === "intent_deposit" ? "Intent deposit recorded." : `${kind === "deposit" ? "Deposit" : "Balance"} recorded.` };
}

const CaseSchema = z.object({
  orderId: z.string().min(1),
  partRef: z.string().trim().min(1).max(40),
  partKind: z.enum(["panel", "hardware_bag", "document", "other"]),
  severity: z.enum(["safety", "blocking", "cosmetic", "question"]),
  symptom: z.string().trim().min(5).max(2000),
  photoRefs: z.string().trim().max(2000).optional(),
});

/** FR-12: a case is opened against order + part id; the customer never re-explains the whole design. */
export async function openServiceCase(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const fields = Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string"));
  const parsed = CaseSchema.safeParse(fields);
  if (!parsed.success) return { ok: false, error: "Describe the problem (at least a few words) and pick the part." };
  const i = parsed.data;
  const order = await getOrderForViewer(i.orderId);
  if (!order) return { ok: false, error: "Order not found." };
  const files = formData.getAll("photos").filter(isUploadedFile);
  const uploaded = files.length ? await saveUploads(order.id, files, "customer") : { ok: true as const, refs: [] as string[] };
  if (!uploaded.ok) return uploaded;
  const textRefs = i.photoRefs ? i.photoRefs.split(/\s+/).filter(Boolean) : [];
  const db = await getDb();
  const release = await activeRelease(order.id);
  await db.insert(serviceCases).values({
    id: newId("case"),
    orderId: order.id,
    releaseKey: release?.releaseKey ?? null,
    partRef: i.partRef,
    partKind: i.partKind,
    severity: i.severity,
    symptom: i.symptom,
    photoRefs: [...uploaded.refs, ...textRefs],
    costCents: 0,
    status: "open",
    openedBy: "customer",
    createdAt: nowIso(),
  });
  if (order.status === "delivered" || order.status === "completed" || order.status === "shipped") {
    await transition(order, "aftersales");
  }
  if (i.severity === "safety") {
    await logEvent(order.id, release?.releaseKey ?? null, "block_opened", { reason: `Safety case: pause new production of template ${order.templateId} until the cause is found.` }, "customer");
  }
  revalidatePath(`/orders/${order.id}`);
  return { ok: true, message: "Case opened. We respond within one working day." };
}

export async function uploadOrderMedia(formData: FormData): Promise<ActionState> {
  const orderId = String(formData.get("orderId") ?? "");
  const order = await getOrderForViewer(orderId);
  if (!order) return { ok: false, error: "Order not found." };
  const files = formData.getAll("photos").filter(isUploadedFile);
  if (!files.length) return { ok: false, error: "Choose at least one photo." };
  const saved = await saveUploads(order.id, files, "customer");
  if (!saved.ok) return saved;
  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/design/${orderId}/measure`);
  return { ok: true, refs: saved.refs, message: `${saved.refs.length} photo(s) uploaded.` };
}

export async function updateContact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orderId = String(formData.get("orderId") ?? "");
  const order = await getOrderForViewer(orderId);
  if (!order) return { ok: false, error: "Order not found." };
  const parsed = ContactSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: "Name, valid email and phone are required." };
  await updateOrder(orderId, {
    customerName: parsed.data.name,
    customerEmail: parsed.data.email,
    customerPhone: parsed.data.phone,
    referralSource: parsed.data.referralSource || null,
  });
  revalidatePath(`/orders/${orderId}`);
  return { ok: true, message: "Contact details saved." };
}

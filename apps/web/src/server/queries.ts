import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  confirmations,
  costRecords,
  designVersions,
  enquiries,
  orders,
  payments,
  productionEvents,
  quotes,
  releases,
  reviews,
  serviceCases,
  type Confirmation,
  type CostRecord,
  type DesignVersion,
  type Order,
  type Payment,
  type ProductionEvent,
  type Quote,
  type Release,
  type Review,
  type ServiceCase,
} from "@/db/schema";
import { getClaimedOrders, getCustomerId, isAdmin, tokenMatches } from "@/lib/auth";

export async function getOrder(id: string): Promise<Order | null> {
  const db = await getDb();
  const rows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Customers see only their own orders (cookie identity) or an order opened via
 * its access token; staff see everything.
 */
export async function getOrderForViewer(id: string, token?: string): Promise<Order | null> {
  const order = await getOrder(id);
  if (!order) return null;
  if (await isAdmin()) return order;
  if (tokenMatches(order.accessToken, token)) return order;
  const customerId = await getCustomerId();
  if (customerId && order.customerId === customerId) return order;
  const claims = await getClaimedOrders();
  if (tokenMatches(order.accessToken, claims[order.id])) return order;
  return null;
}

export async function listOrdersForCustomer(): Promise<Order[]> {
  const customerId = await getCustomerId();
  if (!customerId) return [];
  const db = await getDb();
  return db.select().from(orders).where(eq(orders.customerId, customerId)).orderBy(desc(orders.updatedAt));
}

export async function listAllOrders(statuses?: Order["status"][]): Promise<Order[]> {
  const db = await getDb();
  const q = db.select().from(orders);
  if (statuses?.length) return q.where(inArray(orders.status, statuses)).orderBy(desc(orders.updatedAt));
  return q.orderBy(desc(orders.updatedAt));
}

export async function countOrdersByStatus(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.select({ status: orders.status, n: sql<number>`count(*)::int` }).from(orders).groupBy(orders.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export async function listDesignVersions(orderId: string): Promise<DesignVersion[]> {
  const db = await getDb();
  return db.select().from(designVersions).where(eq(designVersions.orderId, orderId)).orderBy(desc(designVersions.version));
}

export async function getDesignVersion(orderId: string, version: number): Promise<DesignVersion | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(designVersions)
    .where(and(eq(designVersions.orderId, orderId), eq(designVersions.version, version)))
    .limit(1);
  return rows[0] ?? null;
}

export async function currentDesignVersion(order: Order): Promise<DesignVersion> {
  const dv = await getDesignVersion(order.id, order.currentDesignVersion);
  if (!dv) throw new Error(`Order ${order.id} has no design version ${order.currentDesignVersion}`);
  return dv;
}

export async function listQuotes(orderId: string): Promise<Quote[]> {
  const db = await getDb();
  return db.select().from(quotes).where(eq(quotes.orderId, orderId)).orderBy(desc(quotes.issuedAt));
}

export async function activeOrAcceptedQuote(orderId: string): Promise<Quote | null> {
  const list = await listQuotes(orderId);
  return list.find((q) => q.status === "accepted") ?? list.find((q) => q.status === "active") ?? null;
}

export async function listReviews(orderId: string): Promise<Review[]> {
  const db = await getDb();
  return db.select().from(reviews).where(eq(reviews.orderId, orderId)).orderBy(desc(reviews.createdAt));
}

export async function getConfirmation(orderId: string): Promise<Confirmation | null> {
  const db = await getDb();
  const rows = await db.select().from(confirmations).where(eq(confirmations.orderId, orderId)).orderBy(desc(confirmations.confirmedAt)).limit(1);
  return rows[0] ?? null;
}

export async function listPayments(orderId: string): Promise<Payment[]> {
  const db = await getDb();
  return db.select().from(payments).where(eq(payments.orderId, orderId)).orderBy(desc(payments.createdAt));
}

export interface PaymentTotals {
  paid_cents: number;
  refunded_cents: number;
  intent_cents: number;
}

export function paymentTotals(list: Payment[]): PaymentTotals {
  let paid = 0;
  let refunded = 0;
  let intent = 0;
  for (const p of list) {
    if (p.kind === "refund") refunded += p.amountCents;
    else if (p.kind === "intent_deposit") intent += p.amountCents;
    else paid += p.amountCents;
  }
  return { paid_cents: paid, refunded_cents: refunded, intent_cents: intent };
}

export async function listReleases(orderId: string): Promise<Release[]> {
  const db = await getDb();
  return db.select().from(releases).where(eq(releases.orderId, orderId)).orderBy(desc(releases.sequence));
}

export async function activeRelease(orderId: string): Promise<Release | null> {
  const list = await listReleases(orderId);
  return list.find((r) => r.status === "active") ?? null;
}

export async function getRelease(releaseKey: string): Promise<Release | null> {
  const db = await getDb();
  const rows = await db.select().from(releases).where(eq(releases.releaseKey, releaseKey)).limit(1);
  return rows[0] ?? null;
}

export async function listEvents(orderId: string): Promise<ProductionEvent[]> {
  const db = await getDb();
  return db.select().from(productionEvents).where(eq(productionEvents.orderId, orderId)).orderBy(desc(productionEvents.createdAt));
}

export async function listServiceCases(orderId: string): Promise<ServiceCase[]> {
  const db = await getDb();
  return db.select().from(serviceCases).where(eq(serviceCases.orderId, orderId)).orderBy(desc(serviceCases.createdAt));
}

export async function listAllServiceCases(): Promise<ServiceCase[]> {
  const db = await getDb();
  return db.select().from(serviceCases).orderBy(desc(serviceCases.createdAt));
}

export async function listCosts(orderId: string): Promise<CostRecord[]> {
  const db = await getDb();
  return db.select().from(costRecords).where(eq(costRecords.orderId, orderId)).orderBy(desc(costRecords.createdAt));
}

export async function listEnquiries() {
  const db = await getDb();
  return db.select().from(enquiries).orderBy(desc(enquiries.createdAt));
}

/** Everything the order pages need, loaded once. */
export async function loadOrderBundle(order: Order) {
  const [versions, quoteList, reviewList, confirmation, paymentList, releaseList, events, cases, costs] = await Promise.all([
    listDesignVersions(order.id),
    listQuotes(order.id),
    listReviews(order.id),
    getConfirmation(order.id),
    listPayments(order.id),
    listReleases(order.id),
    listEvents(order.id),
    listServiceCases(order.id),
    listCosts(order.id),
  ]);
  const current = versions.find((v) => v.version === order.currentDesignVersion) ?? versions[0]!;
  return {
    order,
    versions,
    current,
    quotes: quoteList,
    quote: quoteList.find((q) => q.status === "accepted") ?? quoteList.find((q) => q.status === "active") ?? null,
    reviews: reviewList,
    confirmation,
    payments: paymentList,
    totals: paymentTotals(paymentList),
    releases: releaseList,
    release: releaseList.find((r) => r.status === "active") ?? null,
    events,
    cases,
    costs,
  };
}

export type OrderBundle = Awaited<ReturnType<typeof loadOrderBundle>>;

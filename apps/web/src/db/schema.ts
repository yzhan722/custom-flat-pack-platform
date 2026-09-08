import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type {
  AssemblyGuide,
  CompiledCabinet,
  DesignSpec,
  EngineeringStatus,
  EvaluationReport,
  HardwareBom,
  MeasurementSet,
  OrderStatus,
  PackagingPlan,
  PaymentStatus,
  PriceBreakdown,
  ProductionReleasePayload,
} from "@cfp/core";

/**
 * Persistence model (PRD §8). Large engineering artefacts are stored as JSONB
 * snapshots per design version so that quotes, confirmations and releases can
 * always be traced back to exactly what the customer saw.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

export const orders = pgTable("orders", {
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  accessToken: text("access_token").notNull(),
  status: text("status").$type<OrderStatus>().notNull(),
  engineeringStatus: text("engineering_status").$type<EngineeringStatus>().notNull(),
  paymentStatus: text("payment_status").$type<PaymentStatus>().notNull(),
  customerName: text("customer_name"),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  purpose: text("purpose").notNull(),
  postcode: text("postcode").notNull(),
  budgetCents: integer("budget_cents"),
  timeframe: text("timeframe"),
  needsInstallation: boolean("needs_installation").notNull().default(false),
  referralSource: text("referral_source"),
  templateId: text("template_id").notNull(),
  currentDesignVersion: integer("current_design_version").notNull().default(1),
  confirmedDesignVersion: integer("confirmed_design_version"),
  quotedDesignVersion: integer("quoted_design_version"),
  approvedDesignVersion: integer("approved_design_version"),
  factoryId: text("factory_id").notNull(),
  factoryVersion: integer("factory_version").notNull(),
  priceListId: text("price_list_id").notNull(),
  priceListVersion: integer("price_list_version").notNull(),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

/** Stored subset of EngineeringResult (template context is re-resolved from the catalog). */
export interface StoredEngineering {
  ok: boolean;
  schemaErrors: string[];
  cabinet: CompiledCabinet | null;
  bom: HardwareBom | null;
  packaging: PackagingPlan | null;
  assembly: AssemblyGuide | null;
  report: EvaluationReport | null;
  price: PriceBreakdown | null;
  engineeringHash: string | null;
  versions: {
    ruleSetVersion: string;
    factoryId: string;
    factoryVersion: number;
    priceListId: string;
    priceListVersion: number;
  } | null;
}

export const designVersions = pgTable(
  "design_versions",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    version: integer("version").notNull(),
    design: jsonb("design").$type<DesignSpec>().notNull(),
    measurement: jsonb("measurement").$type<MeasurementSet | null>(),
    engineering: jsonb("engineering").$type<StoredEngineering>().notNull(),
    engineeringHash: text("engineering_hash"),
    verdict: text("verdict"),
    createdBy: text("created_by").notNull(),
    note: text("note"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("design_versions_order_version").on(t.orderId, t.version)],
);

export const reviews = pgTable("reviews", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  designVersion: integer("design_version").notNull(),
  decision: text("decision").$type<"approved" | "needs_changes" | "blocked">().notNull(),
  notes: text("notes").notNull(),
  reviewer: text("reviewer").notNull(),
  ruleSetVersion: text("rule_set_version"),
  createdAt: ts("created_at").notNull(),
});

export const quotes = pgTable("quotes", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  designVersion: integer("design_version").notNull(),
  engineeringHash: text("engineering_hash").notNull(),
  price: jsonb("price").$type<PriceBreakdown>().notNull(),
  totalCents: integer("total_cents").notNull(),
  deliveryCents: integer("delivery_cents").notNull(),
  depositCents: integer("deposit_cents").notNull(),
  priceListId: text("price_list_id").notNull(),
  priceListVersion: integer("price_list_version").notNull(),
  factoryId: text("factory_id").notNull(),
  factoryVersion: integer("factory_version").notNull(),
  leadTimeDays: integer("lead_time_days").notNull(),
  notes: text("notes"),
  status: text("status").$type<"active" | "expired" | "superseded" | "accepted">().notNull(),
  issuedBy: text("issued_by").notNull(),
  issuedAt: ts("issued_at").notNull(),
  validUntil: ts("valid_until").notNull(),
  acceptedAt: ts("accepted_at"),
});

export interface ConfirmationSnapshot {
  design: DesignSpec;
  engineeringHash: string;
  price: PriceBreakdown;
  quoteId: string;
  leadTimeDays: number;
  warnings: string[];
  includes: string[];
  excludes: string[];
  visibleStructure: string[];
  loadStatement: { shelf_kg: number | null; top_kg: number | null };
}

export const confirmations = pgTable("confirmations", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  designVersion: integer("design_version").notNull(),
  quoteId: text("quote_id").notNull(),
  snapshot: jsonb("snapshot").$type<ConfirmationSnapshot>().notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  acknowledgements: jsonb("acknowledgements").$type<Record<string, boolean>>().notNull(),
  confirmedBy: text("confirmed_by").notNull(),
  confirmedAt: ts("confirmed_at").notNull(),
});

export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    kind: text("kind").$type<"intent_deposit" | "deposit" | "balance" | "refund">().notNull(),
    amountCents: integer("amount_cents").notNull(),
    method: text("method").notNull(),
    reference: text("reference"),
    note: text("note"),
    recordedBy: text("recorded_by").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("payments_idempotency").on(t.idempotencyKey)],
);

export const releases = pgTable("releases", {
  releaseKey: text("release_key").primaryKey(),
  orderId: text("order_id").notNull(),
  designVersion: integer("design_version").notNull(),
  sequence: integer("sequence").notNull(),
  payload: jsonb("payload").$type<ProductionReleasePayload>().notNull(),
  contentHash: text("content_hash").notNull(),
  status: text("status").$type<"active" | "superseded" | "stopped">().notNull(),
  releasedBy: text("released_by").notNull(),
  releasedAt: ts("released_at").notNull(),
  stoppedReason: text("stopped_reason"),
});

export type ProductionEventKind =
  | "materials_confirmed"
  | "capacity_confirmed"
  | "production_started"
  | "panel_inspected"
  | "package_packed"
  | "shipped"
  | "delivered"
  | "block_opened"
  | "block_closed"
  | "note";

export const productionEvents = pgTable("production_events", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  releaseKey: text("release_key"),
  kind: text("kind").$type<ProductionEventKind>().notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  actor: text("actor").notNull(),
  createdAt: ts("created_at").notNull(),
});

export const serviceCases = pgTable("service_cases", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  releaseKey: text("release_key"),
  partRef: text("part_ref").notNull(),
  partKind: text("part_kind").$type<"panel" | "hardware_bag" | "document" | "other">().notNull(),
  severity: text("severity").$type<"safety" | "blocking" | "cosmetic" | "question">().notNull(),
  symptom: text("symptom").notNull(),
  photoRefs: jsonb("photo_refs").$type<string[]>().notNull(),
  cause: text("cause"),
  responsibility: text("responsibility"),
  resolution: text("resolution"),
  costCents: integer("cost_cents").notNull().default(0),
  status: text("status").$type<"open" | "responded" | "resolved" | "closed">().notNull(),
  openedBy: text("opened_by").notNull(),
  createdAt: ts("created_at").notNull(),
  respondedAt: ts("responded_at"),
  resolvedAt: ts("resolved_at"),
});

export type CostCategory =
  | "board"
  | "hardware"
  | "machining"
  | "edge_banding"
  | "qc_pack_labour"
  | "packaging"
  | "overhead"
  | "delivery"
  | "payment_fees"
  | "presales_engineering"
  | "assembly_support"
  | "rework"
  | "acquisition_channel"
  | "other";

export const costRecords = pgTable("cost_records", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  category: text("category").$type<CostCategory>().notNull(),
  amountCents: integer("amount_cents").notNull(),
  minutes: integer("minutes"),
  note: text("note"),
  recordedBy: text("recorded_by").notNull(),
  createdAt: ts("created_at").notNull(),
});

export const serviceAreas = pgTable("service_areas", {
  postcode: text("postcode").primaryKey(),
  zone: text("zone").notNull(),
  label: text("label").notNull(),
});

export const enquiries = pgTable("enquiries", {
  id: text("id").primaryKey(),
  purpose: text("purpose").notNull(),
  postcode: text("postcode").notNull(),
  budgetCents: integer("budget_cents"),
  timeframe: text("timeframe"),
  needsInstallation: boolean("needs_installation").notNull().default(false),
  reasons: jsonb("reasons").$type<string[]>().notNull(),
  contact: text("contact"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull(),
});

export type Order = typeof orders.$inferSelect;
export type DesignVersion = typeof designVersions.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Quote = typeof quotes.$inferSelect;
export type Confirmation = typeof confirmations.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Release = typeof releases.$inferSelect;
export type ProductionEvent = typeof productionEvents.$inferSelect;
export type ServiceCase = typeof serviceCases.$inferSelect;
export type CostRecord = typeof costRecords.$inferSelect;
export type Enquiry = typeof enquiries.$inferSelect;

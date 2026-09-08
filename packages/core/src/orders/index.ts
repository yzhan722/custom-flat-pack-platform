/**
 * Order, payment and engineering states are independent (PRD §7.1). "Paid" never
 * implies "approved"; production release requires all gates at once.
 */

export type OrderStatus =
  | "draft"
  | "submitted"
  | "needs_changes"
  | "quoted"
  | "confirmed"
  | "released"
  | "in_production"
  | "qc_packing"
  | "shipped"
  | "delivered"
  | "completed"
  | "aftersales"
  | "cancelled";

export type PaymentStatus =
  | "unpaid"
  | "deposit_paid"
  | "partially_paid"
  | "settled"
  | "partially_refunded"
  | "refunded"
  | "disputed";

export type EngineeringStatus = "unchecked" | "review_required" | "approved" | "blocked" | "invalid";

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["needs_changes", "quoted", "cancelled"],
  needs_changes: ["draft", "submitted", "cancelled"],
  quoted: ["confirmed", "needs_changes", "submitted", "cancelled"],
  confirmed: ["released", "needs_changes", "cancelled"],
  released: ["in_production", "confirmed", "cancelled"],
  in_production: ["qc_packing", "aftersales"],
  qc_packing: ["shipped", "in_production"],
  shipped: ["delivered", "aftersales"],
  delivered: ["completed", "aftersales"],
  completed: ["aftersales"],
  aftersales: ["completed"],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new Error(`Illegal order transition ${from} -> ${to}`);
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, { en: string; zh: string }> = {
  draft: { en: "Design draft", zh: "设计草稿" },
  submitted: { en: "Submitted for review", zh: "已提交复核" },
  needs_changes: { en: "Changes requested", zh: "待补充或修改" },
  quoted: { en: "Formal quote issued", zh: "正式报价" },
  confirmed: { en: "Customer confirmed", zh: "客户已确认" },
  released: { en: "Released to production", zh: "生产已放行" },
  in_production: { en: "In production", zh: "生产中" },
  qc_packing: { en: "Quality check and packing", zh: "质检与齐套" },
  shipped: { en: "Shipped", zh: "已发货" },
  delivered: { en: "Delivered — awaiting assembly feedback", zh: "已交付待组装反馈" },
  completed: { en: "Completed", zh: "完成" },
  aftersales: { en: "After-sales", zh: "售后处理" },
  cancelled: { en: "Cancelled", zh: "已取消" },
};

/** Derives payment status from ledger totals. Amounts in cents. */
export function derivePaymentStatus(input: {
  total_cents: number;
  paid_cents: number;
  refunded_cents: number;
  depositRequired_cents: number;
  disputed: boolean;
}): PaymentStatus {
  if (input.disputed) return "disputed";
  const net = input.paid_cents - input.refunded_cents;
  if (input.refunded_cents > 0 && net <= 0) return "refunded";
  if (input.refunded_cents > 0 && net < input.total_cents) return "partially_refunded";
  if (net <= 0) return "unpaid";
  if (net >= input.total_cents) return "settled";
  if (net >= input.depositRequired_cents) return "deposit_paid";
  return "partially_paid";
}

export interface ReleaseGateInput {
  orderStatus: OrderStatus;
  engineeringStatus: EngineeringStatus;
  paymentStatus: PaymentStatus;
  confirmedDesignVersion: number | null;
  quotedDesignVersion: number | null;
  approvedDesignVersion: number | null;
  currentDesignVersion: number;
  quoteStatus: "active" | "expired" | "superseded" | "accepted" | null;
  materialsConfirmed: boolean;
  capacityConfirmed: boolean;
  hasLabels: boolean;
  hasPackagingPlan: boolean;
  hasAssemblyGuide: boolean;
  antiTipAcknowledgedIfRequired: boolean;
  openBlocks: string[];
}

export interface ReleaseGateResult {
  ok: boolean;
  reasons: string[];
}

/** PRD §7.1 production release conditions. */
export function evaluateReleaseGate(g: ReleaseGateInput): ReleaseGateResult {
  const reasons: string[] = [];
  if (g.orderStatus !== "confirmed") reasons.push(`Order is ${g.orderStatus}; must be confirmed by the customer.`);
  if (g.engineeringStatus !== "approved") reasons.push(`Engineering status is ${g.engineeringStatus}; must be approved.`);
  if (g.paymentStatus !== "settled") reasons.push(`Payment status is ${g.paymentStatus}; balance must be settled before release.`);
  if (g.confirmedDesignVersion === null) reasons.push("No customer-confirmed design version.");
  if (g.quotedDesignVersion === null) reasons.push("No quoted design version.");
  if (g.approvedDesignVersion === null) reasons.push("No engineering-approved design version.");
  const versions = [g.confirmedDesignVersion, g.quotedDesignVersion, g.approvedDesignVersion, g.currentDesignVersion];
  if (versions.every((v) => v !== null) && new Set(versions).size !== 1) {
    reasons.push(`Design versions differ (confirmed v${g.confirmedDesignVersion}, quoted v${g.quotedDesignVersion}, approved v${g.approvedDesignVersion}, current v${g.currentDesignVersion}).`);
  }
  if (g.quoteStatus !== "accepted") reasons.push(`Quote status is ${g.quoteStatus ?? "none"}; it must be accepted and unexpired.`);
  if (!g.materialsConfirmed) reasons.push("Material and hardware availability not confirmed.");
  if (!g.capacityConfirmed) reasons.push("Factory capacity not confirmed.");
  if (!g.hasLabels) reasons.push("Labels not generated.");
  if (!g.hasPackagingPlan) reasons.push("Packaging plan missing.");
  if (!g.hasAssemblyGuide) reasons.push("Assembly guide missing.");
  if (!g.antiTipAcknowledgedIfRequired) reasons.push("Customer has not acknowledged the wall restraint requirement.");
  for (const b of g.openBlocks) reasons.push(`Open block: ${b}`);
  return { ok: reasons.length === 0, reasons };
}

export interface QuoteRecord {
  id: string;
  orderId: string;
  designVersion: number;
  engineeringHash: string;
  priceListId: string;
  priceListVersion: number;
  factoryId: string;
  factoryVersion: number;
  total_cents: number;
  delivery_cents: number;
  issuedAt: string;
  validUntil: string;
  status: "active" | "expired" | "superseded" | "accepted";
}

export function quoteValidity(
  quote: Pick<QuoteRecord, "validUntil" | "status" | "designVersion" | "engineeringHash">,
  now: Date,
  currentDesignVersion: number,
  currentEngineeringHash: string | null,
): { valid: boolean; reason?: string } {
  if (quote.status === "superseded") return { valid: false, reason: "Quote superseded by a newer version." };
  if (quote.status === "expired" || new Date(quote.validUntil).getTime() < now.getTime()) return { valid: false, reason: "Quote expired." };
  if (quote.designVersion !== currentDesignVersion) return { valid: false, reason: `Quote is for design v${quote.designVersion}, current is v${currentDesignVersion}.` };
  if (currentEngineeringHash && quote.engineeringHash !== currentEngineeringHash) return { valid: false, reason: "Engineering data changed since the quote was issued." };
  return { valid: true };
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

import { ORDER_STATUS_LABELS, type EngineeringStatus, type OrderStatus, type PaymentStatus, type Severity } from "@cfp/core";
import { cn, titleCase } from "@/lib/format";

const ORDER_TONE: Record<OrderStatus, string> = {
  draft: "border-stone-300 bg-stone-100 text-stone-700",
  submitted: "border-sky-200 bg-sky-50 text-sky-800",
  needs_changes: "border-amber-200 bg-amber-50 text-amber-800",
  quoted: "border-indigo-200 bg-indigo-50 text-indigo-800",
  confirmed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  released: "border-emerald-300 bg-emerald-100 text-emerald-900",
  in_production: "border-teal-200 bg-teal-50 text-teal-800",
  qc_packing: "border-teal-300 bg-teal-100 text-teal-900",
  shipped: "border-blue-200 bg-blue-50 text-blue-800",
  delivered: "border-blue-300 bg-blue-100 text-blue-900",
  completed: "border-stone-300 bg-stone-800 text-white",
  aftersales: "border-rose-200 bg-rose-50 text-rose-800",
  cancelled: "border-stone-300 bg-stone-200 text-stone-600",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <span className={cn("badge", ORDER_TONE[status])}>{ORDER_STATUS_LABELS[status].en}</span>;
}

const ENG_TONE: Record<EngineeringStatus, string> = {
  unchecked: "border-stone-300 bg-stone-100 text-stone-700",
  review_required: "border-amber-200 bg-amber-50 text-amber-800",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  blocked: "border-red-200 bg-red-50 text-red-800",
  invalid: "border-stone-300 bg-stone-200 text-stone-600",
};

export function EngineeringBadge({ status }: { status: EngineeringStatus }) {
  return <span className={cn("badge", ENG_TONE[status])}>Engineering: {titleCase(status)}</span>;
}

const PAY_TONE: Record<PaymentStatus, string> = {
  unpaid: "border-stone-300 bg-stone-100 text-stone-700",
  deposit_paid: "border-indigo-200 bg-indigo-50 text-indigo-800",
  partially_paid: "border-amber-200 bg-amber-50 text-amber-800",
  settled: "border-emerald-200 bg-emerald-50 text-emerald-800",
  partially_refunded: "border-rose-200 bg-rose-50 text-rose-800",
  refunded: "border-rose-300 bg-rose-100 text-rose-900",
  disputed: "border-red-300 bg-red-100 text-red-900",
};

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return <span className={cn("badge", PAY_TONE[status])}>Payment: {titleCase(status)}</span>;
}

const SEVERITY_TONE: Record<Severity, string> = {
  PASS: "border-emerald-200 bg-emerald-50 text-emerald-800",
  REVIEW_REQUIRED: "border-amber-200 bg-amber-50 text-amber-800",
  UNSUPPORTED: "border-red-200 bg-red-50 text-red-800",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const label = severity === "PASS" ? "Pass" : severity === "REVIEW_REQUIRED" ? "Review required" : "Not supported";
  return <span className={cn("badge", SEVERITY_TONE[severity])}>{label}</span>;
}

export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "info" }) {
  const map = {
    neutral: "border-stone-300 bg-stone-100 text-stone-700",
    good: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warn: "border-amber-200 bg-amber-50 text-amber-800",
    bad: "border-red-200 bg-red-50 text-red-800",
    info: "border-sky-200 bg-sky-50 text-sky-800",
  } as const;
  return <span className={cn("badge", map[tone])}>{children}</span>;
}

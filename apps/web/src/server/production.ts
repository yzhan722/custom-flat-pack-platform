import { evaluateReleaseGate, type ReleaseGateResult } from "@cfp/core";
import type { OrderBundle } from "./queries";

/** Blocks opened on the shop floor that have not been closed yet. */
export function openBlocks(bundle: OrderBundle): Array<{ id: string; reason: string }> {
  const closed = new Set(bundle.events.filter((e) => e.kind === "block_closed").map((e) => String(e.payload.blockId)));
  return bundle.events
    .filter((e) => e.kind === "block_opened" && !closed.has(e.id))
    .map((e) => ({ id: e.id, reason: String(e.payload.reason ?? "") }));
}

function confirmedForCurrentVersion(bundle: OrderBundle, kind: "materials_confirmed" | "capacity_confirmed"): boolean {
  return bundle.events.some((e) => e.kind === kind && Number(e.payload.designVersion) === bundle.order.currentDesignVersion);
}

/** PRD §7.1 release conditions evaluated against the stored order state. */
export function releaseGateFor(bundle: OrderBundle): ReleaseGateResult {
  const { order, current, quote, confirmation } = bundle;
  const eng = current.engineering;
  const blocks = openBlocks(bundle).map((b) => b.reason);
  if (confirmation && confirmation.snapshot.engineeringHash !== current.engineeringHash) {
    blocks.push("Customer confirmation snapshot does not match the current engineering data.");
  }
  return evaluateReleaseGate({
    orderStatus: order.status,
    engineeringStatus: order.engineeringStatus,
    paymentStatus: order.paymentStatus,
    confirmedDesignVersion: order.confirmedDesignVersion,
    quotedDesignVersion: order.quotedDesignVersion,
    approvedDesignVersion: order.approvedDesignVersion,
    currentDesignVersion: order.currentDesignVersion,
    quoteStatus: quote?.status ?? null,
    materialsConfirmed: confirmedForCurrentVersion(bundle, "materials_confirmed"),
    capacityConfirmed: confirmedForCurrentVersion(bundle, "capacity_confirmed"),
    hasLabels: !!eng.cabinet,
    hasPackagingPlan: !!eng.packaging,
    hasAssemblyGuide: !!eng.assembly,
    antiTipAcknowledgedIfRequired: !(eng.cabinet?.antiTipRequired ?? false) || current.design.installation.antiTipAcknowledged,
    openBlocks: blocks,
  });
}

export interface InspectionState {
  latest: Map<string, { pass: boolean; notes: string; at: string }>;
  packed: Map<string, { weight_kg: number; at: string }>;
}

export function inspectionState(bundle: OrderBundle): InspectionState {
  const key = bundle.release?.releaseKey;
  const latest = new Map<string, { pass: boolean; notes: string; at: string }>();
  const packed = new Map<string, { weight_kg: number; at: string }>();
  if (!key) return { latest, packed };
  for (const e of [...bundle.events].reverse()) {
    if (e.releaseKey !== key) continue;
    if (e.kind === "panel_inspected") latest.set(String(e.payload.panelId), { pass: e.payload.pass === true, notes: String(e.payload.notes ?? ""), at: e.createdAt });
    if (e.kind === "package_packed" && e.payload.verified === true) packed.set(String(e.payload.code), { weight_kg: Number(e.payload.weight_kg), at: e.createdAt });
  }
  return { latest, packed };
}

/** FR-10: everything that must be true before dispatch. */
export function shipmentBlockers(bundle: OrderBundle): string[] {
  const rel = bundle.release?.payload;
  if (!rel) return ["No active release."];
  const problems: string[] = [];
  const { latest, packed } = inspectionState(bundle);
  for (const p of rel.panels) {
    const r = latest.get(p.id);
    if (r === undefined) problems.push(`Panel ${p.label} (${p.id}) not inspected.`);
    else if (!r.pass) problems.push(`Panel ${p.label} (${p.id}) failed inspection.`);
  }
  for (const pkg of rel.packaging.packages) {
    if (!packed.has(pkg.code)) problems.push(`Package ${pkg.code} (${pkg.title}) not packed and verified.`);
  }
  if (bundle.order.paymentStatus !== "settled") problems.push(`Payment status is ${bundle.order.paymentStatus}.`);
  for (const b of openBlocks(bundle)) problems.push(`Open block: ${b.reason}`);
  return problems;
}

/** FR-13: contribution from recorded actuals. Unattributed categories are reported, not assumed zero. */
export function contribution(bundle: OrderBundle) {
  const revenueInc = bundle.quote?.status === "accepted" ? bundle.quote.totalCents : 0;
  const gstRate = bundle.quote?.price.lines.find((l) => l.code === "GST") ? 0.1 : 0;
  const revenueEx = Math.round(revenueInc / (1 + gstRate));
  const by = new Map<string, number>();
  for (const c of bundle.costs) by.set(c.category, (by.get(c.category) ?? 0) + c.amountCents);
  const sum = (...cats: string[]) => cats.reduce((a, c) => a + (by.get(c) ?? 0), 0);
  const manufacturing = sum("board", "hardware", "machining", "edge_banding", "qc_pack_labour", "packaging", "overhead");
  const fulfilment = sum("delivery", "payment_fees", "presales_engineering", "assembly_support", "rework");
  const acquisition = sum("acquisition_channel");
  const other = sum("other");
  const serviceCosts = bundle.cases.reduce((a, c) => a + c.costCents, 0);
  const grossMargin = revenueEx - manufacturing;
  const cm1 = grossMargin - fulfilment - serviceCosts;
  const cm2 = cm1 - acquisition - other;
  const recorded = new Set(by.keys());
  const expected = ["board", "hardware", "machining", "edge_banding", "qc_pack_labour", "packaging", "delivery", "payment_fees", "presales_engineering", "assembly_support", "acquisition_channel"];
  return {
    revenueInc,
    revenueEx,
    manufacturing,
    fulfilment,
    serviceCosts,
    acquisition,
    other,
    grossMargin,
    cm1,
    cm2,
    cm2Rate: revenueEx ? cm2 / revenueEx : null,
    missingCategories: expected.filter((c) => !recorded.has(c)),
  };
}

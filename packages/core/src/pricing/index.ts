import type { DeliveryZone, PriceList } from "../catalog";
import type { HardwareBom } from "../hardware";
import type { PackagingPlan } from "../packaging";
import type { CompiledCabinet } from "../panels";

/**
 * Pricing (PRD FR-06, §15). All amounts are integer cents in AUD. The estimate
 * shown during configuration and the formal quote use the same function; the
 * quote additionally binds versions and a validity window.
 */

export type PriceLineGroup = "manufacturing" | "fulfilment" | "service" | "margin" | "tax";

export interface PriceLine {
  code: string;
  label: string;
  group: PriceLineGroup;
  amount_cents: number;
  detail?: string;
}

export interface PriceBreakdown {
  priceListId: string;
  priceListVersion: number;
  currency: "AUD";
  lines: PriceLine[];
  manufacturingSubtotal_cents: number;
  subtotalExGst_cents: number;
  gst_cents: number;
  totalIncGst_cents: number;
  /** Delivery shown separately (PRD §2.3) but included in the total. */
  delivery_cents: number;
  includes: string[];
  excludes: string[];
}

export interface PricingInput {
  cabinet: CompiledCabinet;
  bom: HardwareBom;
  packaging: PackagingPlan;
  priceList: PriceList;
  deliveryMethod: "local_delivery" | "pickup";
  deliveryZone: DeliveryZone | null;
}

export function priceCabinet(input: PricingInput): PriceBreakdown {
  const { cabinet, bom, packaging, priceList: pl } = input;
  const lines: PriceLine[] = [];
  const push = (line: PriceLine) => lines.push({ ...line, amount_cents: Math.round(line.amount_cents) });

  for (const [materialId, area] of Object.entries(cabinet.totals.areaByMaterial_m2)) {
    const spec = pl.material[materialId] ?? pl.backPanel[materialId];
    if (!spec) throw new Error(`Price list ${pl.id} v${pl.version} has no price for material ${materialId}`);
    const grossArea = area * (1 + spec.wasteFactor);
    push({
      code: `MAT:${materialId}`,
      label: `Board ${materialId}`,
      group: "manufacturing",
      amount_cents: grossArea * spec.perM2_cents,
      detail: `${area.toFixed(3)} m² net, ${(spec.wasteFactor * 100).toFixed(0)}% nesting allowance`,
    });
  }

  push({
    code: "EDGE",
    label: "Edge banding",
    group: "manufacturing",
    amount_cents: cabinet.totals.edgeBandLength_m * (pl.edgeBand.perM_cents + pl.edgeBand.applicationPerM_cents),
    detail: `${cabinet.totals.edgeBandLength_m.toFixed(2)} m`,
  });

  push({
    code: "CNC",
    label: "Cutting, drilling and pockets",
    group: "manufacturing",
    amount_cents:
      pl.machining.perOrderSetup_cents +
      cabinet.totals.panelCount * pl.machining.perPanel_cents +
      cabinet.totals.drillCount * pl.machining.perDrill_cents +
      cabinet.totals.pocketCount * pl.machining.perPocket_cents,
    detail: `${cabinet.totals.panelCount} panels, ${cabinet.totals.drillCount} holes, ${cabinet.totals.pocketCount} pockets`,
  });

  let hardware = 0;
  for (const line of bom.lines) {
    const unit = pl.hardware[line.sku];
    if (unit === undefined) throw new Error(`Price list ${pl.id} v${pl.version} has no price for hardware ${line.sku}`);
    hardware += unit * line.qty;
  }
  push({ code: "HW", label: "Hardware", group: "manufacturing", amount_cents: hardware, detail: `${bom.lines.length} SKUs` });

  push({
    code: "LAB",
    label: "Quality check, sorting and packing",
    group: "manufacturing",
    amount_cents: pl.labour.qcSortPackPerOrder_cents + cabinet.totals.panelCount * pl.labour.perPanel_cents,
  });
  push({
    code: "PKG",
    label: "Packaging materials",
    group: "manufacturing",
    amount_cents: packaging.packages.length * pl.packaging.perPackage_cents,
    detail: `${packaging.packages.length} packages`,
  });

  const manufacturingBase = sum(lines);
  push({
    code: "OVH",
    label: "Factory overhead",
    group: "manufacturing",
    amount_cents: manufacturingBase * pl.overheadRate,
    detail: `${(pl.overheadRate * 100).toFixed(0)}% of manufacturing`,
  });
  const manufacturingSubtotal = sum(lines);

  push({ code: "ENG", label: "Engineering review", group: "service", amount_cents: pl.labour.engineeringReviewPerOrder_cents });

  let delivery = 0;
  if (input.deliveryMethod === "pickup") {
    delivery = pl.delivery.pickup_cents;
    push({ code: "DEL", label: "Pickup from factory", group: "fulfilment", amount_cents: delivery });
  } else if (input.deliveryZone) {
    delivery = input.deliveryZone.price_cents;
    push({ code: "DEL", label: `Local delivery (${input.deliveryZone.label})`, group: "fulfilment", amount_cents: delivery });
  } else {
    push({ code: "DEL", label: "Delivery (zone not confirmed)", group: "fulfilment", amount_cents: 0, detail: "Postcode outside priced zones" });
  }

  const costBase = sum(lines);
  push({
    code: "RISK",
    label: "After-sales reserve",
    group: "margin",
    amount_cents: costBase * pl.riskReserveRate,
    detail: `${(pl.riskReserveRate * 100).toFixed(0)}%`,
  });
  push({
    code: "MARGIN",
    label: "Platform service",
    group: "margin",
    amount_cents: (costBase + costBase * pl.riskReserveRate) * pl.platformMarginRate,
    detail: `${(pl.platformMarginRate * 100).toFixed(0)}%`,
  });

  const subtotal = sum(lines);
  const gst = Math.round(subtotal * pl.gstRate);
  push({ code: "GST", label: "GST", group: "tax", amount_cents: gst, detail: `${(pl.gstRate * 100).toFixed(0)}%` });

  return {
    priceListId: pl.id,
    priceListVersion: pl.version,
    currency: pl.currency,
    lines,
    manufacturingSubtotal_cents: Math.round(manufacturingSubtotal),
    subtotalExGst_cents: Math.round(subtotal),
    gst_cents: gst,
    totalIncGst_cents: Math.round(subtotal) + gst,
    delivery_cents: delivery,
    includes: [
      "All panels cut, edge banded, drilled and labelled",
      "Hardware in numbered bags",
      "Order-specific assembly guide",
      "Engineering review",
      input.deliveryMethod === "pickup" ? "Pickup from factory" : "Local delivery to the door",
    ],
    excludes: ["Professional installation", "Wall fixings (depend on wall type)", "Removal of old furniture"],
  };
}

function sum(lines: PriceLine[]): number {
  return lines.reduce((acc, l) => acc + l.amount_cents, 0);
}

export function formatAud(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}A$${(abs / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

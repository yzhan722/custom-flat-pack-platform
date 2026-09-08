import { eq } from "drizzle-orm";
import { Catalog, type DeliveryZone, type FactoryCapability, type PriceList } from "@cfp/core";
import { getDb } from "@/db/client";
import { serviceAreas } from "@/db/schema";

/**
 * Catalog access for the web layer. The catalog itself is versioned code in
 * @cfp/core; the pilot uses one factory and one price list (PRD FR-09).
 */
export const catalog = Catalog.development();

export const PILOT_FACTORY_ID = "FAC-PILOT-01";
export const PILOT_PRICE_LIST_ID = "PL-PILOT";
export const FACTORY_ADAPTER = "manual-csv-v0";
export const DEFAULT_LEAD_TIME_DAYS = 21;
export const DEPOSIT_RATE = 0.5;

export function pilotFactory(): FactoryCapability {
  return catalog.getFactory(PILOT_FACTORY_ID);
}

export function pilotPriceList(): PriceList {
  return catalog.getPriceList(PILOT_PRICE_LIST_ID);
}

export async function lookupServiceArea(postcode: string): Promise<{ zone: DeliveryZone; label: string } | null> {
  const clean = postcode.trim();
  if (!clean) return null;
  const db = await getDb();
  const rows = await db.select().from(serviceAreas).where(eq(serviceAreas.postcode, clean)).limit(1);
  const row = rows[0];
  if (!row) return null;
  const zone = pilotPriceList().delivery.zones.find((z) => z.zone === row.zone);
  if (!zone) return null;
  return { zone, label: row.label };
}

/** Builds the synchronous zone resolver the engineering kernel expects, from a DB lookup done up front. */
export async function zoneResolverFor(postcode: string): Promise<(p: string) => DeliveryZone | null> {
  const found = await lookupServiceArea(postcode);
  return (p: string) => (p.trim() === postcode.trim() ? (found?.zone ?? null) : null);
}

import type { HardwareSystem } from "../catalog";
import { aggregateHardware, type CompiledCabinet } from "../panels";

export interface HardwareBomLine {
  sku: string;
  version: number;
  name: string;
  category: string;
  bagCode: string;
  unit: "pc" | "set";
  qty: number;
  status: "provisional" | "registered";
  /** Joint ids that consume this item, for part lookup during assembly. */
  usedIn: string[];
}

export interface HardwareBom {
  hardwareSystemId: string;
  hardwareSystemVersion: number;
  lines: HardwareBomLine[];
  bags: Array<{ bagCode: string; skus: string[] }>;
}

/**
 * Builds the hardware bill of materials from compiled joints (PRD §8
 * HardwareBOM: exact SKU, version, quantity, where used). Substitutes are never
 * matched by name; the SKU must exist in the hardware system.
 */
export function buildHardwareBom(cabinet: CompiledCabinet, hw: HardwareSystem): HardwareBom {
  const totals = aggregateHardware(cabinet.joints);
  const lines: HardwareBomLine[] = totals.map(({ sku, qty }) => {
    const item = hw.items[sku];
    if (!item) throw new Error(`Hardware SKU ${sku} is not part of system ${hw.id} v${hw.version}`);
    const usedIn = cabinet.joints.filter((j) => j.hardware.some((h) => h.sku === sku)).map((j) => j.id);
    return {
      sku,
      version: item.version,
      name: item.name,
      category: item.category,
      bagCode: item.bagCode,
      unit: item.unit,
      qty,
      status: item.status,
      usedIn,
    };
  });
  const bagMap = new Map<string, string[]>();
  for (const line of lines) {
    const list = bagMap.get(line.bagCode) ?? [];
    list.push(line.sku);
    bagMap.set(line.bagCode, list);
  }
  const bags = [...bagMap.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([bagCode, skus]) => ({ bagCode, skus }));
  return { hardwareSystemId: hw.id, hardwareSystemVersion: hw.version, lines, bags };
}

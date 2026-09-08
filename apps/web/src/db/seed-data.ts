/**
 * Development service area. The pilot factory location is not yet known (PRD
 * §19), so these postcodes are a demonstration set only: zone A is a notional
 * inner ring, zone B an outer ring. Replace with operations-confirmed postcodes
 * before any public launch.
 */
export const DEMO_SERVICE_AREAS: Array<{ postcode: string; zone: string; label: string }> = [
  ...range(3000, 3099).map((p) => ({ postcode: String(p), zone: "A", label: "Local zone A (demo)" })),
  ...range(3100, 3207).map((p) => ({ postcode: String(p), zone: "B", label: "Local zone B (demo)" })),
];

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

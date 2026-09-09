/** Shared demo-pipeline constants. Keep out of `"use server"` files so pages can import them. */

export const DEMO_CUSTOMER_ID = "cus_demo";
export const DEMO_ENQUIRY_NOTE = "DEMO SEED — kept as demand evidence, not an order.";

export function demoToolsEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_DEMO_SEED === "true";
}

export const DEMO_STAGE_ORDER = [
  "demo:draft",
  "demo:submitted",
  "demo:quoted",
  "demo:confirmed",
  "demo:qc",
  "demo:delivered",
  "demo:aftersales",
] as const;

export type DemoStageKey = (typeof DEMO_STAGE_ORDER)[number];

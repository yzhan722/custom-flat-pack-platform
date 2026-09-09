import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Pilot-grade access control (PRD §11): staff sign in with a shared password
 * and receive a signed cookie; customers are identified by an anonymous cookie
 * created when they start a design, and may additionally open an order through
 * its unguessable access token (links, QR codes).
 */

const ADMIN_COOKIE = "cfp_admin";
const CUSTOMER_COOKIE = "cfp_customer";

function secret(): string {
  return process.env.AUTH_SECRET?.trim() || "dev-only-secret-change-me";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function adminPasswordConfigured(): string {
  return process.env.ADMIN_PASSWORD?.trim() || "admin";
}

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  const value = jar.get(ADMIN_COOKIE)?.value;
  if (!value) return false;
  return safeEqual(value, sign("admin"));
}

export async function requireAdmin(): Promise<string> {
  if (!(await isAdmin())) throw new Error("Staff sign-in required.");
  return "staff";
}

export async function signInAdmin(password: string): Promise<boolean> {
  if (!safeEqual(password, adminPasswordConfigured())) return false;
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, sign("admin"), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
  return true;
}

export async function signOutAdmin(): Promise<void> {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
}

export async function getCustomerId(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(CUSTOMER_COOKIE)?.value;
  if (!raw) return null;
  const [id, sig] = raw.split(".");
  if (!id || !sig || !safeEqual(sig, sign(id))) return null;
  return id;
}

export async function setCustomerId(id: string): Promise<void> {
  const jar = await cookies();
  jar.set(CUSTOMER_COOKIE, `${id}.${sign(id)}`, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

/** Only callable from server actions / route handlers (cookies are writable there). */
export async function ensureCustomerId(): Promise<string> {
  const existing = await getCustomerId();
  if (existing) return existing;
  const id = `cus_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await setCustomerId(id);
  return id;
}

export function newAccessToken(): string {
  return randomUUID().replace(/-/g, "");
}

export function tokenMatches(expected: string, provided: string | undefined): boolean {
  return !!provided && safeEqual(expected, provided);
}

const CLAIMS_COOKIE = "cfp_orders";

/**
 * Orders opened through their access link are "claimed" into a signed cookie so
 * that subsequent server actions (save, pay, submit) work without repeating the
 * token in every request. Values are order id -> access token.
 */
export async function getClaimedOrders(): Promise<Record<string, string>> {
  const jar = await cookies();
  const raw = jar.get(CLAIMS_COOKIE)?.value;
  if (!raw) return {};
  const [payload, sig] = raw.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return {};
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, string>;
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

/** Only callable from server actions / route handlers. Keeps at most 20 claims. */
export async function rememberClaim(orderId: string, token: string): Promise<void> {
  const current = await getClaimedOrders();
  const entries = Object.entries({ ...current, [orderId]: token }).slice(-20);
  const payload = Buffer.from(JSON.stringify(Object.fromEntries(entries)), "utf8").toString("base64url");
  const jar = await cookies();
  jar.set(CLAIMS_COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

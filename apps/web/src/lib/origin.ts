import { headers } from "next/headers";

export async function appOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/** Public assembly URL encoded in a QR. Contains the release key and part id only. */
export function guideUrl(origin: string, releaseKey: string, part?: string): string {
  const path = `/guide/${releaseKey}${part ? `?part=${encodeURIComponent(part)}` : ""}`;
  return origin ? `${origin}${path}` : path;
}

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { newId } from "@cfp/core";
import { getDb } from "@/db/client";
import { media } from "@/db/schema";
import { nowIso } from "@/lib/format";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 8;
const ID_RE = /^med_[a-z0-9]+$/i;
const UPLOADS_DIR = path.join(process.cwd(), ".data", "uploads");

function mediaPath(id: string): string {
  mkdirSync(UPLOADS_DIR, { recursive: true });
  return path.join(UPLOADS_DIR, id);
}

function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  return null;
}

export function isUploadedFile(value: FormDataEntryValue): value is File {
  return typeof File !== "undefined" && value instanceof File && value.size > 0;
}

export async function saveUploads(
  orderId: string,
  files: File[],
  createdBy: string,
): Promise<{ ok: true; refs: string[] } | { ok: false; error: string }> {
  if (files.length > MAX_FILES) return { ok: false, error: "Too many photos (maximum 8)." };
  mkdirSync(UPLOADS_DIR, { recursive: true });
  const db = await getDb();
  const refs: string[] = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) return { ok: false, error: `${file.name} is larger than 8 MB.` };
    const buf = new Uint8Array(await file.arrayBuffer());
    const mime = sniffMime(buf);
    if (!mime) return { ok: false, error: `${file.name} is not a JPEG, PNG, WebP or GIF.` };
    const id = newId("med");
    writeFileSync(mediaPath(id), buf);
    await db.insert(media).values({
      id,
      orderId,
      kind: "photo",
      originalName: file.name.slice(0, 200) || "photo",
      mime,
      sizeBytes: buf.length,
      sha256: createHash("sha256").update(buf).digest("hex"),
      createdBy,
      createdAt: nowIso(),
    });
    refs.push(`/api/media/${id}`);
  }
  return { ok: true, refs };
}

export async function getMediaRecord(id: string) {
  if (!ID_RE.test(id)) return null;
  const db = await getDb();
  const rows = await db.select().from(media).where(eq(media.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function readMediaFile(id: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const rec = await getMediaRecord(id);
  if (!rec) return null;
  try {
    const bytes = new Uint8Array(readFileSync(mediaPath(rec.id)));
    return { mime: rec.mime, bytes };
  } catch {
    return null;
  }
}

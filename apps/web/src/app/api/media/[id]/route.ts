import { NextResponse } from "next/server";
import { getOrderForViewer } from "@/server/queries";
import { getMediaRecord, readMediaFile } from "@/server/media";

export const dynamic = "force-dynamic";

/** Serves an uploaded photo. Requires the viewer to be able to open the order (or staff). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rec = await getMediaRecord(id);
  if (!rec) return new NextResponse("Not found", { status: 404 });
  const order = await getOrderForViewer(rec.orderId);
  if (!order) return new NextResponse("Unauthorized", { status: 401 });
  const file = await readMediaFile(id);
  if (!file) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(Buffer.from(file.bytes), {
    headers: {
      "content-type": file.mime,
      "cache-control": "private, max-age=3600",
      "content-disposition": `inline; filename="${rec.originalName.replace(/"/g, "")}"`,
    },
  });
}

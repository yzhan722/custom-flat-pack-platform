import { operationsCsv } from "@cfp/core";
import { isAdmin } from "@/lib/auth";
import { getRelease } from "@/server/queries";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; key: string }> }) {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  const { id, key } = await ctx.params;
  const release = await getRelease(key);
  if (!release || release.orderId !== id) return new Response("Not found", { status: 404 });
  return new Response(operationsCsv(release.payload), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${key}-operations.csv"`,
    },
  });
}

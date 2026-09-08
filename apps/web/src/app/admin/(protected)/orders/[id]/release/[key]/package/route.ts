import { isAdmin } from "@/lib/auth";
import { getRelease } from "@/server/queries";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; key: string }> }) {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  const { id, key } = await ctx.params;
  const release = await getRelease(key);
  if (!release || release.orderId !== id) return new Response("Not found", { status: 404 });
  const body = JSON.stringify(
    {
      releaseKey: release.releaseKey,
      contentHash: release.contentHash,
      status: release.status,
      releasedAt: release.releasedAt,
      factoryAdapter: release.payload.versions.factoryAdapter,
      payload: release.payload,
    },
    null,
    2,
  );
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${key}.json"`,
    },
  });
}

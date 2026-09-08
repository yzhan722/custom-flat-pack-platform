import Link from "next/link";
import { notFound } from "next/navigation";
import { AssemblyGuideView } from "@/components/AssemblyGuideView";
import { ClaimAccess } from "@/components/ClaimAccess";
import { PrintButton } from "@/components/PrintButton";
import { Page } from "@/components/SiteChrome";
import { getOrderForViewer, loadOrderBundle } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function AssemblyPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ t?: string; part?: string }> }) {
  const { orderId } = await params;
  const { t, part } = await searchParams;
  const order = await getOrderForViewer(orderId, t);
  if (!order) notFound();
  const b = await loadOrderBundle(order);
  const rel = b.release?.payload;
  const guide = rel?.assembly ?? b.current.engineering.assembly;
  const bom = rel?.hardware ?? b.current.engineering.bom;
  const cabinet = rel ? { ...b.current.engineering.cabinet!, panels: rel.panels, modules: rel.modules, joints: rel.joints, dims: rel.dims, antiTipRequired: rel.summary.antiTipRequired } : b.current.engineering.cabinet;
  const initialQuery = part
    ? (rel?.panels.find((x) => x.id === part)?.label ?? cabinet?.panels.find((x) => x.id === part)?.label ?? part)
    : "";

  return (
    <Page>
      <ClaimAccess orderId={order.id} token={t} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Order {order.id}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Assembly guide</h1>
          {!rel && <p className="mt-1 text-sm text-amber-800">Preview from design version {b.current.version}. The final guide is issued with the production release and may differ if the design changes.</p>}
        </div>
        <div className="flex gap-2">
          <PrintButton />
          <Link href={`/orders/${order.id}/support${t ? `?t=${t}` : ""}`} className="btn-secondary no-print">Need help with a part?</Link>
        </div>
      </div>
      <div className="mt-6">
        {guide && bom && cabinet ? <AssemblyGuideView guide={guide} cabinet={cabinet} bom={bom} releaseKey={rel?.releaseKey ?? null} initialQuery={initialQuery} /> : <p className="card text-sm text-ink-soft">The guide is generated once the design compiles.</p>}
      </div>
    </Page>
  );
}

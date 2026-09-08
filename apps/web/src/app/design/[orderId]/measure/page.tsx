import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimAccess } from "@/components/ClaimAccess";
import { MeasurementWizard } from "@/components/configurator/MeasurementWizard";
import { Page } from "@/components/SiteChrome";
import { currentDesignVersion, getOrderForViewer } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function MeasurePage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ t?: string }> }) {
  const { orderId } = await params;
  const { t } = await searchParams;
  const order = await getOrderForViewer(orderId, t);
  if (!order) notFound();
  const current = await currentDesignVersion(order);
  const tokenQuery = t ? `?t=${t}` : "";
  return (
    <Page>
      <ClaimAccess orderId={order.id} token={t} />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Order {order.id}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Measure the space</h1>
          <p className="mt-1 max-w-prose text-sm text-ink-soft">The cabinet’s <strong>finished size</strong> is set in the configurator. Here we record the <strong>space available</strong> and anything in the way, so engineering can confirm it will fit and go in.</p>
        </div>
        <Link href={`/design/${order.id}${tokenQuery}`} className="btn-secondary">Back to configurator</Link>
      </div>
      <MeasurementWizard orderId={order.id} initial={current.measurement ?? null} finished={current.design.finished} returnTo={`/design/${order.id}${tokenQuery}`} />
    </Page>
  );
}

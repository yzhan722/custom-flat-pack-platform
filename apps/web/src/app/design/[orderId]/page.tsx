import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimAccess } from "@/components/ClaimAccess";
import { Configurator } from "@/components/configurator/Configurator";
import { OrderStatusBadge } from "@/components/Badges";
import { Page } from "@/components/SiteChrome";
import { catalog } from "@/lib/catalog";
import { evaluateDesign, toLive } from "@/lib/engineering";
import { isDesignEditable } from "@/server/orders";
import { currentDesignVersion, getOrderForViewer } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function DesignPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ t?: string }> }) {
  const { orderId } = await params;
  const { t } = await searchParams;
  const order = await getOrderForViewer(orderId, t);
  if (!order) notFound();
  const current = await currentDesignVersion(order);
  // Evaluate fresh so the configurator always starts from the live rule set and price list.
  const evaluation = toLive(await evaluateDesign(current.design, current.measurement ?? null));
  const contact = order.customerName && order.customerEmail && order.customerPhone ? { name: order.customerName, email: order.customerEmail, phone: order.customerPhone } : null;
  const tokenQuery = t ? `?t=${t}` : "";

  return (
    <Page wide>
      <ClaimAccess orderId={order.id} token={t} />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Order {order.id}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Configure your cabinet</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <OrderStatusBadge status={order.status} />
          <Link href={`/orders/${order.id}${tokenQuery}`} className="underline">Order page</Link>
        </div>
      </div>
      <Configurator
        orderId={order.id}
        tokenQuery={tokenQuery}
        orderStatus={order.status}
        editable={isDesignEditable(order.status)}
        savedVersion={current.version}
        initialDesign={current.design}
        measurement={current.measurement ?? null}
        initialEvaluation={evaluation}
        templates={catalog.listTemplates()}
        purposes={catalog.listPurposes()}
        contact={contact}
      />
    </Page>
  );
}

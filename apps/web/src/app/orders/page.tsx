import Link from "next/link";
import { OrderStatusBadge } from "@/components/Badges";
import { Page } from "@/components/SiteChrome";
import { dateTime } from "@/lib/format";
import { listOrdersForCustomer } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function MyOrdersPage() {
  const orders = await listOrdersForCustomer();
  return (
    <Page>
      <h1 className="text-3xl font-semibold tracking-tight">My orders</h1>
      <p className="mt-2 text-ink-soft">Orders started on this device. Links we send you by email also open the order directly.</p>
      {orders.length === 0 ? (
        <div className="card mt-6 text-sm">
          <p>No orders yet.</p>
          <Link href="/start" className="btn-primary mt-3">Start a design</Link>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-xl border border-line bg-white">
          {orders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="font-medium">{o.templateId === "TPL-LOW-D" ? "Low cabinet with doors" : "Low cabinet, open shelves"} · v{o.currentDesignVersion}</p>
                <p className="text-xs text-ink-soft">{o.id} · updated {dateTime(o.updatedAt)}</p>
              </div>
              <div className="flex items-center gap-3">
                <OrderStatusBadge status={o.status} />
                <Link href={`/orders/${o.id}`} className="btn-secondary btn-sm">Open</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

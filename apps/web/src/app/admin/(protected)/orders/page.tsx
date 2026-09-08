import Link from "next/link";
import { ORDER_STATUS_LABELS, ORDER_TRANSITIONS, type OrderStatus } from "@cfp/core";
import { EngineeringBadge, OrderStatusBadge, PaymentBadge } from "@/components/Badges";
import { dateTime } from "@/lib/format";
import { listAllOrders } from "@/server/queries";

const ALL = Object.keys(ORDER_TRANSITIONS) as OrderStatus[];

export default async function AdminOrders({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const filter = ALL.includes(status as OrderStatus) ? [status as OrderStatus] : undefined;
  const orders = await listAllOrders(filter);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Orders {filter ? `· ${ORDER_STATUS_LABELS[filter[0]!].en}` : ""}</h1>
        <div className="flex flex-wrap gap-1 text-xs">
          <Link href="/admin/orders" className={`btn-sm ${!filter ? "btn-primary" : "btn-secondary"}`}>All</Link>
          {ALL.map((s) => <Link key={s} href={`/admin/orders?status=${s}`} className={`btn-sm ${filter?.[0] === s ? "btn-primary" : "btn-secondary"}`}>{ORDER_STATUS_LABELS[s].en.split(" — ")[0]}</Link>)}
        </div>
      </div>
      <section className="card p-0">
        <table className="table">
          <thead><tr><th className="pl-5">Order</th><th>Customer</th><th>Design</th><th>State</th><th>Updated</th><th /></tr></thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td className="pl-5 font-mono text-xs">{o.id}</td>
                <td>{o.customerName ?? "—"}<br /><span className="text-xs text-ink-soft">{o.customerEmail ?? ""} {o.postcode}</span></td>
                <td className="text-xs">{o.templateId} v{o.currentDesignVersion}<br /><span className="text-ink-soft">approved v{o.approvedDesignVersion ?? "—"} · quoted v{o.quotedDesignVersion ?? "—"} · confirmed v{o.confirmedDesignVersion ?? "—"}</span></td>
                <td><div className="flex flex-wrap gap-1"><OrderStatusBadge status={o.status} /><EngineeringBadge status={o.engineeringStatus} /><PaymentBadge status={o.paymentStatus} /></div></td>
                <td className="text-xs text-ink-soft">{dateTime(o.updatedAt)}</td>
                <td className="pr-5 text-right"><Link href={`/admin/orders/${o.id}`} className="btn-secondary btn-sm">Open</Link></td>
              </tr>
            ))}
            {orders.length === 0 && <tr><td colSpan={6} className="px-5 py-6 text-center text-sm text-ink-soft">No orders.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

import Link from "next/link";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@cfp/core";
import { ActionForm } from "@/components/ActionForm";
import { OrderStatusBadge, EngineeringBadge, PaymentBadge } from "@/components/Badges";
import { dateTime } from "@/lib/format";
import { seedDemoOrders } from "@/server/actions/admin";
import { demoToolsEnabled } from "@/lib/demo";
import { countOrdersByStatus, listAllOrders, listAllServiceCases, listEnquiries } from "@/server/queries";

const QUEUE: OrderStatus[] = ["submitted", "quoted", "confirmed", "released", "in_production", "qc_packing", "shipped", "aftersales"];

export default async function AdminHome() {
  const [counts, queue, cases, enquiries] = await Promise.all([countOrdersByStatus(), listAllOrders(QUEUE), listAllServiceCases(), listEnquiries()]);
  const openCases = cases.filter((c) => c.status === "open" || c.status === "responded");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Operations</h1>
        <p className="text-sm text-ink-soft">Work queue by stage. Each order carries independent order, engineering and payment states; release needs all three.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-4 lg:grid-cols-8">
        {(["draft", "submitted", "quoted", "confirmed", "released", "in_production", "qc_packing", "shipped", "delivered", "aftersales", "completed"] as OrderStatus[]).map((s) => (
          <Link key={s} href={`/admin/orders?status=${s}`} className="card p-3 hover:border-brand">
            <p className="text-2xl font-semibold tabular-nums">{counts[s] ?? 0}</p>
            <p className="text-xs text-ink-soft">{ORDER_STATUS_LABELS[s].en.split(" — ")[0]}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="card p-0">
          <div className="border-b border-line px-5 py-3"><h2 className="font-semibold">Needs staff action</h2></div>
          {queue.length === 0 ? <p className="px-5 py-6 text-sm text-ink-soft">Nothing waiting.</p> : (
            <table className="table px-5">
              <thead><tr><th className="pl-5">Order</th><th>Customer</th><th>State</th><th>Updated</th><th /></tr></thead>
              <tbody>
                {queue.map((o) => (
                  <tr key={o.id}>
                    <td className="pl-5 font-mono text-xs">{o.id}</td>
                    <td>{o.customerName ?? <span className="text-ink-soft">—</span>}<br /><span className="text-xs text-ink-soft">{o.postcode} · v{o.currentDesignVersion}</span></td>
                    <td><div className="flex flex-wrap gap-1"><OrderStatusBadge status={o.status} /><EngineeringBadge status={o.engineeringStatus} /><PaymentBadge status={o.paymentStatus} /></div></td>
                    <td className="text-xs text-ink-soft">{dateTime(o.updatedAt)}</td>
                    <td className="pr-5 text-right"><Link href={`/admin/orders/${o.id}`} className="btn-secondary btn-sm">Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <aside className="space-y-4">
          <section className="card text-sm">
            <h3 className="font-semibold">After-sales</h3>
            <p className="mt-1 text-ink-soft">{openCases.length} open case(s), {cases.filter((c) => c.severity === "safety" && c.status !== "closed").length} safety-related.</p>
            <Link href="/admin/cases" className="btn-secondary btn-sm mt-2">Open queue</Link>
          </section>
          <section className="card text-sm">
            <h3 className="font-semibold">Enquiries we could not serve</h3>
            <p className="mt-1 text-ink-soft">{enquiries.length} kept. Use them to decide the next postcode or purpose to open.</p>
            <Link href="/admin/enquiries" className="btn-secondary btn-sm mt-2">Review</Link>
          </section>
          {demoToolsEnabled() && (
            <section className="card text-sm">
              <h3 className="font-semibold">Demo pipeline</h3>
              <p className="mt-1 text-ink-soft">Seven real orders plus one out-of-range enquiry: draft, submitted, quoted, paid (not released), QC, delivered, after-sales with a replacement job. Re-seeding replaces the previous demo rows only.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href="/admin/demo" className="btn-primary btn-sm">Presenter script</Link>
              </div>
              <ActionForm action={seedDemoOrders} submitLabel="Reset demo pipeline" submitClassName="btn-secondary btn-sm" confirmText="Replace current demo orders with a fresh pipeline?" />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

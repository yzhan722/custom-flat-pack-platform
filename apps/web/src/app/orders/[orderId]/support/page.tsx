import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { ClaimAccess } from "@/components/ClaimAccess";
import { Page } from "@/components/SiteChrome";
import { openServiceCase } from "@/server/actions/customer";
import { getOrderForViewer, loadOrderBundle } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function SupportPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ t?: string }> }) {
  const { orderId } = await params;
  const { t } = await searchParams;
  const order = await getOrderForViewer(orderId, t);
  if (!order) notFound();
  const b = await loadOrderBundle(order);
  const panels = b.release?.payload.panels ?? b.current.engineering.cabinet?.panels ?? [];
  const bags = b.release?.payload.hardware.bags ?? b.current.engineering.bom?.bags ?? [];
  return (
    <Page>
      <ClaimAccess orderId={order.id} token={t} />
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Order {order.id}</p>
      <h1 className="text-2xl font-semibold tracking-tight">Report a problem or ask for a part</h1>
      <p className="mt-1 max-w-prose text-sm text-ink-soft">Pick the part by its label. We reproduce it from the production record of your order — no need to explain the whole design. First reply within one working day; a plan or request for details within two.</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ActionForm action={openServiceCase} submitLabel="Open case" className="card space-y-3 text-sm">
          <input type="hidden" name="orderId" value={order.id} />
          <div className="grid gap-3 md:grid-cols-2">
            <label>
              <span className="label">Part</span>
              <select name="partRef" className="input" defaultValue={panels[0]?.id ?? "OTHER"}>
                <optgroup label="Panels">
                  {panels.map((p) => <option key={p.id} value={p.id}>{p.label} — {p.name}</option>)}
                </optgroup>
                <optgroup label="Hardware bags">
                  {bags.map((bg) => <option key={bg.bagCode} value={bg.bagCode}>Bag {bg.bagCode}</option>)}
                </optgroup>
                <optgroup label="Other">
                  <option value="GUIDE">Assembly guide</option>
                  <option value="OTHER">Something else</option>
                </optgroup>
              </select>
            </label>
            <label>
              <span className="label">Part type</span>
              <select name="partKind" className="input" defaultValue="panel">
                <option value="panel">Panel</option>
                <option value="hardware_bag">Hardware bag</option>
                <option value="document">Document / guide</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          <label>
            <span className="label">How serious is it?</span>
            <select name="severity" className="input" defaultValue="blocking">
              <option value="safety">Safety — something could fall, break or hurt someone</option>
              <option value="blocking">Blocking — I cannot continue assembly</option>
              <option value="cosmetic">Cosmetic — visible damage, assembly possible</option>
              <option value="question">Question</option>
            </select>
          </label>
          <label>
            <span className="label">What happened?</span>
            <textarea name="symptom" className="input min-h-28" placeholder="e.g. A07 arrived with a chipped front edge; the hole for the hinge plate at the top does not line up…" required />
          </label>
          <label>
            <span className="label">Photo references (optional, one per line)</span>
            <textarea name="photoRefs" className="input min-h-16" placeholder="IMG_1023.jpg" />
          </label>
        </ActionForm>
        <aside className="card text-sm">
          <h3 className="font-semibold">How replacements work</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">
            <li>Replacement parts are cut from your order’s release record, so they match the original holes and sizes.</li>
            <li>Safety-related reports pause production of the affected template until the cause is found.</li>
            <li>Made-to-order does not exclude consumer guarantees. Damage in transit, machining faults and missing items are ours to fix.</li>
          </ul>
          <Link href={`/orders/${order.id}${t ? `?t=${t}` : ""}`} className="btn-secondary mt-4">Back to order</Link>
        </aside>
      </div>
    </Page>
  );
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { quoteValidity } from "@cfp/core";
import { ActionForm } from "@/components/ActionForm";
import { ClaimAccess } from "@/components/ClaimAccess";
import { ElevationDrawing } from "@/components/ElevationDrawing";
import { PriceBreakdown } from "@/components/PriceBreakdown";
import { Page } from "@/components/SiteChrome";
import { catalog } from "@/lib/catalog";
import { dateOnly } from "@/lib/format";
import { confirmOrder } from "@/server/actions/customer";
import { getOrderForViewer, loadOrderBundle } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function ConfirmPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ t?: string }> }) {
  const { orderId } = await params;
  const { t } = await searchParams;
  const order = await getOrderForViewer(orderId, t);
  if (!order) notFound();
  const b = await loadOrderBundle(order);
  const quote = b.quote;
  if (order.status !== "quoted" || !quote || quote.status !== "active") redirect(`/orders/${orderId}${t ? `?t=${t}` : ""}`);
  const validity = quoteValidity(quote, new Date(), order.currentDesignVersion, b.current.engineeringHash);
  const cabinet = b.current.engineering.cabinet;
  const design = b.current.design;
  const ctx = catalog.resolveTemplate(design.templateId, design.templateVersion);
  if (!cabinet) redirect(`/orders/${orderId}`);

  const acks: Array<[string, string]> = [
    ["dimensions", `The outside size is ${design.finished.width_mm} × ${design.finished.height_mm} × ${design.finished.depth_mm} mm (W × H × D) including feet, doors and back. I have checked it against the space.`],
    ["structure", "I accept the visible structure shown in the drawing: module widths, door directions, handles, shelves, top panel style and seams."],
    ["price", `The total is ${(quote.totalCents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" })} incl. GST${quote.deliveryCents ? " and delivery" : ""}, with 50% deposit on confirmation and the balance before production is released.`],
    ["delivery", `Delivery is ${design.installation.deliveryMethod === "pickup" ? "pickup from the factory" : `to the door at postcode ${design.installation.deliveryPostcode}`}, approximately ${quote.leadTimeDays} days after production release. Carrying in and removal of old furniture are not included.`],
    ["installation", "Assembly is done by me following the supplied guide. Professional installation and wall fixings are not included in this price."],
    ["consumer_rights", "I understand this is made to my specification; change of mind after release is handled as a change order, while faults remain covered by Australian consumer guarantees."],
  ];
  if (cabinet.antiTipRequired) acks.push(["anti_tip", `At ${design.finished.height_mm} mm this cabinet must be restrained to the wall using the supplied kit. Fixings for my wall type (${design.installation.wallType.replace(/_/g, " ")}) are my responsibility or a booked installer's.`]);

  return (
    <Page>
      <ClaimAccess orderId={order.id} token={t} />
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Order {order.id} · quote {quote.id}</p>
      <h1 className="text-2xl font-semibold tracking-tight">Review and confirm design version {b.current.version}</h1>
      <p className="mt-1 max-w-prose text-sm text-ink-soft">This is the exact version we will manufacture. Changing anything afterwards creates a new version that must be re-quoted and re-confirmed.</p>
      {!validity.valid && <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">This quote cannot be confirmed: {validity.reason} <Link className="underline" href={`/orders/${orderId}`}>Back to the order</Link>.</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <section className="card">
            <h2 className="font-semibold">Dimensioned drawing</h2>
            <div className="mt-3"><ElevationDrawing cabinet={cabinet} title={`Order ${order.id} · v${b.current.version} · ${design.finished.width_mm}×${design.finished.height_mm}×${design.finished.depth_mm}`} /></div>
            <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Visible structure</p>
                <ul className="mt-1 list-disc pl-5">
                  <li>{design.topPanelStyle === "single" ? "One continuous top panel" : "One top panel per module — visible seams"}</li>
                  {design.modules.map((m, i) => (
                    <li key={i}>Module {i + 1} ({m.width_mm} mm): {m.kind === "door" ? `${m.doorSwing === "double" ? "two doors" : `one door hinged ${m.doorSwing}`}, ${m.handle === "none" ? "no handle" : "bar handle"}` : "open"}, {m.shelfCount} shelf(s)</li>
                  ))}
                  <li>Clear interior per module: {cabinet.modules.map((m) => `${Math.round(m.interior.width_um / 1000)} × ${Math.round(m.interior.height_um / 1000)} × ${Math.round(m.interior.depth_um / 1000)} mm`).join("; ")}</li>
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Materials and rating</p>
                <ul className="mt-1 list-disc pl-5">
                  <li>{ctx.material.name}</li>
                  <li>{ctx.edgeBand.name}; {ctx.backPanel.name}</li>
                  <li>{ctx.hardware.name}</li>
                  <li>Rated {ctx.construction.shelfLoadRating_kg} kg per shelf, {ctx.construction.topLoadRating_kg} kg on top, evenly distributed</li>
                  <li>{cabinet.panels.length} panels, {cabinet.totals.weight_kg} kg; {b.current.engineering.packaging?.packages.length} packages</li>
                </ul>
              </div>
            </div>
            <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Use and safety</p>
              <ul className="mt-1 list-disc pl-5">
                {ctx.template.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </div>
          </section>

          <section className="card">
            <PriceBreakdown price={quote.price} title="Formal quote" />
            <p className="mt-3 text-xs text-ink-soft">Price list {quote.priceListId} v{quote.priceListVersion} · factory {quote.factoryId} · valid until {dateOnly(quote.validUntil)} · engineering record {quote.engineeringHash.slice(0, 12)}…</p>
          </section>
        </div>

        <aside>
          <section className="card sticky top-4">
            <h2 className="font-semibold">Your confirmation</h2>
            <ActionForm action={confirmOrder} submitLabel="Confirm this version" className="mt-3 space-y-3 text-sm" hideSubmit={!validity.valid}>
              <input type="hidden" name="orderId" value={order.id} />
              {acks.map(([k, text]) => (
                <label key={k} className="flex gap-2">
                  <input type="checkbox" name={`ack_${k}`} className="mt-1" />
                  <span>{text}</span>
                </label>
              ))}
              <label className="block">
                <span className="label">Type your full name to sign</span>
                <input name="confirmedBy" className="input" defaultValue={order.customerName ?? ""} required />
              </label>
              <p className="text-xs text-ink-soft">We store a snapshot of the drawing, specification and price with the time of your confirmation.</p>
            </ActionForm>
          </section>
        </aside>
      </div>
    </Page>
  );
}

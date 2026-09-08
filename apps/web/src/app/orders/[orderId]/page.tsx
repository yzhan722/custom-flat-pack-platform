import Link from "next/link";
import { notFound } from "next/navigation";
import { ORDER_STATUS_LABELS, quoteValidity, type OrderStatus } from "@cfp/core";
import { ActionForm } from "@/components/ActionForm";
import { EngineeringBadge, OrderStatusBadge, PaymentBadge, Pill } from "@/components/Badges";
import { ClaimAccess } from "@/components/ClaimAccess";
import { CopyButton } from "@/components/CopyButton";
import { ElevationDrawing } from "@/components/ElevationDrawing";
import { Page } from "@/components/SiteChrome";
import { dateOnly, dateTime, money } from "@/lib/format";
import { updateContact } from "@/server/actions/customer";
import { inspectionState } from "@/server/production";
import { getOrderForViewer, loadOrderBundle } from "@/server/queries";
import { PayButtons } from "./PayButtons";

export const dynamic = "force-dynamic";

const STEPS: OrderStatus[] = ["draft", "submitted", "quoted", "confirmed", "released", "in_production", "qc_packing", "shipped", "delivered", "completed"];

export default async function OrderPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ t?: string; confirmed?: string; submitted?: string }> }) {
  const { orderId } = await params;
  const sp = await searchParams;
  const order = await getOrderForViewer(orderId, sp.t);
  if (!order) notFound();
  const b = await loadOrderBundle(order);
  const eng = b.current.engineering;
  const cabinet = eng.cabinet;
  const quote = b.quote;
  const validity = quote && quote.status === "active" ? quoteValidity(quote, new Date(), order.currentDesignVersion, b.current.engineeringHash) : null;
  const stepIndex = STEPS.indexOf(order.status);
  const latestReview = b.reviews[0];
  const outstanding = quote ? Math.max(0, quote.totalCents - (b.totals.paid_cents - b.totals.refunded_cents)) : 0;
  const { packed } = inspectionState(b);
  const tokenQuery = sp.t ? `?t=${sp.t}` : "";

  return (
    <Page>
      <ClaimAccess orderId={order.id} token={sp.t} />
      {sp.confirmed && <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Thank you — your confirmation is recorded. Pay the deposit below to secure materials; the balance is due before production is released.</p>}
      {sp.submitted && <p className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">Submitted. An engineer will review the design and we will email your formal quote, usually within two working days.</p>}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Order {order.id}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{ORDER_STATUS_LABELS[order.status].en}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <OrderStatusBadge status={order.status} />
            <EngineeringBadge status={order.engineeringStatus} />
            <PaymentBadge status={order.paymentStatus} />
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/design/${order.id}${tokenQuery}`} className="btn-secondary">{["draft", "needs_changes", "submitted", "quoted"].includes(order.status) ? "Edit design" : "View design"}</Link>
          <Link href={`/orders/${order.id}/assembly${tokenQuery}`} className="btn-secondary">Assembly guide</Link>
          <Link href={`/orders/${order.id}/support${tokenQuery}`} className="btn-secondary">Report a problem</Link>
        </div>
      </div>

      {order.status !== "cancelled" && order.status !== "aftersales" && order.status !== "needs_changes" && (
        <ol className="mt-6 grid grid-cols-5 gap-1 text-[11px] md:grid-cols-10">
          {STEPS.map((s, i) => (
            <li key={s} className={`rounded px-1.5 py-1 text-center ${i <= stepIndex ? "bg-brand text-white" : "bg-stone-100 text-ink-soft"}`}>{ORDER_STATUS_LABELS[s].en.split(" — ")[0]}</li>
          ))}
        </ol>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          {order.status === "needs_changes" && latestReview && (
            <section className="card border-amber-300 bg-amber-50">
              <h2 className="font-semibold text-amber-900">Engineering asked for changes</h2>
              <p className="mt-1 whitespace-pre-wrap text-sm text-amber-900">{latestReview.notes}</p>
              <Link href={`/design/${order.id}${tokenQuery}`} className="btn-primary mt-3">Update the design</Link>
            </section>
          )}

          <section className="card">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold">Design version {b.current.version}</h2>
              <span className="text-xs text-ink-soft">{b.versions.length} version(s) · last saved {dateTime(b.current.createdAt)}</span>
            </div>
            {cabinet ? (
              <>
                <div className="mt-3"><ElevationDrawing cabinet={cabinet} /></div>
                <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
                  <div className="flex justify-between"><dt className="text-ink-soft">Outside size</dt><dd>{b.current.design.finished.width_mm} × {b.current.design.finished.height_mm} × {b.current.design.finished.depth_mm} mm</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-soft">Modules</dt><dd>{b.current.design.modules.map((m) => `${m.width_mm} ${m.kind}`).join(", ")}</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-soft">Use</dt><dd>{b.current.design.purpose.replace(/_/g, " ")}</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-soft">Delivery</dt><dd>{b.current.design.installation.deliveryMethod === "pickup" ? "Pickup" : `Local delivery to ${b.current.design.installation.deliveryPostcode}`}</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-soft">Panels / weight</dt><dd>{cabinet.panels.length} panels · {cabinet.totals.weight_kg} kg</dd></div>
                  <div className="flex justify-between"><dt className="text-ink-soft">Wall restraint</dt><dd>{cabinet.antiTipRequired ? "Required (kit included)" : "Not required at this height"}</dd></div>
                </dl>
              </>
            ) : (
              <p className="mt-2 text-sm text-red-800">This version has blocking configuration issues; open the configurator to resolve them.</p>
            )}
          </section>

          <section className="card">
            <h2 className="font-semibold">Quote and confirmation</h2>
            {!quote && <p className="mt-1 text-sm text-ink-soft">Your formal quote appears here after engineering review. It is issued by our team, valid for 7 days and bound to design version {order.currentDesignVersion}.</p>}
            {quote && (
              <div className="mt-2 space-y-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>Quote {quote.id} · design v{quote.designVersion} · {quote.status}</span>
                  <span className="text-xl font-semibold">{money(quote.totalCents)} <span className="text-xs font-normal text-ink-soft">incl. GST{quote.deliveryCents ? " and delivery" : ""}</span></span>
                </div>
                <p className="text-ink-soft">Lead time {quote.leadTimeDays} days after release · valid until {dateOnly(quote.validUntil)}{quote.notes ? ` · ${quote.notes}` : ""}</p>
                {quote.status === "active" && validity && !validity.valid && <p className="text-red-800">This quote is no longer valid: {validity.reason}</p>}
                {quote.status === "active" && validity?.valid && order.status === "quoted" && (
                  <Link href={`/orders/${order.id}/confirm${tokenQuery}`} className="btn-primary">Review drawing and confirm</Link>
                )}
                {b.confirmation && (
                  <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-900">
                    Confirmed by {b.confirmation.confirmedBy} on {dateTime(b.confirmation.confirmedAt)} · record {b.confirmation.snapshotHash.slice(0, 12)}…
                  </p>
                )}
              </div>
            )}
          </section>

          {(quote?.status === "accepted" || quote?.status === "active") && (
            <section className="card">
              <h2 className="font-semibold">Payments</h2>
              <p className="mt-1 text-sm text-ink-soft">
                {quote.status === "active"
                  ? `A refundable intent deposit of ${money(Math.round(quote.totalCents * 0.1))} can be paid before you confirm. It does not start production.`
                  : `Paid ${money(b.totals.paid_cents - b.totals.refunded_cents)} of ${money(quote.totalCents)}. Production is released only once the balance is settled.`}
              </p>
              <div className="mt-3">
                <PayButtons
                  orderId={order.id}
                  status={order.status}
                  quoteStatus={quote.status}
                  depositCents={quote.depositCents}
                  intentCents={Math.round(quote.totalCents * 0.1)}
                  outstandingCents={outstanding}
                  depositPaid={b.totals.paid_cents >= quote.depositCents}
                  intentPaid={b.totals.intent_cents > 0}
                />
              </div>
              {b.payments.length > 0 && (
                <ul className="mt-3 divide-y divide-stone-100 text-sm">
                  {b.payments.map((p) => (
                    <li key={p.id} className="flex justify-between py-1.5"><span>{p.kind.replace(/_/g, " ")} · {p.method}{p.reference ? ` · ${p.reference}` : ""}</span><span className="tabular-nums">{p.kind === "refund" ? "−" : ""}{money(p.amountCents)}</span></li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {b.release && (
            <section className="card">
              <h2 className="font-semibold">Production and delivery</h2>
              <p className="mt-1 text-sm text-ink-soft">Release {b.release.releaseKey} · {b.release.payload.panels.length} panels · {b.release.payload.packaging.packages.length} packages · {b.release.payload.packaging.totalWeight_kg} kg</p>
              <ul className="mt-3 space-y-1 text-sm">
                {b.release.payload.packaging.packages.map((p) => (
                  <li key={p.code} className="flex items-center justify-between rounded-md bg-stone-50 px-3 py-1.5">
                    <span><span className="font-mono text-xs">{p.code}</span> {p.title} · {Math.round(p.outer.length_um / 1000)} × {Math.round(p.outer.width_um / 1000)} × {Math.round(p.outer.height_um / 1000)} mm · {p.weight_kg} kg</span>
                    <Pill tone={packed.has(p.code) ? "good" : "neutral"}>{packed.has(p.code) ? "packed" : "pending"}</Pill>
                  </li>
                ))}
              </ul>
              <ul className="mt-3 space-y-1 text-xs text-ink-soft">
                {b.events.filter((e) => ["production_started", "shipped", "delivered"].includes(e.kind)).map((e) => (
                  <li key={e.id}>{dateTime(e.createdAt)} — {e.kind.replace(/_/g, " ")}{e.payload.carrier ? ` (${String(e.payload.carrier)})` : ""}</li>
                ))}
              </ul>
            </section>
          )}

          {b.cases.length > 0 && (
            <section className="card">
              <h2 className="font-semibold">Support cases</h2>
              <ul className="mt-2 divide-y divide-stone-100 text-sm">
                {b.cases.map((c) => (
                  <li key={c.id} className="py-2">
                    <div className="flex items-center justify-between"><span className="font-medium">{c.partRef} · {c.severity}</span><Pill tone={c.status === "resolved" || c.status === "closed" ? "good" : c.status === "responded" ? "info" : "warn"}>{c.status}</Pill></div>
                    <p className="text-ink-soft">{c.symptom}</p>
                    {c.resolution && <p className="mt-1">Resolution: {c.resolution}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <section className="card text-sm">
            <h3 className="font-semibold">Contact details</h3>
            <ActionForm action={updateContact} submitLabel="Save details" submitClassName="btn-secondary btn-sm" className="mt-2 space-y-2">
              <input type="hidden" name="orderId" value={order.id} />
              <input name="name" className="input" placeholder="Full name" defaultValue={order.customerName ?? ""} />
              <input name="email" className="input" placeholder="Email" defaultValue={order.customerEmail ?? ""} />
              <input name="phone" className="input" placeholder="Phone" defaultValue={order.customerPhone ?? ""} />
              <input name="referralSource" className="input" placeholder="Referred by (optional)" defaultValue={order.referralSource ?? ""} />
            </ActionForm>
          </section>
          <section className="card text-sm">
            <h3 className="font-semibold">Engineering checks</h3>
            {eng.report ? (
              <ul className="mt-2 space-y-1 text-ink-soft">
                <li>{eng.report.results.filter((r) => r.severity === "PASS").length} passed</li>
                <li>{eng.report.reviewRequired.length} for engineering review</li>
                <li>{eng.report.unsupported.length} blocking</li>
                <li className="text-xs">Rule set {eng.report.ruleSetVersion}</li>
              </ul>
            ) : <p className="text-ink-soft">Not evaluated.</p>}
            {latestReview && order.status !== "needs_changes" && <p className="mt-2 text-xs text-ink-soft">Last review: {latestReview.decision.replace(/_/g, " ")} on {dateTime(latestReview.createdAt)}</p>}
          </section>
          <section className="card text-sm">
            <h3 className="font-semibold">Share this order</h3>
            <p className="mt-1 text-xs text-ink-soft">This link opens the order on any device. Keep it private.</p>
            <code className="mt-2 block break-all rounded bg-stone-100 p-2 text-[11px]">/orders/{order.id}?t={order.accessToken}</code>
            <div className="mt-2">
              <CopyButton text={`/orders/${order.id}?t=${order.accessToken}`} label="Copy path" />
            </div>
          </section>
        </aside>
      </div>
    </Page>
  );
}

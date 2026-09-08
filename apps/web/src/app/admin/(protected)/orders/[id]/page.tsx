import Link from "next/link";
import { notFound } from "next/navigation";
import { assessSpace } from "@cfp/core";
import { ActionForm } from "@/components/ActionForm";
import { EngineeringBadge, OrderStatusBadge, PaymentBadge, Pill, SeverityBadge } from "@/components/Badges";
import { ElevationDrawing } from "@/components/ElevationDrawing";
import { PriceBreakdown } from "@/components/PriceBreakdown";
import { RuleReport } from "@/components/RuleReport";
import { dateOnly, dateTime, mm, money, titleCase } from "@/lib/format";
import { addCost, copyQuoteEstimateCosts, inspectPanel, issueQuote, packPackage, recordPayment, recordReview, runProductionStep, updateServiceCase } from "@/server/actions/admin";
import { contribution, inspectionState, openBlocks, releaseGateFor, shipmentBlockers } from "@/server/production";
import { getOrder, loadOrderBundle } from "@/server/queries";

export const dynamic = "force-dynamic";

const COST_CATEGORIES = ["board", "hardware", "machining", "edge_banding", "qc_pack_labour", "packaging", "overhead", "delivery", "payment_fees", "presales_engineering", "assembly_support", "rework", "acquisition_channel", "other"];

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) notFound();
  const b = await loadOrderBundle(order);
  const eng = b.current.engineering;
  const cabinet = eng.cabinet;
  const gate = releaseGateFor(b);
  const blocks = openBlocks(b);
  const { latest, packed } = inspectionState(b);
  const shipBlockers = b.release ? shipmentBlockers(b) : [];
  const contrib = contribution(b);
  const canReview = order.status === "submitted";
  const canQuote = order.status === "submitted" && order.engineeringStatus === "approved" && order.approvedDesignVersion === order.currentDesignVersion;
  const space = b.current.measurement?.spaceConstrained ? assessSpace(b.current.measurement) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-ink-soft">{order.id} · created {dateTime(order.createdAt)}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{order.customerName ?? "Unnamed customer"} · {order.templateId} v{order.currentDesignVersion}</h1>
          <p className="text-sm text-ink-soft">{order.customerEmail ?? "no email"} · {order.customerPhone ?? "no phone"} · {order.postcode} · {order.purpose.replace(/_/g, " ")}{order.budgetCents ? ` · budget ${money(order.budgetCents)}` : ""}{order.timeframe ? ` · ${order.timeframe}` : ""}{order.needsInstallation ? " · wants installation" : ""}{order.referralSource ? ` · via ${order.referralSource}` : ""}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <OrderStatusBadge status={order.status} />
            <EngineeringBadge status={order.engineeringStatus} />
            <PaymentBadge status={order.paymentStatus} />
            <Pill>approved v{order.approvedDesignVersion ?? "—"}</Pill>
            <Pill>quoted v{order.quotedDesignVersion ?? "—"}</Pill>
            <Pill>confirmed v{order.confirmedDesignVersion ?? "—"}</Pill>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/orders/${order.id}?t=${order.accessToken}`} className="btn-secondary btn-sm">Customer view</Link>
          <Link href={`/design/${order.id}?t=${order.accessToken}`} className="btn-secondary btn-sm">Configurator</Link>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          {/* Engineering ------------------------------------------------- */}
          <section className="card" id="engineering">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Engineering — design v{b.current.version}</h2>
              <div className="flex items-center gap-2 text-xs text-ink-soft">
                {eng.report && <SeverityBadge severity={eng.report.verdict} />}
                <span>rules {eng.report?.ruleSetVersion ?? "—"} · hash {b.current.engineeringHash?.slice(0, 12) ?? "—"}</span>
              </div>
            </div>
            {cabinet ? (
              <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div>
                  <ElevationDrawing cabinet={cabinet} />
                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
                    <div><dt className="text-xs text-ink-soft">Finished</dt><dd>{b.current.design.finished.width_mm} × {b.current.design.finished.height_mm} × {b.current.design.finished.depth_mm}</dd></div>
                    <div><dt className="text-xs text-ink-soft">Modules</dt><dd>{b.current.design.modules.map((m) => `${m.width_mm}${m.kind === "door" ? `D(${m.doorSwing?.[0]})` : "O"}/${m.shelfCount}`).join(" ")}</dd></div>
                    <div><dt className="text-xs text-ink-soft">Top</dt><dd>{b.current.design.topPanelStyle}</dd></div>
                    <div><dt className="text-xs text-ink-soft">Panels / holes / pockets</dt><dd>{cabinet.totals.panelCount} / {cabinet.totals.drillCount} / {cabinet.totals.pocketCount}</dd></div>
                    <div><dt className="text-xs text-ink-soft">Board / edge</dt><dd>{Object.values(cabinet.totals.areaByMaterial_m2).reduce((a, c) => a + c, 0).toFixed(2)} m² / {cabinet.totals.edgeBandLength_m} m</dd></div>
                    <div><dt className="text-xs text-ink-soft">Weight / restraint</dt><dd>{cabinet.totals.weight_kg} kg / {cabinet.antiTipRequired ? "required" : "no"}</dd></div>
                    <div><dt className="text-xs text-ink-soft">Wall / ack</dt><dd>{b.current.design.installation.wallType} / {b.current.design.installation.antiTipAcknowledged ? "yes" : "no"}</dd></div>
                    <div><dt className="text-xs text-ink-soft">Delivery</dt><dd>{b.current.design.installation.deliveryMethod} {b.current.design.installation.deliveryPostcode}</dd></div>
                    <div><dt className="text-xs text-ink-soft">Measurement</dt><dd>{b.current.measurement ? (b.current.measurement.spaceConstrained ? `constrained; min ${space?.minAnyWidth_mm ?? "?"} mm, spread ${space?.widthSpread_mm ?? "?"} mm, ${space?.hasVerifiedWidth ? "verified" : "unverified"}` : "free-standing") : "none"}</dd></div>
                  </dl>
                </div>
                <div>
                  <RuleReport results={eng.report?.results ?? []} compiled={eng.report?.compiled ?? false} />
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-red-800">Design does not compile: {eng.schemaErrors.join("; ") || "blocking configuration rules."}</p>
            )}
            {b.current.measurement && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink-soft">Measurement record</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-stone-50 p-3 text-xs">{JSON.stringify(b.current.measurement, null, 2)}</pre>
              </details>
            )}
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink-soft">Design versions ({b.versions.length})</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {b.versions.map((v) => <li key={v.id}>v{v.version} · {v.verdict ?? "—"} · {v.createdBy} · {dateTime(v.createdAt)} · {v.note ?? ""} · {v.engineeringHash?.slice(0, 10)}</li>)}
              </ul>
            </details>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <ActionForm action={recordReview} submitLabel="Record decision" className="rounded-md border border-line bg-stone-50 p-3 text-sm">
                <input type="hidden" name="orderId" value={order.id} />
                <p className="font-medium">Review decision {canReview ? "" : <span className="text-xs text-ink-soft">(order is {order.status}; approval only while submitted)</span>}</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <label className="flex items-center gap-1"><input type="radio" name="decision" value="approved" defaultChecked={canReview && eng.report?.verdict !== "UNSUPPORTED"} disabled={!canReview || eng.report?.verdict === "UNSUPPORTED"} /> Approve v{b.current.version}</label>
                  <label className="flex items-center gap-1"><input type="radio" name="decision" value="needs_changes" /> Needs changes</label>
                  <label className="flex items-center gap-1"><input type="radio" name="decision" value="blocked" /> Block</label>
                </div>
                <textarea name="notes" className="input mt-2 min-h-20" placeholder="What was checked, what the customer must change, or why it is blocked. Shown to the customer for needs-changes." required />
              </ActionForm>
              <div className="rounded-md border border-line bg-stone-50 p-3 text-sm">
                <p className="font-medium">Review history</p>
                {b.reviews.length === 0 ? <p className="mt-1 text-ink-soft">No reviews yet.</p> : (
                  <ul className="mt-1 space-y-1">
                    {b.reviews.map((r) => <li key={r.id}><Pill tone={r.decision === "approved" ? "good" : r.decision === "blocked" ? "bad" : "warn"}>{r.decision}</Pill> v{r.designVersion} · {r.reviewer} · {dateTime(r.createdAt)}<br /><span className="text-xs text-ink-soft">{r.notes}</span></li>)}
                  </ul>
                )}
              </div>
            </div>
          </section>

          {/* Quote ------------------------------------------------------- */}
          <section className="card" id="quote">
            <h2 className="font-semibold">Quote</h2>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <ActionForm action={issueQuote} submitLabel="Issue formal quote" className="rounded-md border border-line bg-stone-50 p-3 text-sm" hideSubmit={!canQuote}>
                <input type="hidden" name="orderId" value={order.id} />
                {!canQuote && <p className="mb-2 text-xs text-amber-800">Requires status submitted and engineering approval of v{order.currentDesignVersion}.</p>}
                <div className="grid grid-cols-2 gap-2">
                  <label><span className="label">Lead time (days)</span><input name="leadTimeDays" type="number" className="input" defaultValue={21} min={1} max={120} /></label>
                  <label><span className="label">Valid for (days, max 7)</span><input name="validityDays" type="number" className="input" defaultValue={7} min={1} max={7} /></label>
                </div>
                <label className="mt-2 block"><span className="label">Notes to customer</span><input name="notes" className="input" placeholder="e.g. delivery Tuesdays only" /></label>
                <p className="mt-2 text-xs text-ink-soft">The server recomputes the price and refuses to quote if the engineering hash has drifted since approval.</p>
              </ActionForm>
              <div className="text-sm">
                {b.quotes.length === 0 ? <p className="text-ink-soft">No quotes issued.</p> : (
                  <ul className="space-y-2">
                    {b.quotes.map((q) => (
                      <li key={q.id} className="rounded-md border border-line p-3">
                        <div className="flex items-center justify-between"><span className="font-mono text-xs">{q.id}</span><Pill tone={q.status === "accepted" ? "good" : q.status === "active" ? "info" : "neutral"}>{q.status}</Pill></div>
                        <p className="mt-1">{money(q.totalCents)} incl. GST · deposit {money(q.depositCents)} · v{q.designVersion} · lead {q.leadTimeDays} d · valid until {dateOnly(q.validUntil)}</p>
                        <p className="text-xs text-ink-soft">{q.priceListId} v{q.priceListVersion} · {q.factoryId} · issued by {q.issuedBy} {dateTime(q.issuedAt)}</p>
                      </li>
                    ))}
                  </ul>
                )}
                {b.quote && <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink-soft">Price breakdown</summary><div className="mt-2"><PriceBreakdown price={b.quote.price} title="Quoted price" /></div></details>}
              </div>
            </div>
            {b.confirmation && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Confirmed by {b.confirmation.confirmedBy} at {dateTime(b.confirmation.confirmedAt)} for v{b.confirmation.designVersion} · snapshot {b.confirmation.snapshotHash.slice(0, 16)} · acknowledgements: {Object.keys(b.confirmation.acknowledgements).join(", ")}</p>}
          </section>

          {/* Payments ---------------------------------------------------- */}
          <section className="card" id="payments">
            <h2 className="font-semibold">Payments</h2>
            <p className="mt-1 text-sm text-ink-soft">Paid {money(b.totals.paid_cents)} · refunded {money(b.totals.refunded_cents)} · intents {money(b.totals.intent_cents)}{b.quote ? ` · quote ${money(b.quote.totalCents)} (deposit ${money(b.quote.depositCents)})` : ""}</p>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <ActionForm action={recordPayment} submitLabel="Record" className="rounded-md border border-line bg-stone-50 p-3 text-sm">
                <input type="hidden" name="orderId" value={order.id} />
                <div className="grid grid-cols-2 gap-2">
                  <label><span className="label">Kind</span><select name="kind" className="input" defaultValue="deposit"><option value="intent_deposit">Refundable intent deposit</option><option value="deposit">Deposit</option><option value="balance">Balance</option><option value="refund">Refund</option></select></label>
                  <label><span className="label">Amount (A$)</span><input name="amount" type="number" step="0.01" className="input" required /></label>
                  <label><span className="label">Method</span><input name="method" className="input" defaultValue="bank_transfer" /></label>
                  <label><span className="label">Bank / gateway reference = idempotency key</span><input name="idempotencyKey" className="input" placeholder="e.g. NAB-20260908-1234" required /></label>
                </div>
                <input name="note" className="input mt-2" placeholder="Note (optional)" />
              </ActionForm>
              <ul className="space-y-1 text-sm">
                {b.payments.map((p) => <li key={p.id} className="flex justify-between rounded border border-line px-3 py-1.5"><span>{titleCase(p.kind)} · {p.method} · <span className="font-mono text-xs">{p.idempotencyKey}</span><br /><span className="text-xs text-ink-soft">{p.recordedBy} · {dateTime(p.createdAt)} {p.note ?? ""}</span></span><span className="tabular-nums">{p.kind === "refund" ? "−" : ""}{money(p.amountCents)}</span></li>)}
                {b.payments.length === 0 && <li className="text-ink-soft">No payments.</li>}
              </ul>
            </div>
          </section>

          {/* Release ----------------------------------------------------- */}
          <section className="card" id="release">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Production release</h2>
              <Pill tone={gate.ok ? "good" : "warn"}>{gate.ok ? "Gate open" : `${gate.reasons.length} condition(s) outstanding`}</Pill>
            </div>
            {gate.reasons.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-ink-soft">{gate.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
            <div className="mt-3 flex flex-wrap gap-2">
              <StepForm orderId={order.id} intent="materials_confirmed" label="Confirm materials and hardware available" cls="btn-secondary btn-sm" withText placeholder="Supplier / batch" />
              <StepForm orderId={order.id} intent="capacity_confirmed" label="Confirm factory slot" cls="btn-secondary btn-sm" withText placeholder="Week / machine" />
              {!b.release && <StepForm orderId={order.id} intent="release" label="Release to production" cls="btn-primary btn-sm" disabled={!gate.ok} confirm="Issue the immutable production release for this version?" />}
            </div>
            {b.releases.length > 0 && (
              <ul className="mt-4 space-y-2 text-sm">
                {b.releases.map((r) => (
                  <li key={r.releaseKey} className="rounded-md border border-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs">{r.releaseKey} · seq {r.sequence} · v{r.designVersion} · content {r.contentHash.slice(0, 12)}</span>
                      <Pill tone={r.status === "active" ? "good" : r.status === "stopped" ? "bad" : "neutral"}>{r.status}</Pill>
                    </div>
                    <p className="text-xs text-ink-soft">{r.releasedBy} · {dateTime(r.releasedAt)} · {r.payload.panels.length} panels · {r.payload.hardware.lines.length} hardware SKUs · {r.payload.packaging.packages.length} packages · documents {r.payload.documents.join(", ")}{r.stoppedReason ? ` · stopped: ${r.stoppedReason}` : ""}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <a className="btn-secondary btn-sm" href={`/admin/orders/${order.id}/release/${r.releaseKey}/cutlist.csv`}>Cut list CSV</a>
                      <a className="btn-secondary btn-sm" href={`/admin/orders/${order.id}/release/${r.releaseKey}/operations.csv`}>Operations CSV</a>
                      <a className="btn-secondary btn-sm" href={`/admin/orders/${order.id}/release/${r.releaseKey}/package`}>Release JSON</a>
                      <Link className="btn-secondary btn-sm" href={`/admin/orders/${order.id}/release/${r.releaseKey}/labels`}>Labels</Link>
                      <Link className="btn-secondary btn-sm" href={`/admin/orders/${order.id}/release/${r.releaseKey}/packing`}>Packing list</Link>
                      <Link className="btn-secondary btn-sm" href={`/guide/${r.releaseKey}`}>Public guide (QR)</Link>
                      <Link className="btn-secondary btn-sm" href={`/orders/${order.id}/assembly?t=${order.accessToken}`}>Assembly guide</Link>
                      {r.status === "active" && <StepForm orderId={order.id} intent="stop_release" label="Stop release" cls="btn-danger btn-sm" withText placeholder="Reason" confirm="Stop this release? Production must halt." />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Production -------------------------------------------------- */}
          {b.release && (
            <section className="card" id="production">
              <h2 className="font-semibold">Shop floor — release {b.release.releaseKey}</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {order.status === "released" && <StepForm orderId={order.id} intent="start_production" label="Start production" cls="btn-primary btn-sm" />}
                {order.status === "in_production" && <StepForm orderId={order.id} intent="start_qc" label="Start QC and packing" cls="btn-primary btn-sm" />}
                {order.status === "qc_packing" && <StepForm orderId={order.id} intent="ship" label="Dispatch" cls="btn-primary btn-sm" disabled={shipBlockers.length > 0} withText placeholder="Carrier / driver" />}
                {order.status === "shipped" && <StepForm orderId={order.id} intent="delivered" label="Mark delivered" cls="btn-primary btn-sm" />}
                {order.status === "delivered" && <StepForm orderId={order.id} intent="complete" label="Complete (assembly feedback received)" cls="btn-primary btn-sm" />}
                <StepForm orderId={order.id} intent="open_block" label="Open block" cls="btn-danger btn-sm" withText placeholder="What is wrong" />
              </div>
              {blocks.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {blocks.map((bl) => (
                    <li key={bl.id} className="flex items-center justify-between rounded border border-red-200 bg-red-50 px-3 py-1.5 text-red-900">
                      <span>{bl.reason}</span>
                      <StepForm orderId={order.id} intent="close_block" label="Close" cls="btn-secondary btn-sm" blockId={bl.id} withText placeholder="Resolution" />
                    </li>
                  ))}
                </ul>
              )}
              {order.status === "qc_packing" && shipBlockers.length > 0 && (
                <details className="mt-3 text-sm"><summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-amber-800">{shipBlockers.length} dispatch check(s) outstanding</summary><ul className="mt-1 list-disc pl-5 text-ink-soft">{shipBlockers.map((s) => <li key={s}>{s}</li>)}</ul></details>
              )}

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="text-sm font-semibold">Panel inspection (key dimensions, holes, edges, surface, label)</h3>
                  <table className="table mt-2 text-xs">
                    <thead><tr><th>Label</th><th>Panel</th><th>Cut size</th><th>Result</th><th /></tr></thead>
                    <tbody>
                      {b.release.payload.panels.map((p) => {
                        const r = latest.get(p.id);
                        return (
                          <tr key={p.id}>
                            <td className="font-mono font-semibold">{p.label}</td>
                            <td>{p.name}</td>
                            <td className="tabular-nums">{mm(p.cut.length_um)} × {mm(p.cut.width_um)}</td>
                            <td>{r ? <Pill tone={r.pass ? "good" : "bad"}>{r.pass ? "pass" : "fail"}</Pill> : <Pill>pending</Pill>}</td>
                            <td>
                              <ActionForm action={inspectPanel} hideSubmit className="flex items-center gap-1">
                                <input type="hidden" name="orderId" value={order.id} />
                                <input type="hidden" name="releaseKey" value={b.release!.releaseKey} />
                                <input type="hidden" name="panelId" value={p.id} />
                                <input name="notes" className="input w-28 py-1 text-xs" placeholder="note" />
                                <button name="result" value="pass" className="btn-secondary btn-sm" type="submit">Pass</button>
                                <button name="result" value="fail" className="btn-danger btn-sm" type="submit">Fail</button>
                              </ActionForm>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Packing (weigh, verify contents against list)</h3>
                  <ul className="mt-2 space-y-2 text-xs">
                    {b.release.payload.packaging.packages.map((pkg) => {
                      const done = packed.get(pkg.code);
                      return (
                        <li key={pkg.code} className="rounded-md border border-line p-2">
                          <div className="flex items-center justify-between">
                            <span><span className="font-mono font-semibold">{pkg.code}</span> {pkg.title} · plan {pkg.weight_kg} kg · {mm(pkg.outer.length_um)} × {mm(pkg.outer.width_um)} × {mm(pkg.outer.height_um)}{pkg.exceedsParcelLimits ? " · LONG ITEM" : ""}</span>
                            {done ? <Pill tone="good">packed {done.weight_kg} kg</Pill> : <Pill>pending</Pill>}
                          </div>
                          <p className="mt-1 text-ink-soft">{pkg.contents.map((c) => c.label).join(" · ")}</p>
                          {!done && (
                            <ActionForm action={packPackage} hideSubmit className="mt-2 flex flex-wrap items-center gap-2">
                              <input type="hidden" name="orderId" value={order.id} />
                              <input type="hidden" name="releaseKey" value={b.release!.releaseKey} />
                              <input type="hidden" name="code" value={pkg.code} />
                              <input name="weight_kg" type="number" step="0.01" className="input w-24 py-1 text-xs" placeholder="kg" required />
                              <label className="flex items-center gap-1"><input type="checkbox" name="verified" /> contents verified</label>
                              <button type="submit" className="btn-secondary btn-sm">Packed</button>
                            </ActionForm>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </section>
          )}

          {/* After-sales -------------------------------------------------- */}
          <section className="card" id="cases">
            <h2 className="font-semibold">After-sales cases</h2>
            {b.cases.length === 0 ? <p className="mt-1 text-sm text-ink-soft">No cases.</p> : (
              <ul className="mt-3 space-y-3">
                {b.cases.map((c) => (
                  <li key={c.id} className="rounded-md border border-line p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span><span className="font-mono text-xs">{c.id}</span> · <strong>{c.partRef}</strong> ({c.partKind}) · <Pill tone={c.severity === "safety" ? "bad" : c.severity === "blocking" ? "warn" : "neutral"}>{c.severity}</Pill></span>
                      <span className="text-xs text-ink-soft">opened {dateTime(c.createdAt)} · release {c.releaseKey ?? "—"} · <Pill tone={c.status === "resolved" || c.status === "closed" ? "good" : c.status === "responded" ? "info" : "warn"}>{c.status}</Pill></span>
                    </div>
                    <p className="mt-1">{c.symptom}</p>
                    {c.photoRefs.length > 0 && <p className="text-xs text-ink-soft">Photos: {c.photoRefs.join(", ")}</p>}
                    <ActionForm action={updateServiceCase} submitLabel="Update case" submitClassName="btn-secondary btn-sm" className="mt-2 grid gap-2 md:grid-cols-4">
                      <input type="hidden" name="caseId" value={c.id} />
                      <input type="hidden" name="orderId" value={order.id} />
                      <select name="status" className="input" defaultValue={c.status}><option value="open">open</option><option value="responded">responded</option><option value="resolved">resolved</option><option value="closed">closed</option></select>
                      <select name="cause" className="input" defaultValue={c.cause ?? ""}>
                        <option value="">cause…</option>
                        {["measurement_or_requirement", "parameter_rule", "machining", "hardware", "label_sorting", "packaging_transport", "guide", "customer_assembly", "unknown"].map((x) => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}
                      </select>
                      <input name="responsibility" className="input" placeholder="responsibility" defaultValue={c.responsibility ?? ""} />
                      <input name="cost" type="number" step="0.01" className="input" placeholder="cost A$" defaultValue={c.costCents ? c.costCents / 100 : ""} />
                      <input name="resolution" className="input md:col-span-4" placeholder="Resolution (e.g. re-cut A07 from release REL-…, shipped 12/09)" defaultValue={c.resolution ?? ""} />
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Costs -------------------------------------------------------- */}
          <section className="card" id="costs">
            <h2 className="font-semibold">Actual costs and contribution</h2>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <ActionForm action={addCost} submitLabel="Add cost" submitClassName="btn-secondary btn-sm" className="rounded-md border border-line bg-stone-50 p-3 text-sm">
                <input type="hidden" name="orderId" value={order.id} />
                <div className="grid grid-cols-3 gap-2">
                  <label className="col-span-1"><span className="label">Category</span><select name="category" className="input">{COST_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select></label>
                  <label><span className="label">A$ ex GST</span><input name="amount" type="number" step="0.01" className="input" required /></label>
                  <label><span className="label">Minutes</span><input name="minutes" type="number" className="input" /></label>
                </div>
                <input name="note" className="input mt-2" placeholder="Note" />
              </ActionForm>
              {b.quote && (
                <ActionForm action={copyQuoteEstimateCosts} submitLabel="Copy quote estimates into costs" submitClassName="btn-secondary btn-sm" className="mt-2">
                  <input type="hidden" name="orderId" value={order.id} />
                  <p className="text-xs text-ink-soft">Fills manufacturing and delivery lines from the formal quote so you can overwrite them with actuals. Does not include platform margin or GST.</p>
                </ActionForm>
              )}
              <div className="text-sm">
                <table className="table text-xs">
                  <tbody>
                    <tr><td>Revenue ex GST</td><td className="text-right tabular-nums">{money(contrib.revenueEx)}</td></tr>
                    <tr><td>− Manufacturing</td><td className="text-right tabular-nums">{money(contrib.manufacturing)}</td></tr>
                    <tr><td className="font-medium">Product gross margin</td><td className="text-right font-medium tabular-nums">{money(contrib.grossMargin)}</td></tr>
                    <tr><td>− Fulfilment, engineering, support, rework</td><td className="text-right tabular-nums">{money(contrib.fulfilment)}</td></tr>
                    <tr><td>− After-sales case costs</td><td className="text-right tabular-nums">{money(contrib.serviceCosts)}</td></tr>
                    <tr><td className="font-medium">CM1</td><td className="text-right font-medium tabular-nums">{money(contrib.cm1)}</td></tr>
                    <tr><td>− Acquisition / channel, other</td><td className="text-right tabular-nums">{money(contrib.acquisition + contrib.other)}</td></tr>
                    <tr><td className="font-semibold">CM2</td><td className="text-right font-semibold tabular-nums">{money(contrib.cm2)} {contrib.cm2Rate !== null && <span className="text-ink-soft">({(contrib.cm2Rate * 100).toFixed(1)}%)</span>}</td></tr>
                  </tbody>
                </table>
                {contrib.missingCategories.length > 0 && <p className="mt-2 text-xs text-amber-800">Not yet recorded (not assumed zero): {contrib.missingCategories.map((c) => c.replace(/_/g, " ")).join(", ")}.</p>}
                <ul className="mt-2 space-y-0.5 text-xs text-ink-soft">
                  {b.costs.map((c) => <li key={c.id}>{c.category.replace(/_/g, " ")} {money(c.amountCents)}{c.minutes ? ` · ${c.minutes} min` : ""} · {c.note ?? ""} · {dateTime(c.createdAt)}</li>)}
                </ul>
              </div>
            </div>
          </section>
        </div>

        {/* Timeline ----------------------------------------------------- */}
        <aside className="space-y-4">
          <section className="card text-sm">
            <h3 className="font-semibold">Timeline</h3>
            <ul className="mt-2 space-y-1.5 text-xs">
              {b.events.map((e) => (
                <li key={e.id} className="border-l-2 border-line pl-2">
                  <span className="font-medium">{e.kind.replace(/_/g, " ")}</span> · {e.actor} · {dateTime(e.createdAt)}
                  <div className="text-ink-soft">{summarise(e.payload)}</div>
                </li>
              ))}
              {b.events.length === 0 && <li className="text-ink-soft">No production events yet.</li>}
            </ul>
          </section>
          <section className="card text-sm">
            <h3 className="font-semibold">Note</h3>
            <StepForm orderId={order.id} intent="note" label="Add note" cls="btn-secondary btn-sm" withText placeholder="Internal note" block />
          </section>
        </aside>
      </div>
    </div>
  );
}

function summarise(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

function StepForm({ orderId, intent, label, cls, withText = false, placeholder, disabled = false, confirm, blockId, block = false }: { orderId: string; intent: string; label: string; cls: string; withText?: boolean; placeholder?: string; disabled?: boolean; confirm?: string; blockId?: string; block?: boolean }) {
  return (
    <ActionForm action={runProductionStep} hideSubmit className={block ? "space-y-2" : "flex items-center gap-1"} confirmText={confirm}>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="intent" value={intent} />
      {blockId && <input type="hidden" name="blockId" value={blockId} />}
      {withText && <input name="text" className={`input ${block ? "" : "w-40"} py-1 text-xs`} placeholder={placeholder} />}
      <button type="submit" className={cls} disabled={disabled}>{label}</button>
    </ActionForm>
  );
}

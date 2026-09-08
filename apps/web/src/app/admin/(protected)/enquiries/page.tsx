import { dateTime, money } from "@/lib/format";
import { listEnquiries } from "@/server/queries";

export default async function EnquiriesPage() {
  const rows = await listEnquiries();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Enquiries we could not serve</h1>
      <p className="text-sm text-ink-soft">Kept from the FR-01 gate. Demand outside the current purpose list or service area is evidence for the next expansion decision (PRD §17); nothing here is an order.</p>
      <section className="card p-0">
        <table className="table">
          <thead><tr><th className="pl-5">When</th><th>Purpose</th><th>Postcode</th><th>Budget</th><th>Timeframe</th><th>Why declined</th><th>Contact</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="pl-5 text-xs text-ink-soft">{dateTime(e.createdAt)}</td>
                <td>{e.purpose.replace(/_/g, " ")}</td>
                <td>{e.postcode}</td>
                <td>{e.budgetCents ? money(e.budgetCents) : "—"}</td>
                <td>{e.timeframe ?? "—"}{e.needsInstallation ? " · wants install" : ""}</td>
                <td className="max-w-md text-xs">{e.reasons.join(" ")}</td>
                <td className="text-xs">{e.contact}<br />{e.notes}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="px-5 py-6 text-center text-sm text-ink-soft">None yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

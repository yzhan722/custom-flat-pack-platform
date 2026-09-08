import { ActionForm } from "@/components/ActionForm";
import { Pill } from "@/components/Badges";
import { pilotPriceList } from "@/lib/catalog";
import { money } from "@/lib/format";
import { deleteServiceArea, upsertServiceArea } from "@/server/actions/admin";
import { listServiceAreas } from "@/server/queries";

export default async function ServiceAreasPage() {
  const rows = await listServiceAreas();
  const zones = pilotPriceList().delivery.zones;
  const byZone = Object.fromEntries(zones.map((z) => [z.zone, rows.filter((r) => r.zone === z.zone).length]));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Service area</h1>
        <p className="text-sm text-ink-soft">Only postcodes listed here can be quoted for local delivery (FR-01 / FUL-001). Pickup remains available everywhere. The seed 3000–3207 range is a demo until the factory city is confirmed.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {zones.map((z) => (
          <div key={z.zone} className="card p-3">
            <p className="text-xs uppercase tracking-wide text-ink-soft">Zone {z.zone}</p>
            <p className="text-lg font-semibold">{z.label}</p>
            <p className="text-sm text-ink-soft">{money(z.price_cents)} · {byZone[z.zone] ?? 0} postcodes · long items {z.allowsLongItems ? "yes" : "no"}</p>
          </div>
        ))}
        <div className="card p-3">
          <p className="text-xs uppercase tracking-wide text-ink-soft">Total</p>
          <p className="text-lg font-semibold">{rows.length} postcodes</p>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="card">
          <h2 className="font-semibold">Add or update</h2>
          <ActionForm action={upsertServiceArea} submitLabel="Save postcode" className="mt-3 space-y-2 text-sm">
            <label><span className="label">Postcode</span><input name="postcode" className="input" inputMode="numeric" placeholder="3000" required /></label>
            <label>
              <span className="label">Zone</span>
              <select name="zone" className="input">{zones.map((z) => <option key={z.zone} value={z.zone}>{z.zone} — {z.label}</option>)}</select>
            </label>
            <label><span className="label">Label</span><input name="label" className="input" defaultValue="Local zone A (demo)" /></label>
          </ActionForm>
        </section>
        <section className="card p-0">
          <table className="table">
            <thead><tr><th className="pl-5">Postcode</th><th>Zone</th><th>Label</th><th /></tr></thead>
            <tbody>
              {rows.slice(0, 80).map((r) => (
                <tr key={r.postcode}>
                  <td className="pl-5 font-mono">{r.postcode}</td>
                  <td><Pill>{r.zone}</Pill></td>
                  <td className="text-sm">{r.label}</td>
                  <td className="pr-3 text-right">
                    <ActionForm action={deleteServiceArea} hideSubmit className="inline">
                      <input type="hidden" name="postcode" value={r.postcode} />
                      <button type="submit" className="btn-danger btn-sm">Remove</button>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 80 && <p className="px-5 py-3 text-xs text-ink-soft">Showing the first 80 of {rows.length}. Search by adding a postcode above to update it.</p>}
        </section>
      </div>
    </div>
  );
}

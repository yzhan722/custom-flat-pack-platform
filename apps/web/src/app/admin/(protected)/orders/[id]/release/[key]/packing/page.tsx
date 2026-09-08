import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { mm } from "@/lib/format";
import { getRelease } from "@/server/queries";

export default async function PackingListPage({ params }: { params: Promise<{ id: string; key: string }> }) {
  const { id, key } = await params;
  const release = await getRelease(key);
  if (!release || release.orderId !== id) notFound();
  const p = release.payload;
  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Packing list — {p.releaseKey}</h1>
          <p className="text-sm text-ink-soft">Order {p.orderId} · v{p.designVersion} · {p.packaging.packages.length} packages · {p.packaging.totalWeight_kg} kg · documents: {p.documents.join(", ")}</p>
        </div>
        <PrintButton label="Print packing list" />
      </div>
      {p.packaging.packages.map((pkg) => (
        <section key={pkg.code} className="card break-inside-avoid">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold"><span className="font-mono">{pkg.code}</span> {pkg.title}</h2>
            <span className="text-sm">{mm(pkg.outer.length_um)} × {mm(pkg.outer.width_um)} × {mm(pkg.outer.height_um)} · {pkg.weight_kg} kg{pkg.exceedsParcelLimits ? " · LONG ITEM (local delivery only)" : ""}{pkg.neededFromStep ? ` · open at step ${pkg.neededFromStep}` : ""}</span>
          </div>
          <table className="table mt-2 text-sm">
            <thead><tr><th className="w-8">✓</th><th>Item</th><th>Ref</th></tr></thead>
            <tbody>
              {pkg.contents.map((c) => (
                <tr key={c.ref}><td><span className="inline-block h-4 w-4 border border-stone-500" /></td><td>{c.label}</td><td className="font-mono text-xs">{c.ref}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-soft">Weighed: ________ kg · Packed by: ________ · Checked by: ________</p>
        </section>
      ))}
      <section className="card text-sm">
        <h2 className="font-semibold">Dispatch check</h2>
        <ul className="mt-1 list-disc pl-5">
          <li>All {p.packaging.packages.length} packages present and labelled with order {p.orderId}.</li>
          <li>Hardware bags {p.hardware.bags.map((b) => b.bagCode).join(", ")} sealed.</li>
          <li>Assembly guide printed or QR sheet included.</li>
          {p.summary.antiTipRequired && <li>Toppling warning label affixed and information sheet included.</li>}
        </ul>
      </section>
    </div>
  );
}

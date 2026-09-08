import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { getRelease } from "@/server/queries";

export default async function LabelsPage({ params }: { params: Promise<{ id: string; key: string }> }) {
  const { id, key } = await params;
  const release = await getRelease(key);
  if (!release || release.orderId !== id) notFound();
  const p = release.payload;
  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Panel labels — {p.releaseKey}</h1>
          <p className="text-sm text-ink-soft">{p.labels.length} labels · order {p.orderId} · design v{p.designVersion} · QR payloads carry no personal data.</p>
        </div>
        <PrintButton label="Print labels" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {p.labels.map((l) => (
          <div key={l.panelId} className="rounded border border-stone-800 p-3 text-xs">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold">{l.label}</span>
              <span className="font-mono text-[10px]">{p.releaseKey}</span>
            </div>
            <p className="mt-1 font-medium">{l.line1.replace(`${l.label}  `, "")}</p>
            <p>{l.line2}</p>
            <p className="font-mono text-[10px] text-ink-soft">{l.qrPayload}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {p.hardware.bags.map((bag) => (
          <div key={bag.bagCode} className="rounded border border-dashed border-stone-800 p-3 text-xs">
            <p className="text-xl font-bold">Bag {bag.bagCode}</p>
            <ul className="mt-1">
              {bag.skus.map((sku) => {
                const line = p.hardware.lines.find((x) => x.sku === sku);
                return <li key={sku}>{line?.name ?? sku} × {line?.qty}</li>;
              })}
            </ul>
            <p className="mt-1 font-mono text-[10px] text-ink-soft">{p.releaseKey}</p>
          </div>
        ))}
      </div>
      {p.summary.antiTipRequired && (
        <div className="rounded border-2 border-amber-600 bg-amber-50 p-4 text-sm">
          <p className="font-bold uppercase">Warning — toppling hazard</p>
          <p className="mt-1">This furniture must be secured to the wall using the restraint kit supplied (bag H09). Children have died from furniture tipping over. Do not place heavy items on the top. Permanent label to be affixed to the rear of the top panel; the same information appears in the assembly guide and at the point of sale (Australian mandatory information standard).</p>
        </div>
      )}
    </div>
  );
}

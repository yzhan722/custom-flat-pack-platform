import { notFound } from "next/navigation";
import { AssemblyGuideView } from "@/components/AssemblyGuideView";
import { Page } from "@/components/SiteChrome";
import { PrintButton } from "@/components/PrintButton";
import { getRelease } from "@/server/queries";

export const dynamic = "force-dynamic";

/**
 * Public assembly entry from a panel QR (PRD FR-11, §11). The URL contains only
 * the release key and part id — no customer name, address or phone. It does not
 * grant access to the rest of the order.
 */
export default async function PublicGuidePage({ params, searchParams }: { params: Promise<{ releaseKey: string }>; searchParams: Promise<{ part?: string }> }) {
  const { releaseKey } = await params;
  const { part } = await searchParams;
  const release = await getRelease(releaseKey);
  if (!release || release.status === "stopped") notFound();
  const p = release.payload;
  const query = part
    ? p.panels.find((x) => x.id === part)?.label ?? p.hardware.bags.find((b) => b.bagCode === part)?.bagCode ?? part
    : "";
  return (
    <Page>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Release {p.releaseKey} · design v{p.designVersion}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Assembly guide</h1>
          <p className="mt-1 text-sm text-ink-soft">{p.summary.finished_mm.width} × {p.summary.finished_mm.height} × {p.summary.finished_mm.depth} mm · {p.summary.panelCount} panels. This page does not show customer or payment details.</p>
        </div>
        <PrintButton />
      </div>
      <div className="mt-6">
        <AssemblyGuideView
          guide={p.assembly}
          cabinet={{
            design: p.design,
            versions: p.versions,
            dims: p.dims,
            modules: p.modules,
            panels: p.panels,
            joints: p.joints,
            antiTipRequired: p.summary.antiTipRequired,
            totals: { panelCount: p.panels.length, areaByMaterial_m2: {}, edgeBandLength_m: 0, drillCount: 0, pocketCount: 0, weight_kg: p.summary.weight_kg },
          }}
          bom={p.hardware}
          releaseKey={p.releaseKey}
          initialQuery={query}
        />
      </div>
    </Page>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { catalogueSellable, defaultDesign, pendingValidationItems, runEngineering, VALIDATION_ITEM_KEYS } from "@cfp/core";
import { ElevationDrawing } from "@/components/ElevationDrawing";
import { Page } from "@/components/SiteChrome";
import { Pill } from "@/components/Badges";
import { catalog, pilotFactory, pilotPriceList } from "@/lib/catalog";
import { money, titleCase } from "@/lib/format";

export default async function TemplateDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let ctx;
  try {
    ctx = catalog.resolveTemplate(id);
  } catch {
    notFound();
  }
  const t = ctx.template;
  const sample = defaultDesign(ctx, { purpose: t.supportedPurposes[0]!, deliveryPostcode: "3000", width_mm: 1200 });
  const result = runEngineering({ design: sample, catalog, factory: pilotFactory(), priceList: pilotPriceList(), measurement: null, resolveZone: () => pilotPriceList().delivery.zones[0] ?? null });
  const sellable = catalogueSellable(t);
  const pending = pendingValidationItems(t);
  return (
    <Page>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Template {t.code} v{t.version} · {t.nameZh}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{t.name}</h1>
          <p className="mt-2 max-w-prose text-ink-soft">{t.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={sellable ? "good" : "warn"}>{sellable ? "Approved for sale" : `Not sellable: ${pending.join(", ")}`}</Pill>
          <Link href={`/start?template=${t.id}`} className="btn-primary">Start with this template</Link>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section className="card">
            <h2 className="font-semibold">Example: 1,200 mm wide, {sample.finished.height_mm} mm high, {sample.finished.depth_mm} mm deep</h2>
            {result.cabinet && <div className="mt-3"><ElevationDrawing cabinet={result.cabinet} /></div>}
            {result.price && <p className="mt-2 text-sm text-ink-soft">This example would be about {money(result.price.totalIncGst_cents)} incl. GST and local delivery; {result.cabinet?.panels.length} panels, {result.packaging?.packages.length} packages, roughly {result.assembly?.estimatedMinutes} minutes to assemble.</p>}
          </section>

          <section className="card">
            <h2 className="font-semibold">Approved uses and limits</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {t.supportedPurposes.map((p) => <Pill key={p} tone="good">{catalog.getPurpose(p).label}</Pill>)}
            </ul>
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-ink-soft">
              {t.warnings.map((w) => <li key={w}>{w}</li>)}
              <li>Rated {ctx.construction.shelfLoadRating_kg ?? "—"} kg per shelf evenly distributed and {ctx.construction.topLoadRating_kg ?? "—"} kg on the top (placeholder values pending physical testing).</li>
            </ul>
          </section>

          <section className="card">
            <h2 className="font-semibold">Tools you need</h2>
            <ul className="mt-2 list-disc pl-5 text-sm text-ink-soft">
              {t.toolsRequired.map((tool) => <li key={tool}>{tool}</li>)}
            </ul>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="card text-sm">
            <h3 className="font-semibold">Materials and hardware</h3>
            <dl className="mt-2 space-y-1">
              <div><dt className="text-ink-soft">Board</dt><dd>{ctx.material.name}</dd></div>
              <div><dt className="text-ink-soft">Edge band</dt><dd>{ctx.edgeBand.name}</dd></div>
              <div><dt className="text-ink-soft">Back</dt><dd>{ctx.backPanel.name}</dd></div>
              <div><dt className="text-ink-soft">Hardware system</dt><dd>{ctx.hardware.name}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-ink-soft">Items marked “placeholder” are development stand-ins. Engineering must register supplier SKUs before the first sale; automated checks flag this on every order.</p>
          </section>
          <section className="card text-sm">
            <h3 className="font-semibold">Engineering validation pack</h3>
            <ul className="mt-2 space-y-1">
              {VALIDATION_ITEM_KEYS.map((k) => (
                <li key={k} className="flex items-center justify-between gap-2">
                  <span>{titleCase(k)}</span>
                  <Pill tone={t.validationPack[k].status === "complete" ? "good" : "warn"}>{t.validationPack[k].status}</Pill>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </Page>
  );
}

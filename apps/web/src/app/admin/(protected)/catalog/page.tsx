import { RULES, RULE_SET_VERSION, VALIDATION_ITEM_KEYS, catalogueSellable } from "@cfp/core";
import { Pill } from "@/components/Badges";
import { catalog, pilotFactory, pilotPriceList } from "@/lib/catalog";
import { mm, money, titleCase } from "@/lib/format";
import { DEMO_SERVICE_AREAS } from "@/db/seed-data";

export default function CatalogPage() {
  const templates = catalog.listTemplates();
  const factory = pilotFactory();
  const pl = pilotPriceList();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Catalogue, factory and rules</h1>
        <p className="text-sm text-ink-soft">Versioned in code (<code>@cfp/core</code>). Anything marked provisional is a development placeholder; the rule engine flags it (CAT-002) on every order until supplier data is registered.</p>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        {templates.map((t) => {
          const ctx = catalog.resolveTemplate(t.id);
          return (
            <div key={t.id} className="card text-sm">
              <div className="flex items-center justify-between"><h2 className="font-semibold">{t.id} v{t.version} — {t.name}</h2><Pill tone={catalogueSellable(t) ? "good" : "warn"}>{t.status}{catalogueSellable(t) ? " · sellable" : ""}</Pill></div>
              <p className="mt-1 text-ink-soft">{t.nameZh} · purposes: {t.supportedPurposes.join(", ")}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-ink-soft">Width</dt><dd>{t.domain.width_mm.min}–{t.domain.width_mm.max} mm</dd>
                <dt className="text-ink-soft">Heights / depths</dt><dd>{t.domain.heights_mm.join("/")} · {t.domain.depths_mm.join("/")}</dd>
                <dt className="text-ink-soft">Modules</dt><dd>{t.domain.moduleCount.min}–{t.domain.moduleCount.max} × {t.domain.moduleWidth_mm.min}–{t.domain.moduleWidth_mm.max} mm · kinds {t.moduleKindsAllowed.join("/")}</dd>
                <dt className="text-ink-soft">Material</dt><dd>{ctx.material.id} v{ctx.material.version} <Pill tone={ctx.material.status === "registered" ? "good" : "warn"}>{ctx.material.status}</Pill></dd>
                <dt className="text-ink-soft">Hardware</dt><dd>{ctx.hardware.id} v{ctx.hardware.version} <Pill tone={ctx.hardware.status === "registered" ? "good" : "warn"}>{ctx.hardware.status}</Pill></dd>
                <dt className="text-ink-soft">Construction</dt><dd>{ctx.construction.id} v{ctx.construction.version} · shelf {ctx.construction.shelfLoadRating_kg} kg · top {ctx.construction.topLoadRating_kg} kg · span ≤ {mm(ctx.construction.maxShelfSpan_um ?? 0)} · restraint from {mm(ctx.construction.antiTipRequiredFromHeight_um)}</dd>
              </dl>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Validation pack</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {VALIDATION_ITEM_KEYS.map((k) => <li key={k} className="flex justify-between gap-2"><span>{titleCase(k)}</span><span className="text-right text-ink-soft">{t.validationPack[k].status} · {t.validationPack[k].evidence}</span></li>)}
              </ul>
            </div>
          );
        })}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="card text-sm">
          <h2 className="font-semibold">Factory {factory.id} v{factory.version} <Pill tone="warn">{factory.status}</Pill></h2>
          <ul className="mt-2 space-y-0.5 text-xs">
            <li>Sheet {mm(factory.sheet.length_um)} × {mm(factory.sheet.width_um)}; panel {mm(factory.minPanel.length_um)}×{mm(factory.minPanel.width_um)} – {mm(factory.maxPanel.length_um)}×{mm(factory.maxPanel.width_um)}</li>
            <li>Thicknesses {factory.thicknesses_um.map((t) => mm(t)).join(", ")}; edge band {factory.edgeBandThicknesses_um.map((t) => mm(t)).join(", ")}</li>
            <li>Face drilling {factory.faceDrilling ? "yes" : "no"} · horizontal boring {factory.horizontalBoring ? "yes" : "no"} · grooving {factory.grooving ? "yes" : "no"} · pockets {factory.pocketMilling ? "yes" : "no"} · labels {factory.labelPrinter ? "yes" : "no"}</li>
            <li>Local delivery ≤ {mm(factory.delivery.localMaxLength_um)} / {factory.delivery.localMaxWeight_kg} kg; parcel ≤ {mm(factory.delivery.parcelMaxLength_um)} / {factory.delivery.parcelMaxWeight_kg} kg / {factory.delivery.parcelMaxVolume_m3} m³</li>
            <li>Capacity {factory.capacity.sheetsPerDay} sheets/day (nominal, unverified)</li>
          </ul>
        </div>
        <div className="card text-sm">
          <h2 className="font-semibold">Price list {pl.id} v{pl.version} <Pill tone="warn">{pl.status}</Pill></h2>
          <ul className="mt-2 space-y-0.5 text-xs">
            {Object.entries(pl.material).map(([k, v]) => <li key={k}>{k}: {money(v.perM2_cents)}/m² + {v.wasteFactor * 100}% nesting</li>)}
            <li>Edge band {money(pl.edgeBand.perM_cents + pl.edgeBand.applicationPerM_cents)}/m · CNC {money(pl.machining.perPanel_cents)}/panel, {money(pl.machining.perDrill_cents)}/hole, {money(pl.machining.perPocket_cents)}/pocket, {money(pl.machining.perOrderSetup_cents)} setup</li>
            <li>Labour {money(pl.labour.qcSortPackPerOrder_cents)} + {money(pl.labour.perPanel_cents)}/panel · engineering {money(pl.labour.engineeringReviewPerOrder_cents)}</li>
            <li>Overhead {pl.overheadRate * 100}% · reserve {pl.riskReserveRate * 100}% · platform {pl.platformMarginRate * 100}% · GST {pl.gstRate * 100}%</li>
            <li>Delivery {pl.delivery.zones.map((z) => `${z.zone} ${money(z.price_cents)}`).join(", ")} · pickup {money(pl.delivery.pickup_cents)} · quotes valid {pl.quoteValidityDays} days</li>
          </ul>
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Service area (demo seed)</p>
          <p className="text-xs">{DEMO_SERVICE_AREAS.length} postcodes: {DEMO_SERVICE_AREAS[0]?.postcode}–{DEMO_SERVICE_AREAS[DEMO_SERVICE_AREAS.length - 1]?.postcode}</p>
        </div>
        <div className="card text-sm">
          <h2 className="font-semibold">Rule set {RULE_SET_VERSION}</h2>
          <ul className="mt-2 max-h-80 space-y-0.5 overflow-auto text-xs">
            {RULES.map((r) => <li key={r.id}><span className="font-mono">{r.id}</span> <span className="text-ink-soft">[{r.category}]</span> {r.description}</li>)}
          </ul>
        </div>
      </section>
    </div>
  );
}

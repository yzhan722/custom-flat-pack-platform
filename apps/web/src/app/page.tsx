import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { catalog } from "@/lib/catalog";
import { money } from "@/lib/format";

export default function HomePage() {
  const templates = catalog.listTemplates();
  return (
    <Page>
      <section className="grid items-center gap-10 py-6 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand">Made-to-measure low storage · pilot</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight md:text-5xl">Tell us the width. We turn it into furniture you can assemble.</h1>
          <p className="mt-4 max-w-prose text-lg text-ink-soft">
            A floor-standing storage cabinet cut to your exact width — 600 to 1,800 mm — with open shelves or doors. Every panel arrives cut, edged, drilled and labelled, with numbered hardware bags and a step-by-step guide written for your order.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/start" className="btn-primary">Start a design</Link>
            <Link href="/templates" className="btn-secondary">See the two templates</Link>
          </div>
          <p className="mt-4 text-sm text-ink-soft">Local delivery or pickup only during the pilot. Prices from about {money(Math.min(...templates.map((t) => t.indicativePrice_cents.min)))} incl. GST.</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">What arrives at your door</p>
          <ul className="mt-3 space-y-3 text-sm">
            <li className="flex gap-3"><span className="mt-0.5 h-5 w-5 shrink-0 rounded bg-brand-soft text-center text-xs font-bold leading-5 text-brand">1</span><span><strong>Labelled panels</strong> — A01, A02… every part matches the guide, edges banded where you see them, holes pre-drilled.</span></li>
            <li className="flex gap-3"><span className="mt-0.5 h-5 w-5 shrink-0 rounded bg-brand-soft text-center text-xs font-bold leading-5 text-brand">2</span><span><strong>Numbered hardware bags</strong> — connectors, hinges, shelf pins and feet counted for your cabinet, plus a wall restraint kit where required.</span></li>
            <li className="flex gap-3"><span className="mt-0.5 h-5 w-5 shrink-0 rounded bg-brand-soft text-center text-xs font-bold leading-5 text-brand">3</span><span><strong>Your assembly guide</strong> — on your phone or printed, with the exact parts and quantities for each step. About 60–120 minutes with a screwdriver and the supplied hex key.</span></li>
          </ul>
        </div>
      </section>

      <section id="how" className="mt-14">
        <h2 className="text-2xl font-semibold">How it works</h2>
        <ol className="mt-5 grid gap-4 md:grid-cols-4">
          {[
            ["Check fit", "Tell us the use, your postcode and where it goes. We only take orders we can make and deliver."],
            ["Configure", "Set the width, height and depth, choose shelves or doors, and see the 3D preview, checks and estimate update live."],
            ["Review and quote", "An engineer checks every order. You receive a formal quote, drawing and delivery date, then confirm and pay a deposit."],
            ["Build it", "We cut, edge, drill, label and pack in assembly order. You follow the guide; we help by part number if anything is wrong."],
          ].map(([t, d], i) => (
            <li key={t} className="card">
              <p className="text-xs font-semibold text-brand">Step {i + 1}</p>
              <p className="mt-1 font-semibold">{t}</p>
              <p className="mt-1 text-sm text-ink-soft">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-14">
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold">Two proven structures</h2>
          <Link href="/templates" className="text-sm underline">Details</Link>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {templates.map((t) => (
            <Link key={t.id} href={`/templates/${t.id}`} className="card block transition hover:border-brand">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Template {t.code}</p>
              <p className="mt-1 text-lg font-semibold">{t.name}</p>
              <p className="mt-1 text-sm text-ink-soft">{t.description}</p>
              <p className="mt-3 text-sm">
                {t.domain.width_mm.min}–{t.domain.width_mm.max} mm wide · {t.domain.heights_mm.join(" / ")} mm high · {t.domain.depths_mm.join(" / ")} mm deep
              </p>
              <p className="mt-1 text-sm font-medium">{money(t.indicativePrice_cents.min)} – {money(t.indicativePrice_cents.max)} incl. GST</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-14 grid gap-4 md:grid-cols-3">
        <div className="card">
          <p className="font-semibold">What we do not make (yet)</p>
          <p className="mt-1 text-sm text-ink-soft">Drawers, TV units, wall-hung or tall cabinets, kitchens, laundries, bathrooms, caravans, and anything scribed to a wall or cut on site. If your use is on that list we will say so before you spend time configuring.</p>
        </div>
        <div className="card">
          <p className="font-semibold">Safety comes with the cabinet</p>
          <p className="mt-1 text-sm text-ink-soft">The 750 mm height must be restrained to the wall. We include the restraint kit and permanent warning label required in Australia, and ask about your wall before we quote.</p>
        </div>
        <div className="card">
          <p className="font-semibold">Replacement by part number</p>
          <p className="mt-1 text-sm text-ink-soft">Damaged or missing part? Quote the order and the label — A07, bag H03 — and we re-make exactly that from the production record. Consumer guarantees apply to made-to-order goods.</p>
        </div>
      </section>
    </Page>
  );
}

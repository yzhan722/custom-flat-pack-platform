import Link from "next/link";
import { Page } from "@/components/SiteChrome";
import { catalog } from "@/lib/catalog";
import { money } from "@/lib/format";

export default function TemplatesPage() {
  const templates = catalog.listTemplates();
  return (
    <Page>
      <h1 className="text-3xl font-semibold tracking-tight">Templates</h1>
      <p className="mt-2 max-w-prose text-ink-soft">Two validated structures, one white 18 mm board, one connector system. Everything else — width, height, depth, modules, shelves, doors — is yours to set within the approved ranges.</p>
      <div className="mt-6 grid gap-5 md:grid-cols-2">
        {templates.map((t) => (
          <article key={t.id} className="card flex flex-col">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Template {t.code} · {t.nameZh}</p>
            <h2 className="mt-1 text-xl font-semibold">{t.name}</h2>
            <p className="mt-1 text-sm text-ink-soft">{t.description}</p>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-soft">Width</dt><dd>{t.domain.width_mm.min}–{t.domain.width_mm.max} mm, any whole mm</dd>
              <dt className="text-ink-soft">Height</dt><dd>{t.domain.heights_mm.join(" / ")} mm</dd>
              <dt className="text-ink-soft">Depth</dt><dd>{t.domain.depths_mm.join(" / ")} mm</dd>
              <dt className="text-ink-soft">Modules</dt><dd>{t.domain.moduleCount.min}–{t.domain.moduleCount.max}, each {t.domain.moduleWidth_mm.min}–{t.domain.moduleWidth_mm.max} mm</dd>
              <dt className="text-ink-soft">Shelves</dt><dd>up to {t.domain.shelvesPerModule.max} adjustable per module</dd>
              <dt className="text-ink-soft">Indicative price</dt><dd>{money(t.indicativePrice_cents.min)} – {money(t.indicativePrice_cents.max)}</dd>
            </dl>
            <div className="mt-auto flex gap-2 pt-5">
              <Link href={`/templates/${t.id}`} className="btn-secondary">Details</Link>
              <Link href={`/start?template=${t.id}`} className="btn-primary">Start with this</Link>
            </div>
          </article>
        ))}
      </div>
    </Page>
  );
}

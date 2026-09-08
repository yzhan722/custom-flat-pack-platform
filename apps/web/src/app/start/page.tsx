import { Page } from "@/components/SiteChrome";
import { catalog } from "@/lib/catalog";
import { StartForm } from "./StartForm";

export const dynamic = "force-dynamic";

export default async function StartPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const { template } = await searchParams;
  const templates = catalog.listTemplates();
  return (
    <Page>
      <h1 className="text-3xl font-semibold tracking-tight">Before you design</h1>
      <p className="mt-2 max-w-prose text-ink-soft">Three quick questions decide whether the pilot range can serve you. If yes, you go straight to the configurator with a draft based on your answers.</p>
      <div className="mt-6">
        <StartForm purposes={catalog.listPurposes()} templates={templates} defaultTemplate={template && templates.some((t) => t.id === template) ? template : templates[0]!.id} />
      </div>
    </Page>
  );
}

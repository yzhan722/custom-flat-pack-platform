import { NextResponse } from "next/server";
import { describeDesignDiff, MeasurementSetSchema, proposeChange, safeParseDesignSpec } from "@cfp/core";
import { catalog } from "@/lib/catalog";
import { evaluateDesign, toLive } from "@/lib/engineering";

/**
 * FR-04: natural-language change proposals. The proposal is evaluated with the
 * same rules and pricing as a manual edit and returned as a preview; the client
 * applies it only when the customer accepts.
 */
export async function POST(req: Request) {
  let body: { utterance?: string; design?: unknown; measurement?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const utterance = String(body.utterance ?? "").trim();
  if (!utterance) return NextResponse.json({ error: "Empty request" }, { status: 400 });
  const parsed = safeParseDesignSpec(body.design);
  if (!parsed.success) return NextResponse.json({ error: "Current design is invalid" }, { status: 400 });
  const design = parsed.data;
  const ctx = catalog.resolveTemplate(design.templateId, design.templateVersion);
  const proposal = proposeChange(utterance, design, ctx);
  if (proposal.kind !== "change") return NextResponse.json({ proposal });

  const measurement = body.measurement ? MeasurementSetSchema.safeParse(body.measurement) : null;
  const ms = measurement && measurement.success ? measurement.data : null;
  const [before, after] = await Promise.all([evaluateDesign(design, ms), evaluateDesign(proposal.nextDesign, ms)]);
  return NextResponse.json({
    proposal,
    diff: describeDesignDiff(design, proposal.nextDesign),
    priceBefore_cents: before.price?.totalIncGst_cents ?? null,
    priceAfter_cents: after.price?.totalIncGst_cents ?? null,
    next: toLive(after),
  });
}

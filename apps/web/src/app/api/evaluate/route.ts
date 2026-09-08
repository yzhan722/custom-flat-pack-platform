import { NextResponse } from "next/server";
import { MeasurementSetSchema } from "@cfp/core";
import { evaluateDesign, toLive } from "@/lib/engineering";

/**
 * Live evaluation for the configurator. Stateless: the client sends the whole
 * draft, the server runs the deterministic kernel and returns rules, price and
 * geometry. Nothing is persisted until the customer saves a version.
 */
export async function POST(req: Request) {
  let body: { design?: unknown; measurement?: unknown };
  try {
    body = (await req.json()) as { design?: unknown; measurement?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const measurement = body.measurement ? MeasurementSetSchema.safeParse(body.measurement) : null;
  const result = await evaluateDesign(body.design ?? {}, measurement && measurement.success ? measurement.data : null);
  return NextResponse.json(toLive(result));
}

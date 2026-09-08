import { z } from "zod";

/**
 * MeasurementSet (PRD FR-02, §8). Finished size, available space and internal
 * requirements are stored separately, each value keeps its source so that a
 * photo estimate can never be silently promoted to production data.
 */

export const MeasurementSourceSchema = z.enum([
  "approximate",
  "manual_remeasured",
  "professional",
  "photo_estimate",
  "scan_estimate",
]);
export type MeasurementSource = z.infer<typeof MeasurementSourceSchema>;

export const MeasuredValueSchema = z.object({
  value_mm: z.number().int().positive(),
  originalValue: z.number().optional(),
  originalUnit: z.enum(["mm", "cm", "m", "in"]).optional(),
  source: MeasurementSourceSchema,
  /** Where the measurement was taken, e.g. "floor level", "at 600 mm height", "rear wall". */
  location: z.string().max(200).optional(),
  measuredAt: z.string().optional(),
  measuredBy: z.string().max(100).optional(),
});
export type MeasuredValue = z.infer<typeof MeasuredValueSchema>;

export const ObstacleSchema = z.object({
  kind: z.enum(["skirting", "power_point", "door_swing", "window", "pipe", "radiator", "existing_furniture", "other"]),
  description: z.string().max(300),
  /** Depth the obstacle protrudes into the space, if known. */
  protrusion_mm: z.number().int().min(0).optional(),
  /** Height of the obstacle from the floor, if known. */
  heightFromFloor_mm: z.number().int().min(0).optional(),
});
export type Obstacle = z.infer<typeof ObstacleSchema>;

export const EvidenceSchema = z.object({
  kind: z.enum(["photo", "sketch", "note", "scan"]),
  ref: z.string().max(500),
  caption: z.string().max(300).optional(),
});

export const MeasurementSetSchema = z.object({
  /** True when the unit must fit into a bounded space (alcove, between furniture). */
  spaceConstrained: z.boolean(),
  availableSpace: z
    .object({
      widths: z.array(MeasuredValueSchema).min(1),
      height: MeasuredValueSchema.optional(),
      depth: MeasuredValueSchema.optional(),
    })
    .optional(),
  internalRequirements: z
    .array(
      z.object({
        description: z.string().max(200),
        width_mm: z.number().int().positive().optional(),
        height_mm: z.number().int().positive().optional(),
        depth_mm: z.number().int().positive().optional(),
      }),
    )
    .default([]),
  obstacles: z.array(ObstacleSchema).default([]),
  accessPath: z
    .object({
      narrowestPassage_mm: z.number().int().positive().optional(),
      notes: z.string().max(500).optional(),
    })
    .optional(),
  evidence: z.array(EvidenceSchema).default([]),
  confirmedBy: z.string().max(100).optional(),
});
export type MeasurementSet = z.infer<typeof MeasurementSetSchema>;

export function parseMeasurementSet(input: unknown): MeasurementSet {
  return MeasurementSetSchema.parse(input);
}

/** Sources that count as verified for approval purposes. */
export const VERIFIED_SOURCES: MeasurementSource[] = ["manual_remeasured", "professional"];

export function isVerifiedSource(source: MeasurementSource): boolean {
  return VERIFIED_SOURCES.includes(source);
}

export interface SpaceAssessment {
  /** Smallest trusted width across all measured positions, or null when nothing trusted exists. */
  minTrustedWidth_mm: number | null;
  /** Smallest width across all measurements regardless of trust. */
  minAnyWidth_mm: number | null;
  /** Spread between the largest and smallest width measurement. */
  widthSpread_mm: number;
  hasOnlyVisualEstimates: boolean;
  hasVerifiedWidth: boolean;
  skirtingProtrusion_mm: number;
}

export function assessSpace(ms: MeasurementSet): SpaceAssessment {
  const widths = ms.availableSpace?.widths ?? [];
  const trusted = widths.filter((w) => isVerifiedSource(w.source));
  const all = widths.map((w) => w.value_mm);
  const visualOnly =
    widths.length > 0 && widths.every((w) => w.source === "photo_estimate" || w.source === "scan_estimate");
  const skirting = ms.obstacles
    .filter((o) => o.kind === "skirting")
    .reduce((acc, o) => Math.max(acc, o.protrusion_mm ?? 0), 0);
  return {
    minTrustedWidth_mm: trusted.length ? Math.min(...trusted.map((w) => w.value_mm)) : null,
    minAnyWidth_mm: all.length ? Math.min(...all) : null,
    widthSpread_mm: all.length ? Math.max(...all) - Math.min(...all) : 0,
    hasOnlyVisualEstimates: visualOnly,
    hasVerifiedWidth: trusted.length > 0,
    skirtingProtrusion_mm: skirting,
  };
}

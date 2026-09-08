import { z } from "zod";

/**
 * DesignSpec is the controlled expression of customer intent (PRD §8). It is
 * expressed in integer millimetres and never contains machine instructions.
 */

export const PurposeSchema = z.enum([
  "general_storage",
  "books_and_files",
  "living_room_storage",
  "display",
  "tv_stand",
  "seating",
  "aquarium",
  "wall_hung",
  "kitchen",
  "bathroom",
  "laundry",
  "outdoor",
  "vehicle",
  "children_specific",
  "commercial_heavy",
  "workbench",
  "bed",
  "tall_wardrobe",
]);

export const DoorSwingSchema = z.enum(["left", "right", "double"]);
export type DoorSwing = z.infer<typeof DoorSwingSchema>;

export const HandleOptionSchema = z.enum(["bar", "none"]);
export type HandleOption = z.infer<typeof HandleOptionSchema>;

export const WallTypeSchema = z.enum([
  "masonry",
  "plasterboard_on_stud",
  "plasterboard_unknown_structure",
  "unknown",
  "not_required",
]);
export type WallType = z.infer<typeof WallTypeSchema>;

const mm = z.number().int();

export const ModuleSpecSchema = z.object({
  kind: z.enum(["open", "door"]),
  width_mm: mm.positive(),
  shelfCount: z.number().int().min(0),
  doorSwing: DoorSwingSchema.optional(),
  handle: HandleOptionSchema.optional(),
});
export type ModuleSpec = z.infer<typeof ModuleSpecSchema>;

export const FinishedSizeSchema = z.object({
  width_mm: mm.positive(),
  height_mm: mm.positive(),
  depth_mm: mm.positive(),
});
export type FinishedSize = z.infer<typeof FinishedSizeSchema>;

export const InstallationSchema = z.object({
  wallType: WallTypeSchema,
  /** Customer acknowledged that the unit must be restrained to the wall when required. */
  antiTipAcknowledged: z.boolean(),
  deliveryPostcode: z.string().min(3).max(10),
  deliveryMethod: z.enum(["local_delivery", "pickup"]),
});
export type Installation = z.infer<typeof InstallationSchema>;

export const DesignSpecSchema = z.object({
  templateId: z.string().min(1),
  templateVersion: z.number().int().positive(),
  purpose: PurposeSchema,
  finished: FinishedSizeSchema,
  modules: z.array(ModuleSpecSchema).min(1).max(6),
  topPanelStyle: z.enum(["single", "per_module"]),
  installation: InstallationSchema,
  measurementSetId: z.string().optional(),
  notes: z.string().max(2000).optional(),
});
export type DesignSpec = z.infer<typeof DesignSpecSchema>;

export function parseDesignSpec(input: unknown): DesignSpec {
  return DesignSpecSchema.parse(input);
}

export function safeParseDesignSpec(input: unknown) {
  return DesignSpecSchema.safeParse(input);
}

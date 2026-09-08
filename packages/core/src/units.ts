/**
 * Length handling.
 *
 * PRD §8: internal dimensions use integer micrometres (µm) so that rounding
 * differences between tools never leak into hole positions or edge-band
 * compensation. User-facing fields are integer millimetres and carry a `_mm`
 * suffix; manufacturing fields carry `_um`.
 */

export const UM_PER_MM = 1000;

export type LengthUnit = "mm" | "cm" | "m" | "in";

export function mmToUm(mm: number): number {
  return Math.round(mm * UM_PER_MM);
}

export function umToMm(um: number): number {
  return um / UM_PER_MM;
}

/** Rounds µm to the nearest whole millimetre (used for user-facing summaries only). */
export function umToMmRounded(um: number): number {
  return Math.round(um / UM_PER_MM);
}

export function assertIntegerUm(value: number, field: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${field} must be an integer number of micrometres, got ${value}`);
  }
}

export interface UnitConversion {
  originalValue: number;
  originalUnit: LengthUnit;
  value_mm: number;
  /** True when the conversion produced a non-integer mm value that was rounded. */
  rounded: boolean;
  /** Human readable statement the user must confirm (PRD FR-02). */
  confirmation: string;
}

const FACTORS_TO_MM: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
};

/**
 * Converts an arbitrary user input to integer millimetres and returns both the
 * original and converted values so the UI can show them side by side.
 */
export function convertToMm(value: number, unit: LengthUnit): UnitConversion {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot convert non-finite value ${value}`);
  }
  const exact = value * FACTORS_TO_MM[unit];
  const value_mm = Math.round(exact);
  const rounded = Math.abs(exact - value_mm) > 1e-9;
  return {
    originalValue: value,
    originalUnit: unit,
    value_mm,
    rounded,
    confirmation: `${value} ${unit} = ${value_mm} mm${rounded ? " (rounded)" : ""}`,
  };
}

/**
 * Detects an obviously wrong magnitude. A cabinet width of 18 (someone typed cm
 * while thinking mm) or 18000 (typed in µm or repeated a digit) must not slip
 * through as a valid design.
 */
export function isPlausibleFurnitureLength(mm: number): boolean {
  return Number.isInteger(mm) && mm >= 50 && mm <= 6000;
}

export interface Size3Mm {
  width_mm: number;
  height_mm: number;
  depth_mm: number;
}

export interface Size3Um {
  width_um: number;
  height_um: number;
  depth_um: number;
}

export function size3MmToUm(s: Size3Mm): Size3Um {
  return {
    width_um: mmToUm(s.width_mm),
    height_um: mmToUm(s.height_mm),
    depth_um: mmToUm(s.depth_mm),
  };
}

/** Area of a rectangle given in µm, returned in square metres. */
export function areaUmToM2(a_um: number, b_um: number): number {
  return (a_um / 1_000_000) * (b_um / 1_000_000);
}

/** Length in µm to metres. */
export function umToM(um: number): number {
  return um / 1_000_000;
}

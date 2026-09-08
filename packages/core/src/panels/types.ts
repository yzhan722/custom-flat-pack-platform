import type { EdgeName, PanelRole } from "../catalog";
import type { DesignSpec } from "../design";
import type { Size3Um } from "../units";

/**
 * Panel-local frame: X runs along `length`, Y along `width`, origin at the
 * bottom-left corner of face A when looking at face A. Edges are named by local
 * position (`x0` left, `x1` right, `y0` bottom, `y1` top) and mapped to cabinet
 * edge names so edge-banding rules and assembly text can talk about "front".
 */
export type LocalEdge = "x0" | "x1" | "y0" | "y1";
export type Face = "A" | "B";

export type OperationPurpose =
  | "shelf_pin"
  | "hinge_plate"
  | "hinge_cup"
  | "connector_pilot"
  | "connector_pocket"
  | "handle"
  | "back_screw"
  | "foot_locate"
  | "inter_module_bolt";

export interface DrillOperation {
  kind: "DRILL";
  face: Face;
  x_um: number;
  y_um: number;
  diameter_um: number;
  depth_um: number;
  through: boolean;
  purpose: OperationPurpose;
  /** Reference to the joint this operation serves. */
  jointId: string;
}

export interface PocketOperation {
  kind: "POCKET";
  face: Face;
  x_um: number;
  y_um: number;
  length_um: number;
  width_um: number;
  depth_um: number;
  /** 0 = pocket length along local X, 90 = along local Y. */
  rotationDeg: 0 | 90;
  purpose: OperationPurpose;
  jointId: string;
}

export type Operation = DrillOperation | PocketOperation;

export interface EdgeSpec {
  edge: LocalEdge;
  cabinetEdge: EdgeName;
  banded: boolean;
  bandThickness_um: number;
}

export interface Panel {
  /** Stable structural id, e.g. `M1-SIDE_L`, `ROW-TOP`, `M2-SHELF-1`. */
  id: string;
  /** Sticker label, e.g. `A01`. Sequential in a deterministic order. */
  label: string;
  moduleIndex: number | null;
  role: PanelRole;
  name: string;
  materialId: string;
  thickness_um: number;
  finished: { length_um: number; width_um: number };
  cut: { length_um: number; width_um: number };
  edges: EdgeSpec[];
  operations: Operation[];
  faceA: string;
  faceB: string;
  weight_kg: number;
  /** Position of the panel in the cabinet frame (front-left-bottom origin), for preview. */
  placement: {
    x_um: number;
    y_um: number;
    z_um: number;
    size: Size3Um;
  };
}

export interface HardwareUse {
  sku: string;
  qty: number;
}

export type JointKind =
  | "connector"
  | "inter_module_bolt"
  | "back_screw"
  | "hinge"
  | "foot"
  | "shelf_pins"
  | "handle"
  | "anti_tip";

export interface Joint {
  id: string;
  kind: JointKind;
  moduleIndex: number | null;
  panelIds: string[];
  hardware: HardwareUse[];
  description: string;
}

export interface CompiledDoor {
  panelId: string;
  /** Which carcass side carries the hinges. */
  hingeSide: "L" | "R";
  swing: "left" | "right";
  hingeCount: number;
  hingeZ_um: number[];
}

export interface CompiledModule {
  index: number;
  kind: "open" | "door";
  offsetX_um: number;
  width_um: number;
  interior: Size3Um;
  panelIds: string[];
  /** Z of each shelf's underside relative to the bottom panel's top face. */
  shelfPositions_um: number[];
  /** Shelf-pin row numbers (1-based from the lowest row) used by each shelf. */
  shelfRows: number[];
  doors: CompiledDoor[];
}

export interface CompiledCabinet {
  design: DesignSpec;
  versions: {
    templateId: string;
    templateVersion: number;
    constructionId: string;
    constructionVersion: number;
    hardwareSystemId: string;
    hardwareSystemVersion: number;
    materialId: string;
    materialVersion: number;
    edgeBandId: string;
    edgeBandVersion: number;
    backPanelId: string;
    backPanelVersion: number;
  };
  dims: {
    finished: Size3Um;
    carcassHeight_um: number;
    sideHeight_um: number;
    sideDepth_um: number;
    footHeight_um: number;
    doorZone_um: number;
  };
  modules: CompiledModule[];
  panels: Panel[];
  joints: Joint[];
  antiTipRequired: boolean;
  totals: {
    panelCount: number;
    areaByMaterial_m2: Record<string, number>;
    edgeBandLength_m: number;
    drillCount: number;
    pocketCount: number;
    weight_kg: number;
  };
}

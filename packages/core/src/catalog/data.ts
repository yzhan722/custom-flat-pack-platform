/**
 * Development catalog.
 *
 * Every entry marked `provisional` is a placeholder that stands in for supplier
 * registered data. The rule engine never returns PASS for a design that depends
 * on provisional material or hardware, so nothing here can be mistaken for a
 * validated engineering release (PRD §2.1, §12).
 */

import { mmToUm } from "../units";
import type {
  BackPanelSku,
  ConstructionRuleSet,
  EdgeBandSku,
  FactoryCapability,
  HardwareItem,
  HardwareSystem,
  MaterialSku,
  PriceList,
  PurposeDefinition,
  Template,
  ValidationPack,
} from "./types";

export const PURPOSES: PurposeDefinition[] = [
  { id: "general_storage", label: "General storage", labelZh: "日常储物", supported: true },
  { id: "books_and_files", label: "Books and files", labelZh: "书籍／文件", supported: true },
  { id: "living_room_storage", label: "Living room storage", labelZh: "客厅储物", supported: true },
  { id: "display", label: "Display of light objects", labelZh: "轻物展示", supported: true },
  {
    id: "tv_stand",
    label: "TV stand / entertainment unit",
    labelZh: "电视柜／影音柜",
    supported: false,
    unsupportedReason:
      "TV-bearing use requires load, ventilation, cable and toppling-information validation that has not been completed for this template (PRD §2.2).",
  },
  {
    id: "seating",
    label: "Seating or standing on the unit",
    labelZh: "坐凳／站立",
    supported: false,
    unsupportedReason: "Structures intended to carry people are outside the launch scope.",
  },
  {
    id: "aquarium",
    label: "Aquarium or heavy point load",
    labelZh: "鱼缸／重点载荷",
    supported: false,
    unsupportedReason: "Heavy concentrated loads exceed the validated load statement.",
  },
  {
    id: "wall_hung",
    label: "Wall hung",
    labelZh: "悬挂／上墙承重",
    supported: false,
    unsupportedReason: "Wall-hung and wall-bearing cabinets are outside the launch scope.",
  },
  {
    id: "kitchen",
    label: "Kitchen",
    labelZh: "厨房",
    supported: false,
    unsupportedReason: "Kitchens involve appliances, benchtops, moisture and services that are not validated.",
  },
  {
    id: "bathroom",
    label: "Bathroom",
    labelZh: "浴室",
    supported: false,
    unsupportedReason: "Wet areas are outside the indoor-dry material validation.",
  },
  {
    id: "laundry",
    label: "Laundry",
    labelZh: "洗衣房",
    supported: false,
    unsupportedReason: "Laundry cabinets involve appliances and moisture and are not in the launch scope.",
  },
  {
    id: "outdoor",
    label: "Outdoor",
    labelZh: "户外",
    supported: false,
    unsupportedReason: "Materials are validated for indoor dry environments only.",
  },
  {
    id: "vehicle",
    label: "Caravan / vehicle",
    labelZh: "房车／车辆",
    supported: false,
    unsupportedReason: "Vehicle installations require separate structural and fixing engineering.",
  },
  {
    id: "children_specific",
    label: "Children-specific furniture",
    labelZh: "儿童专用家具",
    supported: false,
    unsupportedReason: "Children-specific furniture has additional requirements not covered by this template.",
  },
  {
    id: "commercial_heavy",
    label: "Commercial heavy duty",
    labelZh: "商业重载",
    supported: false,
    unsupportedReason: "Commercial heavy-duty use exceeds the validated load statement.",
  },
  {
    id: "workbench",
    label: "Workbench",
    labelZh: "工作台",
    supported: false,
    unsupportedReason: "Workbench loads and impact are outside the validated scope.",
  },
  {
    id: "bed",
    label: "Bed or bed base",
    labelZh: "床／床箱",
    supported: false,
    unsupportedReason: "Beds are outside the launch scope.",
  },
  {
    id: "tall_wardrobe",
    label: "Tall wardrobe",
    labelZh: "高衣柜",
    supported: false,
    unsupportedReason: "Tall cabinets need stability, packaging and fixing validation that is not yet complete.",
  },
];

export const MATERIAL_WHITE_MEL_18: MaterialSku = {
  id: "MAT-WHT-MEL-18",
  version: 1,
  status: "provisional",
  name: "White melamine faced particleboard 18 mm (placeholder SKU)",
  colour: "white",
  finish: "matt melamine",
  nominalThickness_um: mmToUm(18),
  thicknessTolerance_um: mmToUm(0.3),
  sheet: { length_um: mmToUm(2400), width_um: mmToUm(1200) },
  density_kg_m3: 680,
  environment: "indoor_dry",
  notes: "Replace with supplier SKU, batch, measured thickness and tolerance before sale.",
};

export const EDGE_BAND_WHITE_1: EdgeBandSku = {
  id: "EB-WHT-1",
  version: 1,
  status: "provisional",
  name: "White ABS edge band 1 mm (placeholder)",
  thickness_um: mmToUm(1),
  matchesMaterialId: MATERIAL_WHITE_MEL_18.id,
};

export const BACK_PANEL_WHITE_6: BackPanelSku = {
  id: "BK-WHT-6",
  version: 1,
  status: "provisional",
  name: "White faced back panel 6 mm (placeholder)",
  thickness_um: mmToUm(6),
  sheet: { length_um: mmToUm(2400), width_um: mmToUm(1200) },
  density_kg_m3: 750,
};

function item(
  sku: string,
  name: string,
  category: HardwareItem["category"],
  bagCode: string,
  unit: HardwareItem["unit"] = "pc",
): HardwareItem {
  return { sku, version: 1, status: "provisional", name, category, bagCode, unit };
}

export const HARDWARE_SYSTEM_KD1: HardwareSystem = {
  id: "HW-KD-01",
  version: 1,
  status: "provisional",
  name: "Face-machined knock-down connector system (placeholder values)",
  items: {
    "CN-01": item("CN-01", "Knock-down connector, face pocket type", "connector", "H01"),
    "HG-01": item("HG-01", "Concealed hinge 110°, full overlay", "hinge", "H02"),
    "HP-01": item("HP-01", "Hinge mounting plate", "hinge_plate", "H03"),
    "CC-01": item("CC-01", "Hinge cover cap", "cover_cap", "H03"),
    "SP-01": item("SP-01", "Shelf support pin 5 mm", "shelf_pin", "H04"),
    "HD-01": item("HD-01", "Bar handle 128 mm", "handle", "H05"),
    "HS-01": item("HS-01", "Handle screw M4", "handle_screw", "H05"),
    "FT-01": item("FT-01", "Adjustable foot 50 mm", "foot", "H06"),
    "FS-01": item("FS-01", "Foot plate screw", "foot_screw", "H06"),
    "BS-01": item("BS-01", "Back panel screw", "back_screw", "H07"),
    "IM-01": item("IM-01", "Inter-module connecting bolt", "inter_module_connector", "H08"),
    "AT-01": item("AT-01", "Anti-tip restraint kit (wall fixings not included)", "anti_tip_kit", "H09", "set"),
  },
  connector: {
    sku: "CN-01",
    pocketLength_um: mmToUm(40),
    pocketWidth_um: mmToUm(12),
    pocketDepth_um: mmToUm(12),
    pocketCentreFromEnd_um: mmToUm(30),
    pilotDiameter_um: mmToUm(5),
    pilotDepth_um: mmToUm(12),
    edgeInset_um: mmToUm(50),
    countByJointLength: [
      { maxLength_um: mmToUm(350), count: 2 },
      { maxLength_um: mmToUm(600), count: 2 },
      { maxLength_um: mmToUm(900), count: 3 },
    ],
  },
  hinge: {
    sku: "HG-01",
    plateSku: "HP-01",
    coverCapSku: "CC-01",
    openingAngleDeg: 110,
    cupDiameter_um: mmToUm(35),
    cupDepth_um: mmToUm(12.5),
    cupCentreFromDoorEdge_um: mmToUm(22.5),
    cupCentreFromDoorEnd_um: mmToUm(100),
    plateHoleDiameter_um: mmToUm(5),
    plateHoleDepth_um: mmToUm(12),
    plateHoleSpacing_um: mmToUm(32),
    plateCentreFromFront_um: mmToUm(37),
    countByDoorHeight: [
      { maxHeight_um: mmToUm(900), count: 2 },
      { maxHeight_um: mmToUm(1600), count: 3 },
    ],
    minDoorWidth_um: mmToUm(200),
    maxDoorWidth_um: mmToUm(600),
    maxDoorWeight_kg: 10,
  },
  shelfPin: {
    sku: "SP-01",
    holeDiameter_um: mmToUm(5),
    holeDepth_um: mmToUm(12),
    pitch_um: mmToUm(32),
    frontOffset_um: mmToUm(37),
    backOffset_um: mmToUm(37),
    firstHoleFromBottom_um: mmToUm(100),
    lastHoleFromTop_um: mmToUm(100),
    pinsPerShelf: 4,
  },
  handle: {
    sku: "HD-01",
    screwSku: "HS-01",
    holeSpacing_um: mmToUm(128),
    holeDiameter_um: mmToUm(5),
    centreFromFreeEdge_um: mmToUm(40),
    centreFromTop_um: mmToUm(100),
    screwsPerHandle: 2,
  },
  foot: {
    sku: "FT-01",
    screwSku: "FS-01",
    height_um: mmToUm(50),
    adjustMin_um: mmToUm(45),
    adjustMax_um: mmToUm(60),
    perModule: 4,
    screwsPerFoot: 4,
    plateInset_um: mmToUm(40),
  },
  backScrew: {
    sku: "BS-01",
    spacing_um: mmToUm(150),
    edgeInset_um: mmToUm(12),
  },
  interModuleConnector: {
    sku: "IM-01",
    perJoint: 3,
    holeDiameter_um: mmToUm(8),
  },
  antiTipKit: {
    sku: "AT-01",
    perRow: 1,
  },
};

export const CONSTRUCTION_LOW_CABINET_V1: ConstructionRuleSet = {
  id: "CR-LOW-01",
  version: 1,
  status: "provisional",
  name: "Low cabinet, overlay top, overlay back, full overlay doors (development defaults)",
  panelThickness_um: mmToUm(18),
  backThickness_um: mmToUm(6),
  doorClearanceDepth_um: mmToUm(2),
  doorGap_um: mmToUm(2),
  doubleDoorCentreGap_um: mmToUm(2),
  shelfSideClearance_um: mmToUm(1),
  shelfFrontSetback_um: mmToUm(20),
  maxShelfSpan_um: mmToUm(600),
  shelfLoadRating_kg: 15,
  topLoadRating_kg: 30,
  minPanelDim_um: mmToUm(60),
  antiTipRequiredFromHeight_um: mmToUm(686),
  installClearance_um: mmToUm(10),
  // Sides stand on the bottom and sit under the overlay top, so only their front
  // edge is exposed. Doors show all four edges.
  edgeBanding: {
    SIDE_L: ["front"],
    SIDE_R: ["front"],
    BOTTOM: ["front"],
    TOP: ["front", "back", "left", "right"],
    BACK: [],
    SHELF: ["front"],
    DOOR: ["left", "right", "top", "bottom"],
  },
};

export const FACTORY_PILOT_01: FactoryCapability = {
  id: "FAC-PILOT-01",
  version: 1,
  status: "provisional",
  name: "Pilot factory (capability profile to be confirmed on site)",
  sheet: { length_um: mmToUm(2400), width_um: mmToUm(1200) },
  maxPanel: { length_um: mmToUm(2400), width_um: mmToUm(1200) },
  minPanel: { length_um: mmToUm(120), width_um: mmToUm(60) },
  thicknesses_um: [mmToUm(18), mmToUm(6)],
  materialsSupported: [MATERIAL_WHITE_MEL_18.id],
  edgeBandThicknesses_um: [mmToUm(1)],
  faceDrilling: true,
  horizontalBoring: false,
  grooving: false,
  pocketMilling: true,
  labelPrinter: true,
  delivery: {
    localMaxLength_um: mmToUm(2400),
    localMaxWeight_kg: 40,
    parcelMaxLength_um: mmToUm(1050),
    parcelMaxWeight_kg: 22,
    parcelMaxVolume_m3: 0.25,
  },
  capacity: { sheetsPerDay: 10 },
};

export const PRICE_LIST_PILOT: PriceList = {
  id: "PL-PILOT",
  version: 1,
  status: "provisional",
  currency: "AUD",
  gstRate: 0.1,
  material: {
    [MATERIAL_WHITE_MEL_18.id]: { perM2_cents: 4200, wasteFactor: 0.15 },
  },
  backPanel: {
    [BACK_PANEL_WHITE_6.id]: { perM2_cents: 1500, wasteFactor: 0.12 },
  },
  edgeBand: { perM_cents: 90, applicationPerM_cents: 220 },
  machining: {
    perPanel_cents: 350,
    perDrill_cents: 25,
    perPocket_cents: 60,
    perOrderSetup_cents: 2500,
  },
  hardware: {
    "CN-01": 95,
    "HG-01": 420,
    "HP-01": 110,
    "CC-01": 15,
    "SP-01": 12,
    "HD-01": 650,
    "HS-01": 5,
    "FT-01": 180,
    "FS-01": 4,
    "BS-01": 4,
    "IM-01": 140,
    "AT-01": 1200,
  },
  labour: {
    qcSortPackPerOrder_cents: 4500,
    perPanel_cents: 120,
    engineeringReviewPerOrder_cents: 6000,
  },
  packaging: { perPackage_cents: 1800 },
  overheadRate: 0.12,
  riskReserveRate: 0.05,
  platformMarginRate: 0.22,
  delivery: {
    zones: [
      { zone: "A", label: "Local zone A", price_cents: 9500, allowsLongItems: true },
      { zone: "B", label: "Local zone B", price_cents: 14500, allowsLongItems: true },
    ],
    pickup_cents: 0,
  },
  quoteValidityDays: 7,
};

function devValidationPack(): ValidationPack {
  const complete = (evidence: string) => ({
    status: "complete" as const,
    evidence: `DEV SEED — ${evidence}. Replace with a real validation record before sale.`,
    completedBy: "seed",
    completedAt: "2026-09-08T00:00:00.000Z",
  });
  return {
    material_data: complete("material placeholder registered for development"),
    approved_purpose_and_load: complete("shelf 15 kg / top 30 kg placeholder statements"),
    connection_and_stability: complete("connector and stability placeholder"),
    tolerance_and_inspection: complete("±0.5 mm cut, ±0.3 mm hole placeholder inspection plan"),
    tools_and_installation: complete("PH2 screwdriver, 4 mm hex key, mallet, level"),
    warning_labels_and_manual: complete("toppling information placeholder for 750 mm variant"),
    packaging_transport: complete("local delivery only; long top panel package validated on paper"),
    exception_owner: complete("engineering lead placeholder"),
  };
}

const COMMON_TOOLS = [
  "PH2 screwdriver or cordless driver (low torque)",
  "4 mm hex key (supplied)",
  "Rubber mallet",
  "Spirit level",
  "Soft blanket to protect faces",
];

const COMMON_WARNINGS = [
  "Indoor dry environments only. Not for kitchens, bathrooms, laundries or outdoors.",
  "Do not use as a TV stand, seat, step or aquarium base.",
  "The 750 mm height must be restrained to the wall with the supplied anti-tip kit; wall fixings depend on your wall type.",
];

export const TEMPLATE_LOW_OPEN: Template = {
  id: "TPL-LOW-O",
  version: 1,
  code: "O",
  name: "Low storage cabinet — open shelves",
  nameZh: "落地低储物柜 — 开放格",
  description: "Floor-standing low cabinet with open compartments and adjustable shelves.",
  descriptionZh: "落地低柜，开放格与可调层板，适合书房或客厅储物、展示。",
  status: "approved",
  supportedPurposes: ["general_storage", "books_and_files", "living_room_storage", "display"],
  domain: {
    width_mm: { min: 600, max: 1800 },
    heights_mm: [450, 600, 750],
    depths_mm: [350, 450],
    moduleCount: { min: 1, max: 3 },
    moduleWidth_mm: { min: 300, max: 600 },
    shelvesPerModule: { min: 0, max: 2 },
    topPanelStyles: ["single", "per_module"],
  },
  moduleKindsAllowed: ["open"],
  materialId: MATERIAL_WHITE_MEL_18.id,
  edgeBandId: EDGE_BAND_WHITE_1.id,
  backPanelId: BACK_PANEL_WHITE_6.id,
  hardwareSystemId: HARDWARE_SYSTEM_KD1.id,
  constructionId: CONSTRUCTION_LOW_CABINET_V1.id,
  assemblyRecipeId: "AR-LOW-01",
  validationPack: devValidationPack(),
  toolsRequired: COMMON_TOOLS,
  warnings: COMMON_WARNINGS,
  indicativePrice_cents: { min: 69000, max: 165000 },
};

export const TEMPLATE_LOW_DOOR: Template = {
  id: "TPL-LOW-D",
  version: 1,
  code: "D",
  name: "Low storage cabinet — doors",
  nameZh: "落地低储物柜 — 柜门",
  description:
    "Floor-standing low cabinet with full overlay doors and adjustable shelves. Modules may mix doors and open compartments.",
  descriptionZh: "落地低柜，全盖柜门与可调层板；模块可混合柜门与开放格。",
  status: "approved",
  supportedPurposes: ["general_storage", "books_and_files", "living_room_storage"],
  domain: {
    width_mm: { min: 600, max: 1800 },
    heights_mm: [450, 600, 750],
    depths_mm: [350, 450],
    moduleCount: { min: 1, max: 3 },
    moduleWidth_mm: { min: 300, max: 600 },
    shelvesPerModule: { min: 0, max: 2 },
    topPanelStyles: ["single", "per_module"],
  },
  moduleKindsAllowed: ["door", "open"],
  materialId: MATERIAL_WHITE_MEL_18.id,
  edgeBandId: EDGE_BAND_WHITE_1.id,
  backPanelId: BACK_PANEL_WHITE_6.id,
  hardwareSystemId: HARDWARE_SYSTEM_KD1.id,
  constructionId: CONSTRUCTION_LOW_CABINET_V1.id,
  assemblyRecipeId: "AR-LOW-01",
  validationPack: devValidationPack(),
  toolsRequired: COMMON_TOOLS,
  warnings: COMMON_WARNINGS,
  indicativePrice_cents: { min: 89000, max: 215000 },
};

export const TEMPLATES: Template[] = [TEMPLATE_LOW_OPEN, TEMPLATE_LOW_DOOR];
export const MATERIALS: MaterialSku[] = [MATERIAL_WHITE_MEL_18];
export const EDGE_BANDS: EdgeBandSku[] = [EDGE_BAND_WHITE_1];
export const BACK_PANELS: BackPanelSku[] = [BACK_PANEL_WHITE_6];
export const HARDWARE_SYSTEMS: HardwareSystem[] = [HARDWARE_SYSTEM_KD1];
export const CONSTRUCTIONS: ConstructionRuleSet[] = [CONSTRUCTION_LOW_CABINET_V1];
export const FACTORIES: FactoryCapability[] = [FACTORY_PILOT_01];
export const PRICE_LISTS: PriceList[] = [PRICE_LIST_PILOT];

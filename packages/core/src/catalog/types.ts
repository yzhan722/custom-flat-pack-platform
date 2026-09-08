/**
 * Catalog types. Everything here is versioned; historical versions are never
 * overwritten (PRD §8). `provisional` entries are development placeholders that
 * must be replaced by supplier-registered data before a template can be sold.
 */

export type RegistrationStatus = "provisional" | "registered";

export type Purpose =
  | "general_storage"
  | "books_and_files"
  | "living_room_storage"
  | "display"
  | "tv_stand"
  | "seating"
  | "aquarium"
  | "wall_hung"
  | "kitchen"
  | "bathroom"
  | "laundry"
  | "outdoor"
  | "vehicle"
  | "children_specific"
  | "commercial_heavy"
  | "workbench"
  | "bed"
  | "tall_wardrobe";

export interface PurposeDefinition {
  id: Purpose;
  label: string;
  labelZh: string;
  supported: boolean;
  /** Consumer-facing explanation for unsupported purposes (PRD FR-01). */
  unsupportedReason?: string;
}

export interface SheetSize {
  length_um: number;
  width_um: number;
}

export interface MaterialSku {
  id: string;
  version: number;
  status: RegistrationStatus;
  name: string;
  colour: "white";
  finish: string;
  nominalThickness_um: number;
  thicknessTolerance_um: number;
  sheet: SheetSize;
  density_kg_m3: number;
  environment: "indoor_dry";
  supplier?: string;
  supplierSku?: string;
  notes?: string;
}

export interface EdgeBandSku {
  id: string;
  version: number;
  status: RegistrationStatus;
  name: string;
  thickness_um: number;
  matchesMaterialId: string;
}

export interface BackPanelSku {
  id: string;
  version: number;
  status: RegistrationStatus;
  name: string;
  thickness_um: number;
  sheet: SheetSize;
  density_kg_m3: number;
}

export type HardwareCategory =
  | "connector"
  | "hinge"
  | "hinge_plate"
  | "shelf_pin"
  | "handle"
  | "handle_screw"
  | "foot"
  | "foot_screw"
  | "back_screw"
  | "inter_module_connector"
  | "anti_tip_kit"
  | "cover_cap";

export interface HardwareItem {
  sku: string;
  version: number;
  status: RegistrationStatus;
  name: string;
  category: HardwareCategory;
  /** Bag code printed on the hardware bag, e.g. `H01`. Stable per system version. */
  bagCode: string;
  unit: "pc" | "set";
  supplier?: string;
  notes?: string;
}

export interface HardwareSystem {
  id: string;
  version: number;
  status: RegistrationStatus;
  name: string;
  items: Record<string, HardwareItem>;
  connector: {
    sku: string;
    /** Pocket milled into the face of the end-joined panel (e.g. bottom). */
    pocketLength_um: number;
    pocketWidth_um: number;
    pocketDepth_um: number;
    /** Distance from the panel end to the pocket centre. */
    pocketCentreFromEnd_um: number;
    /** Pilot hole drilled into the face of the receiving panel (e.g. side). */
    pilotDiameter_um: number;
    pilotDepth_um: number;
    /** Distance from the panel's front/back edge to the first/last connector. */
    edgeInset_um: number;
    /** Connectors per joint by joint length (panel depth). */
    countByJointLength: Array<{ maxLength_um: number; count: number }>;
  };
  hinge: {
    sku: string;
    plateSku: string;
    coverCapSku: string;
    openingAngleDeg: number;
    cupDiameter_um: number;
    cupDepth_um: number;
    cupCentreFromDoorEdge_um: number;
    /** Distance from door top/bottom edge to hinge cup centre. */
    cupCentreFromDoorEnd_um: number;
    plateHoleDiameter_um: number;
    plateHoleDepth_um: number;
    plateHoleSpacing_um: number;
    /** Distance from side panel front edge to plate hole centre line. */
    plateCentreFromFront_um: number;
    countByDoorHeight: Array<{ maxHeight_um: number; count: number }>;
    minDoorWidth_um: number;
    maxDoorWidth_um: number;
    maxDoorWeight_kg: number;
  };
  shelfPin: {
    sku: string;
    holeDiameter_um: number;
    holeDepth_um: number;
    pitch_um: number;
    frontOffset_um: number;
    backOffset_um: number;
    firstHoleFromBottom_um: number;
    lastHoleFromTop_um: number;
    pinsPerShelf: number;
  };
  handle: {
    sku: string;
    screwSku: string;
    holeSpacing_um: number;
    holeDiameter_um: number;
    /** Handle centre distance from the door's opening (free) edge. */
    centreFromFreeEdge_um: number;
    /** Handle centre distance from the door's top edge. */
    centreFromTop_um: number;
    screwsPerHandle: number;
  };
  foot: {
    sku: string;
    screwSku: string;
    height_um: number;
    adjustMin_um: number;
    adjustMax_um: number;
    perModule: number;
    screwsPerFoot: number;
    plateInset_um: number;
  };
  backScrew: {
    sku: string;
    spacing_um: number;
    edgeInset_um: number;
  };
  interModuleConnector: {
    sku: string;
    perJoint: number;
    holeDiameter_um: number;
  };
  antiTipKit: {
    sku: string;
    perRow: number;
  };
}

export type PanelRole =
  | "SIDE_L"
  | "SIDE_R"
  | "BOTTOM"
  | "TOP"
  | "BACK"
  | "SHELF"
  | "DOOR";

export type EdgeName = "front" | "back" | "top" | "bottom" | "left" | "right";

export interface ConstructionRuleSet {
  id: string;
  version: number;
  status: RegistrationStatus;
  name: string;
  panelThickness_um: number;
  backThickness_um: number;
  /** Gap between door back face and carcass front edge. */
  doorClearanceDepth_um: number;
  /** Gap between door edge and carcass outer edge / top panel. */
  doorGap_um: number;
  doubleDoorCentreGap_um: number;
  shelfSideClearance_um: number;
  shelfFrontSetback_um: number;
  /** Maximum unsupported shelf span validated for the rated load; null when not yet validated. */
  maxShelfSpan_um: number | null;
  /** Load per shelf validated by testing; null when not yet validated. */
  shelfLoadRating_kg: number | null;
  /** Load on top panel validated by testing; null when not yet validated. */
  topLoadRating_kg: number | null;
  minPanelDim_um: number;
  /** Height at/above which anti-tip fixing and the AU information standard apply. */
  antiTipRequiredFromHeight_um: number;
  /** Which edges receive edge banding per panel role. */
  edgeBanding: Record<PanelRole, EdgeName[]>;
  /** Clearance required beyond the finished size for carrying the assembled/unassembled kit into position. */
  installClearance_um: number;
}

export type ValidationItemKey =
  | "material_data"
  | "approved_purpose_and_load"
  | "connection_and_stability"
  | "tolerance_and_inspection"
  | "tools_and_installation"
  | "warning_labels_and_manual"
  | "packaging_transport"
  | "exception_owner";

export const VALIDATION_ITEM_KEYS: ValidationItemKey[] = [
  "material_data",
  "approved_purpose_and_load",
  "connection_and_stability",
  "tolerance_and_inspection",
  "tools_and_installation",
  "warning_labels_and_manual",
  "packaging_transport",
  "exception_owner",
];

export interface ValidationItem {
  status: "pending" | "complete";
  evidence?: string;
  completedBy?: string;
  completedAt?: string;
}

export type ValidationPack = Record<ValidationItemKey, ValidationItem>;

export type TemplateCode = "O" | "D";
export type ModuleKind = "open" | "door";
export type TopPanelStyle = "single" | "per_module";

export interface Range {
  min: number;
  max: number;
}

export interface TemplateDomain {
  width_mm: Range;
  heights_mm: number[];
  depths_mm: number[];
  moduleCount: Range;
  moduleWidth_mm: Range;
  shelvesPerModule: Range;
  topPanelStyles: TopPanelStyle[];
}

export type TemplateStatus = "draft" | "pilot" | "approved" | "suspended";

export interface Template {
  id: string;
  version: number;
  code: TemplateCode;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  status: TemplateStatus;
  supportedPurposes: Purpose[];
  domain: TemplateDomain;
  moduleKindsAllowed: ModuleKind[];
  materialId: string;
  edgeBandId: string;
  backPanelId: string;
  hardwareSystemId: string;
  constructionId: string;
  assemblyRecipeId: string;
  validationPack: ValidationPack;
  toolsRequired: string[];
  /** Consumer-facing warnings shown on template and confirmation pages. */
  warnings: string[];
  /** Indicative retail price range shown before configuration (display only). */
  indicativePrice_cents: Range;
}

export interface FactoryCapability {
  id: string;
  version: number;
  status: RegistrationStatus;
  name: string;
  sheet: SheetSize;
  maxPanel: SheetSize;
  minPanel: SheetSize;
  thicknesses_um: number[];
  materialsSupported: string[];
  edgeBandThicknesses_um: number[];
  faceDrilling: boolean;
  horizontalBoring: boolean;
  grooving: boolean;
  pocketMilling: boolean;
  labelPrinter: boolean;
  delivery: {
    localMaxLength_um: number;
    localMaxWeight_kg: number;
    parcelMaxLength_um: number;
    parcelMaxWeight_kg: number;
    parcelMaxVolume_m3: number;
  };
  capacity: {
    sheetsPerDay: number;
  };
}

export interface DeliveryZone {
  zone: string;
  label: string;
  price_cents: number;
  /** Whether long items (beyond parcel limits) can be delivered in this zone. */
  allowsLongItems: boolean;
}

export interface PriceList {
  id: string;
  version: number;
  status: RegistrationStatus;
  currency: "AUD";
  gstRate: number;
  material: Record<string, { perM2_cents: number; wasteFactor: number }>;
  backPanel: Record<string, { perM2_cents: number; wasteFactor: number }>;
  edgeBand: { perM_cents: number; applicationPerM_cents: number };
  machining: {
    perPanel_cents: number;
    perDrill_cents: number;
    perPocket_cents: number;
    perOrderSetup_cents: number;
  };
  hardware: Record<string, number>;
  labour: {
    qcSortPackPerOrder_cents: number;
    perPanel_cents: number;
    engineeringReviewPerOrder_cents: number;
  };
  packaging: { perPackage_cents: number };
  overheadRate: number;
  riskReserveRate: number;
  platformMarginRate: number;
  delivery: { zones: DeliveryZone[]; pickup_cents: number };
  quoteValidityDays: number;
}

export interface CatalogVersions {
  templateId: string;
  templateVersion: number;
  materialId: string;
  materialVersion: number;
  edgeBandId: string;
  edgeBandVersion: number;
  backPanelId: string;
  backPanelVersion: number;
  hardwareSystemId: string;
  hardwareSystemVersion: number;
  constructionId: string;
  constructionVersion: number;
  factoryId: string;
  factoryVersion: number;
  priceListId: string;
  priceListVersion: number;
}

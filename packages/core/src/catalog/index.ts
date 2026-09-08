import {
  BACK_PANELS,
  CONSTRUCTIONS,
  EDGE_BANDS,
  FACTORIES,
  HARDWARE_SYSTEMS,
  MATERIALS,
  PRICE_LISTS,
  PURPOSES,
  TEMPLATES,
} from "./data";
import type {
  BackPanelSku,
  ConstructionRuleSet,
  EdgeBandSku,
  FactoryCapability,
  HardwareSystem,
  MaterialSku,
  PriceList,
  Purpose,
  PurposeDefinition,
  Template,
  ValidationItemKey,
} from "./types";
import { VALIDATION_ITEM_KEYS } from "./types";

export * from "./types";
export * from "./data";

/** Everything a template depends on, resolved to concrete versions. */
export interface TemplateContext {
  template: Template;
  material: MaterialSku;
  edgeBand: EdgeBandSku;
  backPanel: BackPanelSku;
  hardware: HardwareSystem;
  construction: ConstructionRuleSet;
}

export interface CatalogSource {
  templates: Template[];
  materials: MaterialSku[];
  edgeBands: EdgeBandSku[];
  backPanels: BackPanelSku[];
  hardwareSystems: HardwareSystem[];
  constructions: ConstructionRuleSet[];
  factories: FactoryCapability[];
  priceLists: PriceList[];
  purposes: PurposeDefinition[];
}

export class Catalog {
  constructor(private readonly source: CatalogSource) {}

  static development(): Catalog {
    return new Catalog({
      templates: TEMPLATES,
      materials: MATERIALS,
      edgeBands: EDGE_BANDS,
      backPanels: BACK_PANELS,
      hardwareSystems: HARDWARE_SYSTEMS,
      constructions: CONSTRUCTIONS,
      factories: FACTORIES,
      priceLists: PRICE_LISTS,
      purposes: PURPOSES,
    });
  }

  listTemplates(): Template[] {
    return latestByKey(this.source.templates, (t) => t.id, (t) => t.version);
  }

  getTemplate(id: string, version?: number): Template {
    return pick(this.source.templates, id, version, "template");
  }

  getMaterial(id: string, version?: number): MaterialSku {
    return pick(this.source.materials, id, version, "material");
  }

  getEdgeBand(id: string, version?: number): EdgeBandSku {
    return pick(this.source.edgeBands, id, version, "edge band");
  }

  getBackPanel(id: string, version?: number): BackPanelSku {
    return pick(this.source.backPanels, id, version, "back panel");
  }

  getHardwareSystem(id: string, version?: number): HardwareSystem {
    return pick(this.source.hardwareSystems, id, version, "hardware system");
  }

  getConstruction(id: string, version?: number): ConstructionRuleSet {
    return pick(this.source.constructions, id, version, "construction rule set");
  }

  getFactory(id: string, version?: number): FactoryCapability {
    return pick(this.source.factories, id, version, "factory");
  }

  listFactories(): FactoryCapability[] {
    return latestByKey(this.source.factories, (f) => f.id, (f) => f.version);
  }

  getPriceList(id: string, version?: number): PriceList {
    return pick(this.source.priceLists, id, version, "price list");
  }

  listPriceLists(): PriceList[] {
    return latestByKey(this.source.priceLists, (p) => p.id, (p) => p.version);
  }

  getPurpose(id: Purpose): PurposeDefinition {
    const found = this.source.purposes.find((p) => p.id === id);
    if (!found) throw new Error(`Unknown purpose ${id}`);
    return found;
  }

  listPurposes(): PurposeDefinition[] {
    return this.source.purposes;
  }

  resolveTemplate(id: string, version?: number): TemplateContext {
    const template = this.getTemplate(id, version);
    return {
      template,
      material: this.getMaterial(template.materialId),
      edgeBand: this.getEdgeBand(template.edgeBandId),
      backPanel: this.getBackPanel(template.backPanelId),
      hardware: this.getHardwareSystem(template.hardwareSystemId),
      construction: this.getConstruction(template.constructionId),
    };
  }
}

function pick<T extends { id: string; version: number }>(
  items: T[],
  id: string,
  version: number | undefined,
  kind: string,
): T {
  const candidates = items.filter((i) => i.id === id);
  if (candidates.length === 0) throw new Error(`Unknown ${kind} ${id}`);
  if (version === undefined) {
    return candidates.reduce((a, b) => (b.version > a.version ? b : a));
  }
  const exact = candidates.find((c) => c.version === version);
  if (!exact) throw new Error(`Unknown ${kind} ${id} version ${version}`);
  return exact;
}

function latestByKey<T>(items: T[], key: (t: T) => string, version: (t: T) => number): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const existing = map.get(key(item));
    if (!existing || version(item) > version(existing)) map.set(key(item), item);
  }
  return [...map.values()];
}

/** Validation items still pending for a template. */
export function pendingValidationItems(template: Template): ValidationItemKey[] {
  return VALIDATION_ITEM_KEYS.filter((k) => template.validationPack[k].status !== "complete");
}

/**
 * PRD §12: a template is sellable only when it is approved and every required
 * validation item is complete.
 */
export function catalogueSellable(template: Template): boolean {
  return template.status === "approved" && pendingValidationItems(template).length === 0;
}

/** True when any dependency is still a provisional placeholder. */
export function hasProvisionalDependencies(ctx: TemplateContext): boolean {
  return (
    ctx.material.status === "provisional" ||
    ctx.edgeBand.status === "provisional" ||
    ctx.backPanel.status === "provisional" ||
    ctx.hardware.status === "provisional" ||
    ctx.construction.status === "provisional"
  );
}

import type { EdgeName, PanelRole, TemplateContext } from "../catalog";
import type { DesignSpec, ModuleSpec } from "../design";
import { pad2 } from "../ids";
import { areaUmToM2, mmToUm, umToM, type Size3Um } from "../units";
import type {
  CompiledCabinet,
  CompiledDoor,
  CompiledModule,
  EdgeSpec,
  Face,
  HardwareUse,
  Joint,
  LocalEdge,
  Operation,
  Panel,
} from "./types";

/**
 * Compiles a DesignSpec into panels, operations and joints.
 *
 * Construction (development default, see CONSTRUCTION_LOW_CABINET_V1):
 * - Bottom panel spans the module width; sides stand on it.
 * - Top panel overlays the sides and covers doors and back (full depth).
 * - Back panel overlays the rear edges of sides and bottom, screwed on.
 * - Full overlay doors sit under the top panel overhang.
 * - Sides join top/bottom with face-machined knock-down connectors:
 *   pocket in the side's inner face near each end, pilot hole in the
 *   horizontal panel's face.
 * - Adjustable shelves on 5 mm pins in 32 mm system rows.
 *
 * The compiler is pure and deterministic: same design + same catalog versions
 * always produce identical output (PRD FR-08).
 */

const LOCAL_EDGE_MAP: Record<PanelRole, Record<LocalEdge, EdgeName>> = {
  SIDE_L: { x0: "front", x1: "back", y0: "bottom", y1: "top" },
  SIDE_R: { x0: "front", x1: "back", y0: "bottom", y1: "top" },
  BOTTOM: { x0: "left", x1: "right", y0: "front", y1: "back" },
  TOP: { x0: "left", x1: "right", y0: "front", y1: "back" },
  SHELF: { x0: "left", x1: "right", y0: "front", y1: "back" },
  BACK: { x0: "left", x1: "right", y0: "bottom", y1: "top" },
  DOOR: { x0: "left", x1: "right", y0: "bottom", y1: "top" },
};

const FACE_NAMES: Record<PanelRole, { A: string; B: string }> = {
  SIDE_L: { A: "outer face", B: "inner face" },
  SIDE_R: { A: "outer face", B: "inner face" },
  BOTTOM: { A: "top face (inside)", B: "underside" },
  TOP: { A: "top face", B: "underside" },
  SHELF: { A: "top face", B: "underside" },
  BACK: { A: "inside face", B: "rear face" },
  DOOR: { A: "front face", B: "back face" },
};

interface PanelDraft {
  id: string;
  moduleIndex: number | null;
  role: PanelRole;
  name: string;
  materialId: string;
  thickness_um: number;
  length_um: number;
  width_um: number;
  density_kg_m3: number;
  operations: Operation[];
  placement: Panel["placement"];
}

class Builder {
  readonly panels: PanelDraft[] = [];
  readonly joints: Joint[] = [];
  private readonly byId = new Map<string, PanelDraft>();

  constructor(private readonly ctx: TemplateContext) {}

  add(draft: PanelDraft): PanelDraft {
    if (this.byId.has(draft.id)) throw new Error(`Duplicate panel id ${draft.id}`);
    this.panels.push(draft);
    this.byId.set(draft.id, draft);
    return draft;
  }

  get(id: string): PanelDraft {
    const p = this.byId.get(id);
    if (!p) throw new Error(`Unknown panel ${id}`);
    return p;
  }

  drill(
    panelId: string,
    face: Face,
    x_um: number,
    y_um: number,
    diameter_um: number,
    depth_um: number,
    through: boolean,
    purpose: Operation["purpose"],
    jointId: string,
  ): void {
    const panel = this.get(panelId);
    const duplicate = panel.operations.some(
      (op) => op.kind === "DRILL" && op.face === face && op.x_um === x_um && op.y_um === y_um && op.diameter_um === diameter_um,
    );
    if (duplicate) return;
    panel.operations.push({ kind: "DRILL", face, x_um, y_um, diameter_um, depth_um, through, purpose, jointId });
  }

  pocket(
    panelId: string,
    face: Face,
    x_um: number,
    y_um: number,
    rotationDeg: 0 | 90,
    jointId: string,
  ): void {
    const c = this.ctx.hardware.connector;
    this.get(panelId).operations.push({
      kind: "POCKET",
      face,
      x_um,
      y_um,
      length_um: c.pocketLength_um,
      width_um: c.pocketWidth_um,
      depth_um: c.pocketDepth_um,
      rotationDeg,
      purpose: "connector_pocket",
      jointId,
    });
  }

  joint(joint: Joint): void {
    this.joints.push(joint);
  }
}

function connectorCount(ctx: TemplateContext, jointLength_um: number): number {
  const table = ctx.hardware.connector.countByJointLength;
  for (const row of table) {
    if (jointLength_um <= row.maxLength_um) return row.count;
  }
  return table[table.length - 1]?.count ?? 2;
}

function hingeCount(ctx: TemplateContext, doorHeight_um: number): number {
  const table = ctx.hardware.hinge.countByDoorHeight;
  for (const row of table) {
    if (doorHeight_um <= row.maxHeight_um) return row.count;
  }
  return table[table.length - 1]?.count ?? 2;
}

/** Evenly spaced positions between `inset` and `length - inset`. */
function spread(length_um: number, inset_um: number, count: number): number[] {
  if (count <= 1) return [Math.round(length_um / 2)];
  const span = length_um - 2 * inset_um;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(Math.round(inset_um + (span * i) / (count - 1)));
  return out;
}

/** Number of fasteners so that spacing never exceeds `maxSpacing`. */
function fastenerPositions(length_um: number, inset_um: number, maxSpacing_um: number): number[] {
  const span = length_um - 2 * inset_um;
  if (span <= 0) return [Math.round(length_um / 2)];
  const count = Math.max(2, Math.ceil(span / maxSpacing_um) + 1);
  return spread(length_um, inset_um, count);
}

export interface ShelfRowGrid {
  rows_um: number[];
}

/** Shelf-pin rows relative to the side panel's bottom end (which rests on the bottom panel). */
export function shelfRowGrid(ctx: TemplateContext, sideHeight_um: number): ShelfRowGrid {
  const sp = ctx.hardware.shelfPin;
  const rows: number[] = [];
  for (let y = sp.firstHoleFromBottom_um; y <= sideHeight_um - sp.lastHoleFromTop_um; y += sp.pitch_um) rows.push(y);
  return { rows_um: rows };
}

function nearestIndex(values: number[], target: number): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  values.forEach((v, i) => {
    const d = Math.abs(v - target);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

export function compileCabinet(design: DesignSpec, ctx: TemplateContext): CompiledCabinet {
  const { construction: c, hardware: hw, material, backPanel, edgeBand, template } = ctx;
  const b = new Builder(ctx);

  const t = c.panelThickness_um;
  const tb = c.backThickness_um;
  const g = c.doorGap_um;
  const cg = c.doubleDoorCentreGap_um;
  const footH = hw.foot.height_um;

  const finished: Size3Um = {
    width_um: mmToUm(design.finished.width_mm),
    height_um: mmToUm(design.finished.height_mm),
    depth_um: mmToUm(design.finished.depth_mm),
  };
  const D = finished.depth_um;
  const carcassH = finished.height_um - footH;
  const doorZone = t + c.doorClearanceDepth_um;
  const sideD = D - doorZone - tb;
  const sideH = carcassH - 2 * t;
  const doorH = t + sideH - 2 * g;
  const backH = t + sideH;

  const conn = hw.connector;
  const nConn = connectorCount(ctx, sideD);
  const connX = spread(sideD, conn.edgeInset_um, nConn);
  const grid = shelfRowGrid(ctx, sideH);

  const modules: CompiledModule[] = [];
  let offsetX = 0;

  design.modules.forEach((m: ModuleSpec, i: number) => {
    const idx = i + 1;
    const W = mmToUm(m.width_mm);
    const M = `M${idx}`;
    const sideIds = { L: `${M}-SIDE_L`, R: `${M}-SIDE_R` };
    const bottomId = `${M}-BOTTOM`;
    const backId = `${M}-BACK`;
    const topId = design.topPanelStyle === "per_module" ? `${M}-TOP` : "ROW-TOP";
    const panelIds: string[] = [];

    for (const side of ["L", "R"] as const) {
      const id = sideIds[side];
      const x = side === "L" ? offsetX : offsetX + W - t;
      b.add({
        id,
        moduleIndex: idx,
        role: side === "L" ? "SIDE_L" : "SIDE_R",
        name: `Module ${idx} — ${side === "L" ? "left" : "right"} side`,
        materialId: material.id,
        thickness_um: t,
        length_um: sideD,
        width_um: sideH,
        density_kg_m3: material.density_kg_m3,
        operations: [],
        placement: { x_um: x, y_um: doorZone, z_um: t, size: { width_um: t, depth_um: sideD, height_um: sideH } },
      });
      panelIds.push(id);
    }

    b.add({
      id: bottomId,
      moduleIndex: idx,
      role: "BOTTOM",
      name: `Module ${idx} — bottom`,
      materialId: material.id,
      thickness_um: t,
      length_um: W,
      width_um: sideD,
      density_kg_m3: material.density_kg_m3,
      operations: [],
      placement: { x_um: offsetX, y_um: doorZone, z_um: 0, size: { width_um: W, depth_um: sideD, height_um: t } },
    });
    panelIds.push(bottomId);

    if (design.topPanelStyle === "per_module") {
      b.add({
        id: topId,
        moduleIndex: idx,
        role: "TOP",
        name: `Module ${idx} — top`,
        materialId: material.id,
        thickness_um: t,
        length_um: W,
        width_um: D,
        density_kg_m3: material.density_kg_m3,
        operations: [],
        placement: { x_um: offsetX, y_um: 0, z_um: t + sideH, size: { width_um: W, depth_um: D, height_um: t } },
      });
      panelIds.push(topId);
    }

    b.add({
      id: backId,
      moduleIndex: idx,
      role: "BACK",
      name: `Module ${idx} — back panel`,
      materialId: backPanel.id,
      thickness_um: tb,
      length_um: W,
      width_um: backH,
      density_kg_m3: backPanel.density_kg_m3,
      operations: [],
      placement: { x_um: offsetX, y_um: doorZone + sideD, z_um: 0, size: { width_um: W, depth_um: tb, height_um: backH } },
    });
    panelIds.push(backId);

    // Side ↔ bottom / top connectors.
    for (const side of ["L", "R"] as const) {
      const sideId = sideIds[side];
      const sideCentreX = side === "L" ? t / 2 : W - t / 2;
      for (const end of ["bottom", "top"] as const) {
        const jointId = `${M}-J-${side}-${end.toUpperCase()}`;
        const targetId = end === "bottom" ? bottomId : topId;
        const pocketY = end === "bottom" ? conn.pocketCentreFromEnd_um : sideH - conn.pocketCentreFromEnd_um;
        for (const x of connX) {
          b.pocket(sideId, "B", x, pocketY, 90, jointId);
          if (end === "bottom") {
            b.drill(targetId, "A", sideCentreX, x, conn.pilotDiameter_um, conn.pilotDepth_um, false, "connector_pilot", jointId);
          } else if (design.topPanelStyle === "per_module") {
            b.drill(targetId, "B", sideCentreX, doorZone + x, conn.pilotDiameter_um, conn.pilotDepth_um, false, "connector_pilot", jointId);
          }
          // Single spanning top: pilot holes are added once ROW-TOP exists (below).
        }
        b.joint({
          id: jointId,
          kind: "connector",
          moduleIndex: idx,
          panelIds: [sideId, targetId],
          hardware: [{ sku: conn.sku, qty: nConn }],
          description: `${side === "L" ? "Left" : "Right"} side to ${end} — ${nConn} connectors`,
        });
      }
    }

    // Feet under the bottom panel.
    const footJoint = `${M}-J-FEET`;
    const fi = hw.foot.plateInset_um;
    for (const [fx, fy] of [
      [fi, fi],
      [W - fi, fi],
      [fi, sideD - fi],
      [W - fi, sideD - fi],
    ] as const) {
      b.drill(bottomId, "B", fx, fy, mmToUm(3), mmToUm(8), false, "foot_locate", footJoint);
    }
    b.joint({
      id: footJoint,
      kind: "foot",
      moduleIndex: idx,
      panelIds: [bottomId],
      hardware: [
        { sku: hw.foot.sku, qty: hw.foot.perModule },
        { sku: hw.foot.screwSku, qty: hw.foot.perModule * hw.foot.screwsPerFoot },
      ],
      description: `${hw.foot.perModule} adjustable feet on the bottom panel`,
    });

    // Back panel screws into sides and bottom.
    const backJoint = `${M}-J-BACK`;
    const bs = hw.backScrew;
    const sideScrewY = fastenerPositions(sideH, bs.edgeInset_um, bs.spacing_um).map((y) => t + y);
    for (const y of sideScrewY) {
      b.drill(backId, "A", t / 2, y, mmToUm(3.5), tb, true, "back_screw", backJoint);
      b.drill(backId, "A", W - t / 2, y, mmToUm(3.5), tb, true, "back_screw", backJoint);
    }
    const bottomScrewX = fastenerPositions(W - 2 * t, bs.edgeInset_um, bs.spacing_um).map((x) => t + x);
    for (const x of bottomScrewX) {
      b.drill(backId, "A", x, t / 2, mmToUm(3.5), tb, true, "back_screw", backJoint);
    }
    const backScrewCount = b.get(backId).operations.filter((o) => o.purpose === "back_screw").length;
    b.joint({
      id: backJoint,
      kind: "back_screw",
      moduleIndex: idx,
      panelIds: [backId, sideIds.L, sideIds.R, bottomId],
      hardware: [{ sku: bs.sku, qty: backScrewCount }],
      description: `Back panel fixed with ${backScrewCount} screws`,
    });

    // Shelves.
    const shelfPositions: number[] = [];
    const shelfRows: number[] = [];
    if (m.shelfCount > 0) {
      const sp = hw.shelfPin;
      for (const sideId of [sideIds.L, sideIds.R]) {
        for (const y of grid.rows_um) {
          b.drill(sideId, "B", sp.frontOffset_um, y, sp.holeDiameter_um, sp.holeDepth_um, false, "shelf_pin", `${M}-J-SHELVES`);
          b.drill(sideId, "B", sideD - sp.backOffset_um, y, sp.holeDiameter_um, sp.holeDepth_um, false, "shelf_pin", `${M}-J-SHELVES`);
        }
      }
      const shelfW = W - 2 * t - c.shelfSideClearance_um;
      const shelfD = sideD - c.shelfFrontSetback_um;
      for (let k = 1; k <= m.shelfCount; k++) {
        const ideal = Math.round((sideH * k) / (m.shelfCount + 1));
        const rowIdx = grid.rows_um.length ? nearestIndex(grid.rows_um, ideal) : -1;
        const z = rowIdx >= 0 ? grid.rows_um[rowIdx]! : ideal;
        shelfPositions.push(z);
        shelfRows.push(rowIdx + 1);
        const id = `${M}-SHELF-${k}`;
        b.add({
          id,
          moduleIndex: idx,
          role: "SHELF",
          name: `Module ${idx} — shelf ${k}`,
          materialId: material.id,
          thickness_um: t,
          length_um: shelfW,
          width_um: shelfD,
          density_kg_m3: material.density_kg_m3,
          operations: [],
          placement: {
            x_um: offsetX + t + c.shelfSideClearance_um / 2,
            y_um: doorZone + c.shelfFrontSetback_um,
            z_um: t + z,
            size: { width_um: shelfW, depth_um: shelfD, height_um: t },
          },
        });
        panelIds.push(id);
      }
      b.joint({
        id: `${M}-J-SHELVES`,
        kind: "shelf_pins",
        moduleIndex: idx,
        panelIds: [sideIds.L, sideIds.R, ...Array.from({ length: m.shelfCount }, (_, k) => `${M}-SHELF-${k + 1}`)],
        hardware: [{ sku: sp.sku, qty: sp.pinsPerShelf * m.shelfCount }],
        description: `${m.shelfCount} adjustable shelf(s) on ${sp.pinsPerShelf * m.shelfCount} pins`,
      });
    }

    // Doors.
    const doors: CompiledDoor[] = [];
    if (m.kind === "door") {
      const swing = m.doorSwing ?? "left";
      const handle = m.handle ?? "bar";
      const doorSpecs: Array<{ suffix: string; x_um: number; width_um: number; hingeSide: "L" | "R"; swing: "left" | "right" }> = [];
      if (swing === "double") {
        const wD = (W - 2 * g - cg) / 2;
        doorSpecs.push({ suffix: "L", x_um: offsetX + g, width_um: wD, hingeSide: "L", swing: "left" });
        doorSpecs.push({ suffix: "R", x_um: offsetX + g + wD + cg, width_um: wD, hingeSide: "R", swing: "right" });
      } else {
        doorSpecs.push({ suffix: swing === "left" ? "L" : "R", x_um: offsetX + g, width_um: W - 2 * g, hingeSide: swing === "left" ? "L" : "R", swing });
      }
      const nH = hingeCount(ctx, doorH);
      const hg = hw.hinge;
      // Ideal cup positions along the door, then snapped so plate holes land on the 32 mm grid.
      const idealCupY = spread(doorH, hg.cupCentreFromDoorEnd_um, nH);
      const hingeYs = idealCupY.map((cupY) => {
        const idealSideY = cupY + g - t;
        const base = hw.shelfPin.firstHoleFromBottom_um + hg.plateHoleSpacing_um / 2;
        const k = Math.round((idealSideY - base) / hw.shelfPin.pitch_um);
        return base + k * hw.shelfPin.pitch_um;
      });
      for (const d of doorSpecs) {
        const id = `${M}-DOOR-${d.suffix}`;
        b.add({
          id,
          moduleIndex: idx,
          role: "DOOR",
          name: `Module ${idx} — ${doorSpecs.length === 2 ? (d.suffix === "L" ? "left door" : "right door") : "door"}`,
          materialId: material.id,
          thickness_um: t,
          length_um: d.width_um,
          width_um: doorH,
          density_kg_m3: material.density_kg_m3,
          operations: [],
          placement: { x_um: d.x_um, y_um: 0, z_um: g, size: { width_um: d.width_um, depth_um: t, height_um: doorH } },
        });
        panelIds.push(id);
        const jointId = `${M}-J-HINGE-${d.suffix}`;
        const sideId = sideIds[d.hingeSide];
        const cupX = d.hingeSide === "L" ? hg.cupCentreFromDoorEdge_um : d.width_um - hg.cupCentreFromDoorEdge_um;
        for (const hy of hingeYs) {
          const cupY = hy + t - g;
          b.drill(id, "B", cupX, cupY, hg.cupDiameter_um, hg.cupDepth_um, false, "hinge_cup", jointId);
          for (const dy of [-hg.plateHoleSpacing_um / 2, hg.plateHoleSpacing_um / 2]) {
            b.drill(sideId, "B", hg.plateCentreFromFront_um, hy + dy, hg.plateHoleDiameter_um, hg.plateHoleDepth_um, false, "hinge_plate", jointId);
          }
        }
        b.joint({
          id: jointId,
          kind: "hinge",
          moduleIndex: idx,
          panelIds: [id, sideId],
          hardware: [
            { sku: hg.sku, qty: nH },
            { sku: hg.plateSku, qty: nH },
            { sku: hg.coverCapSku, qty: nH },
          ],
          description: `${nH} hinges on the ${d.hingeSide === "L" ? "left" : "right"} side`,
        });
        if (handle === "bar") {
          const hd = hw.handle;
          const hx = d.hingeSide === "L" ? d.width_um - hd.centreFromFreeEdge_um : hd.centreFromFreeEdge_um;
          const hy1 = doorH - hd.centreFromTop_um;
          const handleJoint = `${M}-J-HANDLE-${d.suffix}`;
          b.drill(id, "A", hx, hy1, hd.holeDiameter_um, t, true, "handle", handleJoint);
          b.drill(id, "A", hx, hy1 - hd.holeSpacing_um, hd.holeDiameter_um, t, true, "handle", handleJoint);
          b.joint({
            id: handleJoint,
            kind: "handle",
            moduleIndex: idx,
            panelIds: [id],
            hardware: [
              { sku: hd.sku, qty: 1 },
              { sku: hd.screwSku, qty: hd.screwsPerHandle },
            ],
            description: "Bar handle",
          });
        }
        doors.push({ panelId: id, hingeSide: d.hingeSide, swing: d.swing, hingeCount: nH, hingeZ_um: hingeYs.map((hy) => hy + t) });
      }
    }

    modules.push({
      index: idx,
      kind: m.kind,
      offsetX_um: offsetX,
      width_um: W,
      interior: { width_um: W - 2 * t, height_um: sideH, depth_um: sideD },
      panelIds,
      shelfPositions_um: shelfPositions,
      shelfRows,
      doors,
    });
    offsetX += W;
  });

  if (design.topPanelStyle === "single") {
    b.add({
      id: "ROW-TOP",
      moduleIndex: null,
      role: "TOP",
      name: "Top panel (spans all modules)",
      materialId: material.id,
      thickness_um: t,
      length_um: finished.width_um,
      width_um: D,
      density_kg_m3: material.density_kg_m3,
      operations: [],
      placement: { x_um: 0, y_um: 0, z_um: t + sideH, size: { width_um: finished.width_um, depth_um: D, height_um: t } },
    });
    for (const m of modules) {
      for (const side of ["L", "R"] as const) {
        const sideCentreX = side === "L" ? t / 2 : m.width_um - t / 2;
        const jointId = `M${m.index}-J-${side}-TOP`;
        for (const x of connX) {
          b.drill("ROW-TOP", "B", m.offsetX_um + sideCentreX, doorZone + x, conn.pilotDiameter_um, conn.pilotDepth_um, false, "connector_pilot", jointId);
        }
      }
    }
    for (const m of modules) m.panelIds.push("ROW-TOP");
  }

  // Inter-module bolts.
  for (let i = 0; i < modules.length - 1; i++) {
    const a = modules[i]!;
    const bm = modules[i + 1]!;
    const jointId = `ROW-J-JOIN-${a.index}-${bm.index}`;
    const positions: Array<[number, number]> = [
      [mmToUm(100), mmToUm(80)],
      [mmToUm(100), sideH - mmToUm(80)],
      [sideD - mmToUm(100), Math.round(sideH / 2)],
    ];
    const imc = hw.interModuleConnector;
    for (const [x, y] of positions.slice(0, imc.perJoint)) {
      b.drill(`M${a.index}-SIDE_R`, "B", x, y, imc.holeDiameter_um, t, true, "inter_module_bolt", jointId);
      b.drill(`M${bm.index}-SIDE_L`, "B", x, y, imc.holeDiameter_um, t, true, "inter_module_bolt", jointId);
    }
    b.joint({
      id: jointId,
      kind: "inter_module_bolt",
      moduleIndex: null,
      panelIds: [`M${a.index}-SIDE_R`, `M${bm.index}-SIDE_L`],
      hardware: [{ sku: imc.sku, qty: imc.perJoint }],
      description: `Join module ${a.index} to module ${bm.index} with ${imc.perJoint} connecting bolts`,
    });
  }

  const antiTipRequired = finished.height_um >= c.antiTipRequiredFromHeight_um;
  if (antiTipRequired) {
    b.joint({
      id: "ROW-J-ANTI-TIP",
      kind: "anti_tip",
      moduleIndex: null,
      panelIds: design.topPanelStyle === "single" ? ["ROW-TOP"] : modules.map((m) => `M${m.index}-TOP`),
      hardware: [{ sku: hw.antiTipKit.sku, qty: hw.antiTipKit.perRow }],
      description: "Anti-tip restraint to the wall (wall fixings depend on wall type)",
    });
  }

  // Finalise panels: edge banding, cut sizes, labels, weights.
  const bandT = edgeBand.thickness_um;
  const order: PanelDraft[] = [...b.panels];
  const panels: Panel[] = order.map((p, i) => {
    const bandedEdges = c.edgeBanding[p.role];
    const edges: EdgeSpec[] = (["x0", "x1", "y0", "y1"] as LocalEdge[]).map((edge) => {
      const cabinetEdge = LOCAL_EDGE_MAP[p.role][edge];
      const banded = p.role !== "BACK" && bandedEdges.includes(cabinetEdge);
      return { edge, cabinetEdge, banded, bandThickness_um: banded ? bandT : 0 };
    });
    const bandX = edges.filter((e) => (e.edge === "x0" || e.edge === "x1") && e.banded).reduce((acc, e) => acc + e.bandThickness_um, 0);
    const bandY = edges.filter((e) => (e.edge === "y0" || e.edge === "y1") && e.banded).reduce((acc, e) => acc + e.bandThickness_um, 0);
    const cut = { length_um: p.length_um - bandX, width_um: p.width_um - bandY };
    const weight_kg = areaUmToM2(cut.length_um, cut.width_um) * umToM(p.thickness_um) * p.density_kg_m3;
    return {
      id: p.id,
      label: `A${pad2(i + 1)}`,
      moduleIndex: p.moduleIndex,
      role: p.role,
      name: p.name,
      materialId: p.materialId,
      thickness_um: p.thickness_um,
      finished: { length_um: p.length_um, width_um: p.width_um },
      cut,
      edges,
      operations: [...p.operations].sort(compareOps),
      faceA: FACE_NAMES[p.role].A,
      faceB: FACE_NAMES[p.role].B,
      weight_kg: round3(weight_kg),
      placement: p.placement,
    };
  });

  const areaByMaterial: Record<string, number> = {};
  let edgeBandLength_um = 0;
  let drillCount = 0;
  let pocketCount = 0;
  let weight = 0;
  for (const p of panels) {
    areaByMaterial[p.materialId] = (areaByMaterial[p.materialId] ?? 0) + areaUmToM2(p.cut.length_um, p.cut.width_um);
    for (const e of p.edges) {
      if (e.banded) edgeBandLength_um += e.edge === "x0" || e.edge === "x1" ? p.finished.width_um : p.finished.length_um;
    }
    for (const op of p.operations) {
      if (op.kind === "DRILL") drillCount++;
      else pocketCount++;
    }
    weight += p.weight_kg;
  }
  for (const k of Object.keys(areaByMaterial)) areaByMaterial[k] = round3(areaByMaterial[k]!);

  return {
    design,
    versions: {
      templateId: template.id,
      templateVersion: template.version,
      constructionId: c.id,
      constructionVersion: c.version,
      hardwareSystemId: hw.id,
      hardwareSystemVersion: hw.version,
      materialId: material.id,
      materialVersion: material.version,
      edgeBandId: edgeBand.id,
      edgeBandVersion: edgeBand.version,
      backPanelId: backPanel.id,
      backPanelVersion: backPanel.version,
    },
    dims: {
      finished,
      carcassHeight_um: carcassH,
      sideHeight_um: sideH,
      sideDepth_um: sideD,
      footHeight_um: footH,
      doorZone_um: doorZone,
    },
    modules,
    panels,
    joints: b.joints,
    antiTipRequired,
    totals: {
      panelCount: panels.length,
      areaByMaterial_m2: areaByMaterial,
      edgeBandLength_m: round3(umToM(edgeBandLength_um)),
      drillCount,
      pocketCount,
      weight_kg: round3(weight),
    },
  };
}

function compareOps(a: Operation, b: Operation): number {
  if (a.face !== b.face) return a.face < b.face ? -1 : 1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.y_um !== b.y_um) return a.y_um - b.y_um;
  return a.x_um - b.x_um;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Aggregates hardware usage across all joints into a sorted list. */
export function aggregateHardware(joints: Joint[]): HardwareUse[] {
  const map = new Map<string, number>();
  for (const j of joints) for (const h of j.hardware) map.set(h.sku, (map.get(h.sku) ?? 0) + h.qty);
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([sku, qty]) => ({ sku, qty }));
}

import type { CompiledCabinet } from "@cfp/core";

/**
 * Dimensioned 2D drawing (front and side elevation) generated from the compiled
 * cabinet. Server-renderable SVG: it is the fallback when WebGL is unavailable
 * and the drawing bound into the confirmation record (FR-03, FR-07).
 */
export function ElevationDrawing({ cabinet, width = 720, showSide = true, title }: { cabinet: CompiledCabinet; width?: number; showSide?: boolean; title?: string }) {
  const mm = (um: number) => um / 1000;
  const W = mm(cabinet.dims.finished.width_um);
  const H = mm(cabinet.dims.finished.height_um);
  const D = mm(cabinet.dims.finished.depth_um);
  const footH = mm(cabinet.dims.footHeight_um);

  const pad = 64;
  const gap = 60;
  const totalW = W + (showSide ? D + gap : 0);
  const s = (width - pad * 2) / totalW;
  const height = H * s + pad * 2;
  const x0 = pad;
  const yBase = pad + H * s; // floor line in SVG

  const rect = (x: number, zFromFloor: number, w: number, h: number, cls: string, key: string, dashed = false) => (
    <rect key={key} x={x0 + x * s} y={yBase - (zFromFloor + h) * s} width={Math.max(0.5, w * s)} height={Math.max(0.5, h * s)} className={cls} strokeDasharray={dashed ? "3 3" : undefined} />
  );

  const front: React.ReactNode[] = [];
  const doorsById = new Map(cabinet.modules.flatMap((m) => m.doors.map((d) => [d.panelId, d] as const)));
  for (const m of cabinet.modules) {
    const ox = mm(m.offsetX_um);
    const w = mm(m.width_um);
    const fi = 40;
    front.push(rect(ox + fi - 15, 0, 30, footH, "fill-stone-300 stroke-stone-500", `${m.index}-f1`));
    front.push(rect(ox + w - fi - 15, 0, 30, footH, "fill-stone-300 stroke-stone-500", `${m.index}-f2`));
  }
  const ordered = [...cabinet.panels].sort((a, b) => order(a.role) - order(b.role));
  for (const p of ordered) {
    if (p.role === "BACK") continue;
    const x = mm(p.placement.x_um);
    const z = mm(p.placement.z_um) + footH;
    const w = mm(p.placement.size.width_um);
    const h = mm(p.placement.size.height_um);
    if (p.role === "SHELF") {
      front.push(rect(x, z, w, h, "fill-stone-100 stroke-stone-400", p.id, true));
      continue;
    }
    if (p.role === "DOOR") {
      const d = doorsById.get(p.id);
      front.push(rect(x, z, w, h, "fill-white stroke-stone-700", p.id));
      if (d) {
        const hx = d.hingeSide === "L" ? x0 + x * s : x0 + (x + w) * s;
        const fx = d.hingeSide === "L" ? x0 + (x + w) * s : x0 + x * s;
        const yTop = yBase - (z + h) * s;
        const yBot = yBase - z * s;
        const yMid = (yTop + yBot) / 2;
        front.push(<path key={`${p.id}-swing`} d={`M ${hx} ${yTop} L ${fx} ${yMid} L ${hx} ${yBot}`} className="fill-none stroke-stone-400" strokeDasharray="4 3" />);
        const handleOp = p.operations.find((o) => o.purpose === "handle");
        if (handleOp) {
          const hxPos = x0 + (x + mm(handleOp.x_um)) * s;
          const hyTop = yBase - (z + mm(handleOp.y_um)) * s;
          front.push(<line key={`${p.id}-handle`} x1={hxPos} y1={hyTop} x2={hxPos} y2={hyTop + 128 * s} className="stroke-stone-800" strokeWidth={Math.max(2, 10 * s)} strokeLinecap="round" />);
        }
      }
      continue;
    }
    front.push(rect(x, z, w, h, "fill-stone-50 stroke-stone-700", p.id));
  }

  // Dimension lines.
  const dims: React.ReactNode[] = [];
  const dimY = pad - 26;
  dims.push(<Dim key="w" x1={x0} x2={x0 + W * s} y={dimY} label={`${W} mm`} />);
  cabinet.modules.forEach((m) => {
    dims.push(<Dim key={`mw${m.index}`} x1={x0 + mm(m.offsetX_um) * s} x2={x0 + (mm(m.offsetX_um) + mm(m.width_um)) * s} y={yBase + 22} label={`${mm(m.width_um)}`} small />);
  });
  dims.push(<VDim key="h" x={x0 + W * s + 26} y1={yBase - H * s} y2={yBase} label={`${H} mm`} />);

  // Side elevation.
  const side: React.ReactNode[] = [];
  if (showSide) {
    const sx = x0 + (W + gap) * s;
    const t = mm(cabinet.panels.find((p) => p.role === "SIDE_L")?.thickness_um ?? 18000);
    const tb = mm(cabinet.panels.find((p) => p.role === "BACK")?.thickness_um ?? 6000);
    const doorZone = mm(cabinet.dims.doorZone_um);
    const sideD = mm(cabinet.dims.sideDepth_um);
    const sideH = mm(cabinet.dims.sideHeight_um);
    const r = (yFront: number, zFromFloor: number, depth: number, h: number, cls: string, key: string) => (
      <rect key={key} x={sx + yFront * s} y={yBase - (zFromFloor + h) * s} width={Math.max(0.5, depth * s)} height={Math.max(0.5, h * s)} className={cls} />
    );
    side.push(r(doorZone + 30, 0, 30, footH, "fill-stone-300 stroke-stone-500", "sf1"));
    side.push(r(doorZone + sideD - 60, 0, 30, footH, "fill-stone-300 stroke-stone-500", "sf2"));
    side.push(r(doorZone, footH, sideD, t, "fill-stone-50 stroke-stone-700", "sbottom"));
    side.push(r(doorZone, footH + t, sideD, sideH, "fill-stone-100 stroke-stone-700", "sside"));
    side.push(r(0, footH + t + sideH, D, t, "fill-stone-50 stroke-stone-700", "stop"));
    side.push(r(doorZone + sideD, footH, tb, t + sideH, "fill-stone-200 stroke-stone-700", "sback"));
    const hasDoor = cabinet.modules.some((m) => m.doors.length);
    if (hasDoor) {
      const g = mm(cabinet.panels.find((p) => p.role === "DOOR")?.placement.z_um ?? 2000);
      const doorH = mm(cabinet.panels.find((p) => p.role === "DOOR")?.placement.size.height_um ?? 0);
      side.push(r(0, footH + g, t, doorH, "fill-white stroke-stone-700", "sdoor"));
    }
    dims.push(<Dim key="d" x1={sx} x2={sx + D * s} y={dimY} label={`${D} mm`} />);
    side.push(
      <text key="side-label" x={sx + (D * s) / 2} y={yBase + 22} textAnchor="middle" className="fill-stone-500 text-[10px]">
        side
      </text>,
    );
  }

  return (
    <svg viewBox={`0 0 ${width} ${height + 20}`} width="100%" role="img" aria-label={title ?? `Front and side elevation, ${W} × ${H} × ${D} mm`} className="select-none">
      {title && (
        <text x={x0} y={18} className="fill-stone-600 text-[11px] font-semibold">
          {title}
        </text>
      )}
      <line x1={x0 - 20} y1={yBase} x2={x0 + totalW * s + 20} y2={yBase} className="stroke-stone-300" />
      {front}
      {side}
      {dims}
    </svg>
  );
}

function order(role: string): number {
  return ["BOTTOM", "SIDE_L", "SIDE_R", "TOP", "SHELF", "DOOR", "BACK"].indexOf(role);
}

function Dim({ x1, x2, y, label, small = false }: { x1: number; x2: number; y: number; label: string; small?: boolean }) {
  return (
    <g className="stroke-stone-500">
      <line x1={x1} y1={y} x2={x2} y2={y} />
      <line x1={x1} y1={y - 4} x2={x1} y2={y + 4} />
      <line x1={x2} y1={y - 4} x2={x2} y2={y + 4} />
      <text x={(x1 + x2) / 2} y={y - 4} textAnchor="middle" className={`fill-stone-700 stroke-none ${small ? "text-[9px]" : "text-[11px] font-semibold"}`}>
        {label}
      </text>
    </g>
  );
}

function VDim({ x, y1, y2, label }: { x: number; y1: number; y2: number; label: string }) {
  return (
    <g className="stroke-stone-500">
      <line x1={x} y1={y1} x2={x} y2={y2} />
      <line x1={x - 4} y1={y1} x2={x + 4} y2={y1} />
      <line x1={x - 4} y1={y2} x2={x + 4} y2={y2} />
      <text x={x + 6} y={(y1 + y2) / 2} dominantBaseline="middle" className="fill-stone-700 stroke-none text-[11px] font-semibold">
        {label}
      </text>
    </g>
  );
}

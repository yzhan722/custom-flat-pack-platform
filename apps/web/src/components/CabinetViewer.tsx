"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CompiledCabinet } from "@cfp/core";

export type ViewPreset = "3d" | "front" | "side" | "top";

/**
 * Three.js preview built directly from compiled panel placements, so what the
 * customer rotates is the same geometry that goes to the factory (FR-03). The
 * cabinet frame is front-left-bottom with X right, Y into the depth and Z up;
 * three.js is Y-up, so Y_three = Z_cab and Z_three = -Y_cab (front faces +Z).
 */
export function CabinetViewer({
  cabinet,
  doorsOpen,
  view,
  showDimensions,
  className,
}: {
  cabinet: CompiledCabinet | null;
  doorsOpen: boolean;
  view: ViewPreset;
  showDimensions: boolean;
  className?: string;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    model: THREE.Group;
    doors: Array<{ pivot: THREE.Group; sign: number }>;
    labels: THREE.Group;
    frame: number;
  } | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, mount.clientWidth / Math.max(1, mount.clientHeight), 0.05, 50);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 + 0.05;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xd6d3d1, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-3, 2, -2);
    scene.add(fill);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0xf5f5f4, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.001;
    scene.add(floor);
    const grid = new THREE.GridHelper(8, 32, 0xe7e5e4, 0xefeeed);
    grid.position.y = 0;
    scene.add(grid);

    const model = new THREE.Group();
    const labels = new THREE.Group();
    scene.add(model, labels);

    const state = { renderer, scene, camera, controls, model, doors: [] as Array<{ pivot: THREE.Group; sign: number }>, labels, frame: 0 };
    sceneRef.current = state;

    const animate = () => {
      state.frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(state.frame);
      ro.disconnect();
      controls.dispose();
      disposeGroup(model);
      disposeGroup(labels);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  // Rebuild the model when the compiled cabinet changes.
  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    disposeGroup(st.model);
    disposeGroup(st.labels);
    st.doors = [];
    if (!cabinet) return;
    const m = 1 / 1_000_000; // µm -> metres
    const footH = cabinet.dims.footHeight_um * m;
    const W = cabinet.dims.finished.width_um * m;
    const H = cabinet.dims.finished.height_um * m;
    const D = cabinet.dims.finished.depth_um * m;

    const board = new THREE.MeshStandardMaterial({ color: 0xf7f6f3, roughness: 0.55, metalness: 0.02 });
    const back = new THREE.MeshStandardMaterial({ color: 0xe9e7e2, roughness: 0.8 });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x9c9891 });
    const doorsById = new Map(cabinet.modules.flatMap((mod) => mod.doors.map((d) => [d.panelId, d] as const)));

    for (const p of cabinet.panels) {
      const sx = p.placement.size.width_um * m;
      const sy = p.placement.size.height_um * m;
      const sz = p.placement.size.depth_um * m;
      const geo = new THREE.BoxGeometry(sx, sy, sz);
      const mesh = new THREE.Mesh(geo, p.role === "BACK" ? back : board);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
      mesh.add(edges);
      const x = p.placement.x_um * m;
      const y = p.placement.z_um * m + footH;
      const z = -(p.placement.y_um * m);
      const door = doorsById.get(p.id);
      if (door) {
        const pivot = new THREE.Group();
        const hingeX = door.hingeSide === "L" ? x : x + sx;
        pivot.position.set(hingeX, y + sy / 2, z);
        mesh.position.set(door.hingeSide === "L" ? sx / 2 : -sx / 2, 0, -sz / 2);
        pivot.add(mesh);
        // Handle as a small bar on the front face.
        const handleOps = p.operations.filter((o) => o.purpose === "handle");
        if (handleOps.length === 2) {
          const hx = handleOps[0]!.x_um * m - (door.hingeSide === "L" ? 0 : sx);
          const y1 = handleOps[0]!.y_um * m;
          const y2 = handleOps[1]!.y_um * m;
          const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, Math.abs(y1 - y2) + 0.02, 12), new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.7, roughness: 0.3 }));
          bar.position.set(hx, (y1 + y2) / 2 - sy / 2, 0.012);
          pivot.add(bar);
        }
        st.model.add(pivot);
        st.doors.push({ pivot, sign: door.hingeSide === "L" ? -1 : 1 });
      } else {
        mesh.position.set(x + sx / 2, y + sy / 2, z - sz / 2);
        st.model.add(mesh);
      }
    }

    // Feet.
    const footMat = new THREE.MeshStandardMaterial({ color: 0x3f3f46, roughness: 0.6 });
    for (const mod of cabinet.modules) {
      const ox = mod.offsetX_um * m;
      const w = mod.width_um * m;
      const depth = cabinet.dims.sideDepth_um * m;
      const front = -(cabinet.dims.doorZone_um * m);
      const inset = 0.04;
      const feet: Array<[number, number]> = [
        [ox + inset, front - inset],
        [ox + w - inset, front - inset],
        [ox + inset, front - depth + inset],
        [ox + w - inset, front - depth + inset],
      ];
      for (const [fx, fz] of feet) {
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, footH, 16), footMat);
        foot.position.set(fx, footH / 2, fz);
        st.model.add(foot);
      }
    }

    // Dimension labels.
    st.labels.add(label(`${Math.round(W * 1000)} mm`, W / 2, H + 0.08, 0.05));
    st.labels.add(label(`${Math.round(H * 1000)} mm`, W + 0.1, H / 2, 0.05));
    st.labels.add(label(`${Math.round(D * 1000)} mm`, W + 0.1, 0.04, -D / 2));

    fitCamera(st, view, W, H, D);
  }, [cabinet]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const st = sceneRef.current;
    if (!st || !cabinet) return;
    const m = 1 / 1_000_000;
    fitCamera(st, view, cabinet.dims.finished.width_um * m, cabinet.dims.finished.height_um * m, cabinet.dims.finished.depth_um * m);
  }, [view, cabinet]);

  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    for (const d of st.doors) d.pivot.rotation.y = doorsOpen ? d.sign * (Math.PI / 2) * 1.05 : 0;
  }, [doorsOpen, cabinet]);

  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    st.labels.visible = showDimensions;
  }, [showDimensions, cabinet]);

  return (
    <div ref={mountRef} className={className ?? "h-[420px] w-full"} aria-label="3D preview">
      {!cabinet && <p className="p-4 text-sm text-ink-soft">Fix the configuration to see the 3D preview.</p>}
    </div>
  );
}

function fitCamera(st: { camera: THREE.PerspectiveCamera; controls: OrbitControls }, view: ViewPreset, W: number, H: number, D: number) {
  const target = new THREE.Vector3(W / 2, H / 2, -D / 2);
  const radius = Math.max(W, H, D) * 1.9 + 0.6;
  const pos = new THREE.Vector3();
  switch (view) {
    case "front":
      pos.set(W / 2, H / 2, radius);
      break;
    case "side":
      pos.set(W / 2 + radius, H / 2, -D / 2);
      break;
    case "top":
      pos.set(W / 2, radius, -D / 2 + 0.001);
      break;
    default:
      pos.set(W / 2 + radius * 0.7, H / 2 + radius * 0.45, radius * 0.75);
  }
  st.camera.position.copy(pos);
  st.controls.target.copy(target);
  st.controls.update();
}

function label(text: string, x: number, y: number, z: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(28,25,23,0.85)";
  roundRect(ctx, 4, 8, 248, 48, 10);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "600 26px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(0.24, 0.06, 1);
  sprite.position.set(x, y, z);
  return sprite;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function disposeGroup(group: THREE.Group) {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) {
      const anyMat = mat as THREE.SpriteMaterial;
      if (anyMat.map) anyMat.map.dispose();
      mat.dispose();
    }
  });
  group.clear();
}

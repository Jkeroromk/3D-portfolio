import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { DoubleSide, MeshBasicMaterial } from "three";
import { live } from "./lighting.js";
import { MOBILE } from "./device.js";
import { renderFlags } from "./renderFlags.js";

/*
 * Takes over rendering while the room is on screen.
 *
 * Night: the baked night shader reads five textures and runs AgX per pixel,
 * and the room has a lot of overlapping geometry. A depth-only pre-pass first
 * means each screen pixel runs that shader once instead of once per layer of
 * furniture. (Phones skip it: their GPUs already discard hidden pixels.)
 *
 * Adaptive resolution: if frames keep running long, the pixel ratio steps
 * down a little; when there is headroom again it steps back up.
 */
export default function RoomRenderer() {
  const { gl, setDpr } = useThree();
  const depthOnly = useMemo(() => new MeshBasicMaterial({ colorWrite: false, side: DoubleSide }), []);
  const maxDpr = useMemo(() => Math.min(window.devicePixelRatio || 1, 1.5), []);
  const perf = useRef({ dpr: maxDpr, avg: 16.7, slow: 0, fast: 0, last: performance.now() });
  const hidden = useMemo(() => [], []);

  useEffect(() => {
    setDpr(maxDpr);
    return () => {
      gl.autoClear = true;
      depthOnly.dispose();
    };
  }, []);

  useFrame(({ scene, camera }) => {
    // --- adaptive resolution
    const p = perf.current;
    const now = performance.now();
    const ms = Math.min(100, now - p.last);
    p.last = now;
    p.avg += (ms - p.avg) * 0.08;
    if (p.avg > 19.5) {
      p.slow += ms;
      p.fast = 0;
      if (p.slow > 1500 && p.dpr > 0.75) {
        p.dpr = Math.max(0.75, +(p.dpr - 0.15).toFixed(2));
        setDpr(p.dpr);
        p.slow = 0;
      }
    } else if (p.avg < 15.5 || (p.avg < 17.6 && p.dpr < maxDpr)) {
      p.fast += ms;
      p.slow = 0;
      if (p.fast > 5000 && p.dpr < maxDpr) {
        p.dpr = Math.min(maxDpr, +(p.dpr + 0.1).toFixed(2));
        setDpr(p.dpr);
        p.fast = 0;
      }
    }

    // --- draw
    const usePrepass = !MOBILE && live.night > 0.02 && !renderFlags.revealing;
    if (!usePrepass) {
      gl.autoClear = true;
      gl.render(scene, camera);
      return;
    }
    gl.autoClear = false;
    gl.clear();
    hidden.length = 0;
    renderFlags.hideInPrepass.forEach((shouldHide, obj) => {
      if (obj.visible && shouldHide(obj)) {
        obj.visible = false;
        hidden.push(obj);
      }
    });
    renderFlags.prepass = true;
    scene.overrideMaterial = depthOnly;
    gl.render(scene, camera);
    scene.overrideMaterial = null;
    renderFlags.prepass = false;
    hidden.forEach((o) => (o.visible = true));
    gl.render(scene, camera);
  }, 1);

  return null;
}

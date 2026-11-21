import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { DoubleSide, MeshBasicMaterial } from "three";
import { live } from "./lighting.js";
import { MOBILE } from "./device.js";
import { renderFlags, REVEAL } from "./renderFlags.js";

/*
 * Takes over rendering while the room is on screen.
 *
 * Night: the baked night shader reads five textures and runs AgX per pixel,
 * and the room has a lot of overlapping geometry. A depth-only pre-pass first
 * means each screen pixel runs that shader once instead of once per layer of
 * furniture. (Phones skip it: their GPUs already discard hidden pixels.)
 *
 * Pacing: on a 240 Hz screen a frame that takes 6 ms on the GPU lands on
 * every second refresh sometimes and every third other times, which reads as
 * judder while the camera moves. So frames are drawn on a fixed beat - every
 * Nth refresh - picked from the measured GPU time (EXT_disjoint_timer_query),
 * and the resolution is chosen the same way. Big screens start from a pixel
 * budget so the very first frames (the print-out) are already light enough.
 * Both are only changed while the view is at rest, never mid-animation.
 */
const PIXEL_BUDGET = 3.7e6; // ~2560x1440 drawn pixels
const MIN_DPR = 0.5;
const MIN_FPS = 55; // never pace below this
const LOG = /-projects\.vercel\.app$|^localhost$/.test(window.location.hostname) || /[?&]perf/.test(window.location.search);
const log = (...a) => LOG && console.log(...a);

function gpuTimer(gl) {
  const ctx = gl.getContext();
  const ext = !MOBILE && ctx.createQuery && ctx.getExtension("EXT_disjoint_timer_query_webgl2");
  if (!ext) return null;
  const pending = [];
  let active = null;
  return {
    begin() {
      if (pending.length > 8) return; // results are late: don't pile up
      active = ctx.createQuery();
      ctx.beginQuery(ext.TIME_ELAPSED_EXT, active);
    },
    end() {
      if (!active) return;
      ctx.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    poll(out) {
      const disjoint = ctx.getParameter(ext.GPU_DISJOINT_EXT);
      while (pending.length && ctx.getQueryParameter(pending[0], ctx.QUERY_RESULT_AVAILABLE)) {
        const q = pending.shift();
        if (!disjoint) out.push(ctx.getQueryParameter(q, ctx.QUERY_RESULT) / 1e6);
        ctx.deleteQuery(q);
      }
    },
    dispose() {
      pending.forEach((q) => ctx.deleteQuery(q));
      pending.length = 0;
    },
  };
}

const step = (v) => Math.round(v * 20) / 20; // 0.05 steps

export default function RoomRenderer() {
  const { gl, setDpr } = useThree();
  const size = useThree((s) => s.size);
  // pushed back a hair so the colour pass always passes where it should.
  // It cuts at the scan line like the room does, so it also works mid-print.
  const depthOnly = useMemo(() => {
    const m = new MeshBasicMaterial({
      colorWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 2,
    });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uReveal = REVEAL;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vRevealY;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvRevealY = (modelMatrix * vec4(transformed, 1.0)).y;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uReveal;\nvarying float vRevealY;")
        .replace("void main() {", "void main() {\n  if (vRevealY > uReveal) discard;");
    };
    return m;
  }, []);
  const timer = useMemo(() => gpuTimer(gl), [gl]);
  const hidden = useMemo(() => [], []);
  const P = useRef(null);
  if (!P.current) {
    P.current = {
      maxDpr: Math.min(window.devicePixelRatio || 1, 1.5),
      dpr: 1,
      vs: 1000 / 60, // refresh interval
      ticks: [],
      tickCount: 0,
      N: 1, // draw every Nth refresh
      maxN: 1,
      lastTick: performance.now(),
      lastRender: 0,
      gpu: null, // averaged GPU ms per frame
      results: [],
      lastChange: performance.now(),
      lastCheck: 0,
      upBlockedUntil: 0,
      // no timer: judge by the time between frames instead
      avg: 0,
      slow: 0,
      fast: 0,
    };
  }

  // start from the pixel budget (and again whenever the window is resized)
  useEffect(() => {
    const p = P.current;
    const px = Math.max(1, size.width * size.height);
    const budget = Math.sqrt(PIXEL_BUDGET / px);
    p.dpr = Math.max(MIN_DPR, Math.min(p.maxDpr, step(budget)));
    p.gpu = null;
    p.lastChange = performance.now();
    setDpr(p.dpr);
    log("[pace] start", JSON.stringify({ css: `${size.width}x${size.height}`, dpr: p.dpr }));
  }, [size.width, size.height]);

  useEffect(() => {
    renderFlags.paced = true;
    return () => {
      renderFlags.paced = false;
      renderFlags.rendered.length = 0;
      gl.autoClear = true;
      depthOnly.dispose();
      timer && timer.dispose();
    };
  }, []);

  function setRes(p, dpr, why) {
    dpr = Math.max(MIN_DPR, Math.min(p.maxDpr, step(dpr)));
    if (dpr === p.dpr) return false;
    p.dpr = dpr;
    p.gpu = null;
    p.lastChange = performance.now();
    setDpr(dpr);
    log("[pace] dpr", dpr, why);
    return true;
  }
  function setN(p, n, why) {
    n = Math.max(1, Math.min(p.maxN, n));
    if (n === p.N) return false;
    p.N = n;
    p.lastChange = performance.now();
    log("[pace] fps", Math.round(1000 / (n * p.vs)), why);
    return true;
  }

  // GPU-timed: keep a frame's GPU work under ~80% of its slot
  function adaptTimed(p, now) {
    const slot = p.N * p.vs;
    const g = p.gpu;
    if (g > 0.8 * slot) {
      if (setN(p, Math.ceil(g / (0.7 * p.vs)), `gpu ${g.toFixed(1)}ms`)) return;
      // already at the lowest frame rate: draw fewer pixels
      const want = p.dpr * Math.sqrt((0.7 * slot) / g);
      if (setRes(p, Math.min(want, p.dpr - 0.05), `gpu ${g.toFixed(1)}ms`)) p.upBlockedUntil = now + 20000;
      return;
    }
    if (now < p.upBlockedUntil) return;
    // headroom: sharper first, then smoother
    if (p.dpr < p.maxDpr) {
      // one jump to what fits, rather than many small resizes
      const next = Math.min(p.maxDpr, Math.floor(p.dpr * Math.sqrt((0.6 * slot) / g) * 20) / 20);
      if (next >= p.dpr + 0.05) setRes(p, next, `headroom ${g.toFixed(1)}ms`);
      else if (p.N > 1 && g < 0.65 * (p.N - 1) * p.vs) setN(p, p.N - 1, `headroom ${g.toFixed(1)}ms`);
      return;
    }
    if (p.N > 1 && g < 0.65 * (p.N - 1) * p.vs) setN(p, p.N - 1, `headroom ${g.toFixed(1)}ms`);
  }

  // no GPU timer (phones, Safari): judge by the time between drawn frames
  function adaptUntimed(p, interval) {
    const slot = p.N * p.vs;
    p.avg += (interval - p.avg) * 0.08;
    if (p.avg > slot * 1.18) {
      p.slow += interval;
      p.fast = 0;
      if (p.slow > 1500) {
        p.slow = 0;
        if (!setN(p, p.N + 1, "late frames")) setRes(p, p.dpr - 0.15, "late frames");
      }
    } else if (p.avg < slot * 1.05) {
      p.fast += interval;
      p.slow = 0;
      if (p.fast > 5000) {
        p.fast = 0;
        if (!setRes(p, p.dpr + 0.1, "steady")) setN(p, p.N - 1, "steady");
      }
    }
  }

  useFrame(({ scene, camera }) => {
    const p = P.current;
    const now = performance.now();
    const tick = now - p.lastTick;
    p.lastTick = now;

    // refresh interval: the median of recent rAF intervals (loading hitches
    // and catch-up ticks are ignored by the median; skipped refreshes on a
    // paced beat land exactly on it)
    if (renderFlags.phase === "loading") p.ticks.length = 0;
    else p.ticks.push(tick);
    if (p.ticks.length > 120) p.ticks.shift();
    if (++p.tickCount % 30 === 0 && p.ticks.length >= 60) {
      const sorted = [...p.ticks].sort((a, b) => a - b);
      p.vs = Math.min(34, Math.max(3, sorted[sorted.length >> 1]));
      p.maxN = Math.max(1, Math.floor(1000 / p.vs / MIN_FPS));
      if (!p.calibrated) {
        // high-refresh screens start on a 60-ish beat; it speeds up at rest if the GPU allows
        p.calibrated = true;
        p.N = p.maxN;
        log("[pace] refresh", Math.round(1000 / p.vs), "Hz, start at", Math.round(1000 / (p.N * p.vs)), "fps");
      }
      if (p.N > p.maxN) p.N = p.maxN;
    }

    // GPU results arrive a few frames late
    if (timer) {
      p.results.length = 0;
      timer.poll(p.results);
      for (const ms of p.results) p.gpu = p.gpu === null ? ms : p.gpu + (ms - p.gpu) * 0.1;
    }

    // on the beat? (half a refresh of slack so a late tick doesn't skip a frame)
    const sinceLast = now - p.lastRender;
    if (p.N > 1 && sinceLast < (p.N - 0.5) * p.vs) return;
    p.lastRender = now;
    if (sinceLast < 200) renderFlags.rendered.push(sinceLast);
    if (renderFlags.rendered.length > 600) renderFlags.rendered.length = 0;

    // only adapt while nothing moves and the lights have settled
    const atRest =
      (renderFlags.phase === "idle" || renderFlags.phase === "focused") &&
      now - (live.changedAt || 0) > 1800 &&
      now - p.lastChange > 2500 &&
      !document.hidden;
    if (!atRest) {
      p.slow = p.fast = 0;
      p.avg = p.N * p.vs;
    } else if (timer) {
      if (p.gpu !== null && now - p.lastCheck > 1000) {
        p.lastCheck = now;
        adaptTimed(p, now);
      }
    } else if (sinceLast < 200) {
      adaptUntimed(p, sinceLast);
    }
    renderFlags.gpuMs = p.gpu;
    renderFlags.capFps = Math.round(1000 / (p.N * p.vs));

    // --- draw
    const c0 = performance.now();
    timer && timer.begin();
    draw(scene, camera);
    timer && timer.end();
    renderFlags.cpuMs = performance.now() - c0;
  }, 1);

  function draw(scene, camera) {
    const usePrepass = !MOBILE && live.night > 0.02;
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
  }

  return null;
}

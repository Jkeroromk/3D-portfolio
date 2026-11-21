import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { renderFlags } from "./renderFlags.js";

// Per-phase summary (print, swing, enter, zoom-in, ...) and every long frame,
// with what changed on the GPU side during it, so hitches can be traced.
function phaseTracker(gl) {
  const t = { phase: renderFlags.phase, times: [], last: null };
  const snap = () => ({
    programs: (gl.info.programs || []).length,
    textures: gl.info.memory.textures,
    geometries: gl.info.memory.geometries,
    dpr: gl.getPixelRatio(),
  });
  let prev = snap();
  return (ms) => {
    const now = snap();
    if (ms > 25) {
      const d = {};
      for (const k of Object.keys(now)) if (now[k] !== prev[k]) d[k] = `${prev[k]}->${now[k]}`;
      console.log("[hitch]", JSON.stringify({ ms: +ms.toFixed(1), phase: renderFlags.phase, cpu: +renderFlags.cpuMs.toFixed(1), ...d }));
    }
    prev = now;
    if (renderFlags.phase !== t.phase) {
      if (t.times.length > 5) {
        const sorted = [...t.times].sort((a, b) => a - b);
        const avg = t.times.reduce((a, b) => a + b, 0) / t.times.length;
        console.log(
          "[phase]",
          JSON.stringify({
            phase: t.phase,
            frames: t.times.length,
            fps: Math.round(1000 / avg),
            p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
            worst: +sorted[sorted.length - 1].toFixed(1),
            over25: t.times.filter((x) => x > 25).length,
            late: renderFlags.paced && renderFlags.capFps ? t.times.filter((x) => x > (1250 / renderFlags.capFps)).length : undefined,
            gpu: renderFlags.gpuMs != null ? +renderFlags.gpuMs.toFixed(1) : undefined,
          })
        );
      }
      t.phase = renderFlags.phase;
      t.times = [];
    }
    t.times.push(ms);
  };
}

// FPS / frame-time readout. On by default on Vercel preview deployments and with ?perf;
// toggle with the ` key. Every 2 s it also logs a [perf] line to the console.
export function perfEnabledByDefault() {
  const q = new URLSearchParams(window.location.search);
  if (q.has("perf")) return q.get("perf") !== "0";
  // previews live on <project>-<hash|git-branch>-jkeroromks-projects.vercel.app;
  // the production domain doesn't, so the readout stays hidden there
  const host = window.location.hostname;
  return /-projects\.vercel\.app$/.test(host) || host === "localhost";
}

export default function PerfStats() {
  const { gl } = useThree();
  const el = useRef(null);
  const track = useRef(null);
  const s = useRef({ frames: 0, t0: performance.now(), last: performance.now(), times: [], logT: performance.now() });

  useEffect(() => {
    const div = document.createElement("div");
    div.className = "perf-stats";
    div.style.display = perfEnabledByDefault() ? "block" : "none";
    document.body.appendChild(div);
    el.current = div;
    const onKey = (e) => {
      if (e.key === "`") div.style.display = div.style.display === "none" ? "block" : "none";
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      div.remove();
    };
  }, []);

  useFrame(() => {
    const now = performance.now();
    const st = s.current;
    if (!track.current) track.current = phaseTracker(gl);
    // the room renderer may skip refreshes to keep an even beat: count the
    // frames it actually drew; elsewhere every tick is a frame
    const drawn = renderFlags.paced ? renderFlags.rendered.splice(0) : [now - st.last];
    st.last = now;
    for (const ms of drawn) {
      track.current(ms);
      st.times.push(ms);
      st.frames++;
    }
    const elapsed = now - st.t0;
    if (elapsed < 500) return;
    const fps = (st.frames * 1000) / elapsed;
    const sorted = [...st.times].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const worst = sorted[sorted.length - 1] || 0;
    const info = gl.info;
    const dpr = gl.getPixelRatio();
    const size = gl.getDrawingBufferSize ? gl.domElement : null;
    const line = {
      fps: Math.round(fps),
      p95ms: +p95.toFixed(1),
      worstMs: +worst.toFixed(1),
      calls: info.render.calls,
      tris: info.render.triangles,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      dpr: +dpr.toFixed(2),
      px: size ? `${size.width}x${size.height}` : "",
      gpuMs: renderFlags.paced && renderFlags.gpuMs != null ? +renderFlags.gpuMs.toFixed(1) : undefined,
      cap: renderFlags.paced ? renderFlags.capFps : undefined,
    };
    if (el.current && el.current.style.display !== "none") {
      el.current.textContent =
        `${line.fps} fps  ·  p95 ${line.p95ms} ms  ·  worst ${line.worstMs} ms\n` +
        `${line.calls} calls  ·  ${(line.tris / 1e6).toFixed(2)}M tris  ·  ${line.textures} tex  ·  ${line.px} @${line.dpr}x` +
        (line.cap ? `\ngpu ${line.gpuMs ?? "-"} ms  ·  paced at ${line.cap} fps` : "");
    }
    if (now - st.logT > 2000) {
      console.log("[perf]", JSON.stringify(line));
      st.logT = now;
    }
    st.frames = 0;
    st.times.length = 0;
    st.t0 = now;
  });
  return null;
}

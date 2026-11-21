import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

// FPS / frame-time readout. On by default on Vercel previews and with ?perf;
// toggle with the ` key. Every 2 s it also logs a [perf] line to the console.
export function perfEnabledByDefault() {
  const q = new URLSearchParams(window.location.search);
  if (q.has("perf")) return q.get("perf") !== "0";
  return /vercel\.app$/.test(window.location.hostname) || window.location.hostname === "localhost";
}

export default function PerfStats() {
  const { gl } = useThree();
  const el = useRef(null);
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
    st.times.push(now - st.last);
    st.last = now;
    st.frames++;
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
    };
    if (el.current && el.current.style.display !== "none") {
      el.current.textContent =
        `${line.fps} fps  ·  p95 ${line.p95ms} ms  ·  worst ${line.worstMs} ms\n` +
        `${line.calls} calls  ·  ${(line.tris / 1e6).toFixed(2)}M tris  ·  ${line.textures} tex  ·  ${line.px} @${line.dpr}x`;
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

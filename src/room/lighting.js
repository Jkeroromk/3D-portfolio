import { Color } from "three";

// The six light layers baked separately in Blender (white light, irradiance
// only). Order matters: it matches the layer textures in the manifest.
export const LAYER_NAMES = ["nano", "deskwall", "underdesk", "ceiling", "lamps", "sofa"];

const c = (r, g, b) => [r, g, b];

/*
 * Each preset gives every layer a linear RGB colour and an intensity.
 * "gaming" reproduces the colours used for the original night render.
 * nano: the three Nanoleaf gradient stops (bottom -> top of the panel).
 */
export const PRESETS = {
  day: {
    label: "Day",
    icon: "☀",
    night: 0,
    accent: "#ffc24d",
    bg: ["#e9e4dc", "#b9c3d1"],
    sky: ["#6e98c9", "#dfe7ee"], // zenith, horizon
    water: "#21455a",
    layers: {},
    nano: [c(1, 1, 1), c(1, 1, 1), c(1, 1, 1)],
  },
  gaming: {
    label: "Gaming",
    icon: "🎮",
    night: 1,
    accent: "#b07bff",
    bg: ["#1d0f38", "#05030b"],
    sky: ["#07040f", "#2b1652"], // zenith, horizon
    water: "#0b0818",
    layers: {
      nano: [c(0.75, 0.4, 1.0), 1],
      deskwall: [c(0.35, 0.55, 1.0), 1],
      underdesk: [c(0.65, 0.3, 1.0), 1],
      ceiling: [c(1.0, 0.76, 0.52), 1],
      lamps: [c(1.0, 0.72, 0.45), 1],
      sofa: [c(0.9, 0.35, 1.0), 1],
    },
    nano: [c(0.45, 0.15, 1.0), c(1.0, 0.25, 0.65), c(0.15, 0.75, 1.0)],
  },
  focus: {
    label: "Focus",
    icon: "⌨",
    night: 1,
    accent: "#9fd4ff",
    bg: ["#132233", "#04080d"],
    sky: ["#050a12", "#1a2e44"], // zenith, horizon
    water: "#07101a",
    layers: {
      nano: [c(0.85, 0.92, 1.0), 0.45],
      deskwall: [c(0.85, 0.92, 1.0), 0.55],
      underdesk: [c(0.9, 0.95, 1.0), 0.3],
      ceiling: [c(0.95, 0.97, 1.0), 2.2],
      lamps: [c(1.0, 0.95, 0.88), 1.6],
      sofa: [c(1, 1, 1), 0],
    },
    nano: [c(0.8, 0.9, 1.0), c(0.9, 0.95, 1.0), c(1.0, 1.0, 1.0)],
  },
  relax: {
    label: "Relax",
    icon: "🕯",
    night: 1,
    accent: "#ff9a4d",
    bg: ["#2c1408", "#090403"],
    sky: ["#0d0604", "#4a2414"], // zenith, horizon
    water: "#120805",
    layers: {
      nano: [c(1.0, 0.5, 0.18), 0.9],
      deskwall: [c(1.0, 0.45, 0.15), 0.55],
      underdesk: [c(1.0, 0.4, 0.12), 0.45],
      ceiling: [c(1.0, 0.7, 0.45), 0.35],
      lamps: [c(1.0, 0.66, 0.38), 1.25],
      sofa: [c(1.0, 0.42, 0.15), 0.9],
    },
    nano: [c(1.0, 0.32, 0.08), c(1.0, 0.55, 0.18), c(1.0, 0.75, 0.35)],
  },
  movie: {
    label: "Movie",
    icon: "🎬",
    night: 1,
    accent: "#6b7bff",
    bg: ["#0b0c1c", "#010103"],
    sky: ["#020204", "#121224"], // zenith, horizon
    water: "#040408",
    layers: {
      nano: [c(0.2, 0.25, 1.0), 0.18],
      deskwall: [c(0.3, 0.35, 1.0), 0.35],
      underdesk: [c(0.4, 0.3, 1.0), 0.15],
      ceiling: [c(1, 1, 1), 0],
      lamps: [c(1, 1, 1), 0],
      sofa: [c(0.5, 0.25, 1.0), 0.4],
    },
    nano: [c(0.1, 0.12, 0.6), c(0.2, 0.15, 0.7), c(0.15, 0.3, 0.8)],
  },
};

export const PRESET_ORDER = ["day", "gaming", "focus", "relax", "movie"];

export function defaultPreset() {
  const h = new Date().getHours();
  return h >= 7 && h < 18 ? "day" : "gaming";
}

/* ---------- live, smoothly animated lighting state ---------- */

function target(key) {
  const p = PRESETS[key] || PRESETS.day;
  return {
    night: p.night,
    layers: LAYER_NAMES.map((n) => {
      const l = p.layers[n];
      if (!l) return [0, 0, 0];
      return l[0].map((v) => v * l[1]);
    }),
    nano: p.nano.map((s) => [...s]),
    nanoGain: p.layers.nano ? p.layers.nano[1] : 0,
    lampGain: p.layers.lamps ? p.layers.lamps[1] : 0,
    skyTop: new Color(p.sky[0]),
    skyHorizon: new Color(p.sky[1]),
    water: new Color(p.water),
    bgTop: new Color(p.bg[0]),
    bgBottom: new Color(p.bg[1]),
    accent: new Color(p.accent),
  };
}

export const live = target("day");
// intro gains: everything starts dark and is switched on during the intro
live.intro = { day: 0, base: 0, layers: LAYER_NAMES.map(() => 0) };

let goal = target("day");
export function setPresetTarget(key) {
  goal = target(key);
}

const lerp = (a, b, k) => a + (b - a) * k;

export function stepLighting(dt) {
  const k = 1 - Math.exp(-dt * 3.2);
  live.night = lerp(live.night, goal.night, k);
  live.layers.forEach((col, i) => col.forEach((v, j) => (col[j] = lerp(v, goal.layers[i][j], k))));
  live.nano.forEach((col, i) => col.forEach((v, j) => (col[j] = lerp(v, goal.nano[i][j], k))));
  live.nanoGain = lerp(live.nanoGain, goal.nanoGain, k);
  live.lampGain = lerp(live.lampGain, goal.lampGain, k);
  live.skyTop.lerp(goal.skyTop, k);
  live.skyHorizon.lerp(goal.skyHorizon, k);
  live.water.lerp(goal.water, k);
  live.bgTop.lerp(goal.bgTop, k);
  live.bgBottom.lerp(goal.bgBottom, k);
  live.accent.lerp(goal.accent, k);
}

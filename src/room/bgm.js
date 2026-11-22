import { useSyncExternalStore } from "react";
import { BGM } from "./roomConfig.js";

// One <audio> for the whole site, so the music keeps playing when the scene
// changes (e.g. into the MacBook and back).

const KEY = "room-bgm-paused";
const tracks = BGM.tracks || [];
let audio = null;
let snap = { index: 0, playing: false, count: tracks.length };
const listeners = new Set();

function set(patch) {
  snap = { ...snap, ...patch };
  listeners.forEach((f) => f());
}

function remember(paused) {
  try {
    if (paused) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // private mode etc.: nothing to remember
  }
}

function wasPaused() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let fadeRaf = 0;
function fadeTo(target, ms, done) {
  cancelAnimationFrame(fadeRaf);
  const a = audio;
  const from = a.volume;
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    a.volume = from + (target - from) * k;
    if (k < 1) fadeRaf = requestAnimationFrame(step);
    else done && done();
  };
  step();
}

function el() {
  if (!audio) {
    audio = new Audio();
    audio.preload = "none";
    audio.volume = 0;
    audio.addEventListener("ended", () => next(true));
    audio.addEventListener("pause", () => snap.playing && !audio.ended && set({ playing: false }));
  }
  return audio;
}

function load(i) {
  const a = el();
  a.src = tracks[i].src;
  set({ index: i });
}

export function play() {
  if (!tracks.length) return;
  const a = el();
  if (!a.getAttribute("src")) load(snap.index);
  a.volume = 0;
  a.play()
    .then(() => {
      set({ playing: true });
      fadeTo(BGM.volume ?? 0.35, 900);
    })
    .catch(() => set({ playing: false }));
}

export function pause() {
  if (!audio) return;
  set({ playing: false });
  fadeTo(0, 400, () => audio.pause());
}

export function toggle() {
  if (snap.playing) {
    pause();
    remember(true);
  } else {
    play();
    remember(false);
  }
}

export function next(auto = false) {
  if (tracks.length < 1) return;
  const wasPlaying = snap.playing || auto;
  load((snap.index + 1) % tracks.length);
  if (wasPlaying) play();
}

// called from the Enter button (a click, so the browser allows sound)
export function startOnEnter() {
  if (BGM.startOnEnter && tracks.length && !wasPaused()) play();
}

export function useBgm() {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => snap
  );
}

export function trackInfo(i) {
  return tracks[i] || null;
}

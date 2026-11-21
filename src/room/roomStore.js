import { useSyncExternalStore } from "react";
import { defaultPreset } from "./lighting.js";

// Tiny shared store so the HTML overlay (outside the canvas) and the 3D room
// (inside the canvas) agree on day/night and on whether the credits are open.
let state = {
  preset: defaultPreset(),
  started: false,
  ready: false,
  loadingNight: false,
  credits: false,
  focus: null,
  hover: null,
  introPlayed: false,
};
const listeners = new Set();

export function setRoomState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getRoomState() {
  return state;
}

function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useRoomState() {
  return useSyncExternalStore(subscribe, getRoomState);
}

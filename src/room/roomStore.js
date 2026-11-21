import { useSyncExternalStore } from "react";

// Tiny shared store so the HTML overlay (outside the canvas) and the 3D room
// (inside the canvas) agree on day/night and on whether the credits are open.
let state = { night: false, credits: false, ready: false, loadingNight: false };
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

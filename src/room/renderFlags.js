// Shared between the room, the water and the renderer.

// World height below which the room is visible (the scan-line "print").
// Shared by every room material and by the depth pre-pass.
export const REVEAL = { value: 10 };

export const renderFlags = {
  // true while the depth-only pre-pass is drawing (the water skips its
  // reflection render then)
  prepass: false,
  // true while the scan-line reveal runs
  revealing: false,
  // transparent things that must not write depth in the pre-pass:
  // fn(object) -> true when it should be hidden right now
  hideInPrepass: new Map(),
  // what the camera / room is doing right now (the renderer only changes
  // resolution or frame rate while it is "idle" or "focused")
  phase: "idle",
  // CPU time spent submitting the last frame's draw calls
  cpuMs: 0,
  // set by the room renderer: GPU time per frame (ms, averaged), the frame
  // rate it paces to, and the interval of every frame it actually drew
  // (drained by the perf readout)
  paced: false,
  gpuMs: null,
  capFps: 0,
  rendered: [],
};

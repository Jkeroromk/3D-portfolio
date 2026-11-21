// Shared between the room, the water and the renderer.
export const renderFlags = {
  // true while the depth-only pre-pass is drawing (the water skips its
  // reflection render then)
  prepass: false,
  // true while the scan-line reveal runs (its discard isn't in the depth pass)
  revealing: false,
  // transparent things that must not write depth in the pre-pass:
  // fn(object) -> true when it should be hidden right now
  hideInPrepass: new Map(),
};

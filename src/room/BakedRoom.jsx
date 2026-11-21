import { OrbitControls, useGLTF } from "@react-three/drei";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Box3,
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  ImageBitmapLoader,
  LoadingManager,
  Texture,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Ray,
  ShaderMaterial,
  SRGBColorSpace,
  Spherical,
  TextureLoader,
  Vector3,
  VideoTexture,
} from "three";
import { HOTSPOTS, ROOM_BASE } from "./roomConfig.js";
import { MOBILE } from "./device.js";
import RoomWorld, { REFLECT_LAYER, WATER_Y } from "./RoomWorld.jsx";
import WaterLife from "./WaterLife.jsx";
import RoomRenderer from "./RoomRenderer.jsx";
import { renderFlags } from "./renderFlags.js";
import { getRoomState, setRoomState, useRoomState } from "./roomStore.js";
import { LAYER_NAMES, live, setPresetTarget, stepLighting } from "./lighting.js";

/*
 * Jason's room, modelled and lit in Blender with the lighting baked:
 *  - a day texture per group (display-ready)
 *  - for the night: a base bake, an albedo bake and six white-light layers
 *    (Nanoleaf, desk wall strip, under-desk strip, ceiling spots, lamps,
 *    sofa underglow). The shader tints and adds the layers live, so the
 *    Stream Deck presets can recolour the room without re-baking.
 */

const FLOOR_Y = -1.3;
const TARGET = new Vector3(0, -0.6, 0);
const HOME = { azimuth: -0.62, polar: 0.98, distance: 4.4 };
// Before Enter: the whole room, framed on the right so the landing text has room
const INTRO = { azimuth: -0.5, polar: 1.02, distance: 6.6 };
const INTRO_SHIFT = new Vector3(-1.3, 0.1, 0);
// How bright the room is while it waits behind the landing card
const PRE = { day: 0.55, base: 0.5, layers: 0.18 };
const DESKTOP_ASPECT = 1.6;
const Y_AXIS = new Vector3(0, 1, 0);
const EXPOSURE = Math.pow(2, 0.5); // fitted against the Cycles night bake
const CONTRAST = 0.55;

// Things that load after the room is on screen use their own manager, so the
// landing progress bar (drei useProgress) only counts what the first view needs.
const lateManager = new LoadingManager();

// Phones get half-resolution textures (4K -> 2K); when the visitor focuses on
// something, just that group swaps to full resolution until they leave.
const pick = (full, mobile) => (MOBILE && mobile) || full;

// ImageBitmapLoader decodes JPGs off the main thread (TextureLoader decodes on
// upload, which stalls a frame for every 4K texture)
const bitmapLoader = new ImageBitmapLoader(lateManager);
bitmapLoader.setOptions({ imageOrientation: "none", premultiplyAlpha: "none", colorSpaceConversion: "none" });
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
function loadBitmapTexture(url, anisotropy) {
  return new Promise((res) =>
    bitmapLoader.load(
      ROOM_BASE + url,
      (bmp) => {
        const t = new Texture(bmp);
        t.needsUpdate = true;
        res(prepTexture(t, anisotropy));
      },
      undefined,
      () => res(null)
    )
  );
}
const idle = () =>
  new Promise((r) => (window.requestIdleCallback ? window.requestIdleCallback(() => r(), { timeout: 250 }) : setTimeout(r, 30)));
async function uploadTexture(gl, t) {
  if (!t) return null;
  await idle(); // upload in the browser's quiet moments
  await nextFrame();
  gl.initTexture(t);
  return t;
}
function disposeTexture(t) {
  if (!t) return;
  t.dispose();
  if (t.image && t.image.close) t.image.close();
}

// Point a group's material at its full-res textures (when focused on a phone)
// or at the regular ones.
function applyTextures(g) {
  const u = g.mat.uniforms;
  const hi = g.hi || {};
  u.uDay.value = hi.day || g.lo.day;
  if (g.lo.base) u.uBase.value = hi.base || g.lo.base;
  if (g.lo.albedo) u.uAlbedo.value = hi.albedo || g.lo.albedo;
  if (g.lo.la) u.uLA.value = hi.la || g.lo.la;
  if (g.lo.lb) u.uLB.value = hi.lb || g.lo.lb;
}

function prepTexture(t, anisotropy = 8) {
  t.flipY = false; // glTF UV convention
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

/* ---------- shaders ---------- */

const vertex = /* glsl */ `
  varying vec2 vUv;
  varying float vWorldY;
  void main() {
    vUv = uv;
    vWorldY = (modelMatrix * vec4(position, 1.0)).y;
    // same maths as three's built-in materials, so depth matches the pre-pass exactly
    gl_Position = projectionMatrix * (modelViewMatrix * vec4(position, 1.0));
  }
`;

// First appearance: a scan line sweeps up from the floor and "prints" the
// room. Every room material shares these two uniforms.
const REVEAL = { value: 10 }; // world height below which the room is visible
const REVEAL_EDGE = { value: new Vector3() }; // scan-line colour (preset accent)
const REVEAL_FROM = WATER_Y - 0.05; // start at the waterline so the plinth prints too
const REVEAL_TO = FLOOR_Y + 2.9;
const REVEAL_TIME = 2.6;
const revealChunk = /* glsl */ `
  uniform float uReveal;
  uniform vec3 uRevealEdge;
  varying float vWorldY;
  vec3 revealed(vec3 col) {
    float d = uReveal - vWorldY;
    if (d < 0.0) discard;
    float line = exp(-d * 60.0);
    float glow = exp(-d * 9.0) * 0.35;
    return col + uRevealEdge * (line * 2.2 + glow);
  }
`;

// AgX, as in three.js, plus a gentle contrast lift to match Blender's
// "Medium High Contrast" look used for the renders.
const agx = /* glsl */ `
  vec3 agxContrast(vec3 x) {
    vec3 x2 = x * x;
    vec3 x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  }
  vec3 agx(vec3 color) {
    const mat3 toRec2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
    const mat3 fromRec2020 = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
    const mat3 inset = mat3(
      vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
      vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
      vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
    const mat3 outset = mat3(
      vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
      vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
      vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
    color = inset * (toRec2020 * color);
    color = log2(max(color, 1e-10));
    color = clamp((color + 12.47393) / 16.499999, 0.0, 1.0);
    color = agxContrast(color);
    color = outset * color;
    color = pow(max(vec3(0.0), color), vec3(2.2));
    color = clamp(fromRec2020 * color, 0.0, 1.0);
    // medium-high contrast: S-curve in display space
    vec3 d = pow(color, vec3(1.0 / 2.2));
    d = mix(d, d * d * (3.0 - 2.0 * d), uContrast);
    return pow(d, vec3(2.2));
  }
`;

const bakedFragment = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uBase;
  uniform sampler2D uAlbedo;
  uniform sampler2D uLA; // light layers 0-2 packed in r, g, b
  uniform sampler2D uLB; // light layers 3-5
  uniform float uNight;
  uniform float uOpacity;
  uniform float uDayGain;
  uniform float uBaseK;
  uniform float uExposure;
  uniform float uContrast;
  uniform vec3 uCol[6];
  varying vec2 vUv;
  ${revealChunk}
  ${agx}
  void main() {
    vec3 day = texture2D(uDay, vUv).rgb * uDayGain;
    vec3 col = day;
    if (uNight > 0.001) {
      vec3 albedo = texture2D(uAlbedo, vUv).rgb;
      vec3 la = texture2D(uLA, vUv).rgb;
      vec3 lb = texture2D(uLB, vUv).rgb;
      vec3 light = uCol[0] * la.r + uCol[1] * la.g + uCol[2] * la.b
                 + uCol[3] * lb.r + uCol[4] * lb.g + uCol[5] * lb.b;
      vec3 hdr = texture2D(uBase, vUv).rgb * uBaseK + albedo * light;
      col = mix(day, agx(hdr * uExposure), uNight);
    }
    gl_FragColor = vec4(revealed(col), uOpacity);
    #include <colorspace_fragment>
  }
`;

// Emissive parts (Nanoleaf tiles, lamp shades): baked by day, live colour by night
const glowFragment = /* glsl */ `
  uniform sampler2D uDay;
  uniform float uNight;
  uniform float uDayGain;
  uniform float uContrast;
  uniform vec3 uGlow;
  varying vec2 vUv;
  ${revealChunk}
  ${agx}
  void main() {
    vec3 day = texture2D(uDay, vUv).rgb * uDayGain;
    gl_FragColor = vec4(revealed(mix(day, agx(uGlow), uNight)), 1.0);
    #include <colorspace_fragment>
  }
`;

function bakedMaterial(day, blank) {
  const u = {
    uDay: { value: day },
    uBase: { value: blank },
    uAlbedo: { value: blank },
    uNight: { value: 0 },
    uOpacity: { value: 1 },
    uReveal: REVEAL,
    uRevealEdge: REVEAL_EDGE,
    uDayGain: { value: 0 },
    uBaseK: { value: 0 },
    uExposure: { value: EXPOSURE },
    uContrast: { value: CONTRAST },
    uCol: { value: LAYER_NAMES.map(() => new Vector3()) },
  };
  u.uLA = { value: blank };
  u.uLB = { value: blank };
  return new ShaderMaterial({ uniforms: u, vertexShader: vertex, fragmentShader: bakedFragment, side: DoubleSide });
}

function glowMaterial(day) {
  return new ShaderMaterial({
    uniforms: {
      uDay: { value: day },
      uNight: { value: 0 },
      uDayGain: { value: 0 },
      uContrast: { value: CONTRAST },
      uGlow: { value: new Vector3() },
      uReveal: REVEAL,
      uRevealEdge: REVEAL_EDGE,
    },
    vertexShader: vertex,
    fragmentShader: glowFragment,
    side: DoubleSide,
  });
}

/* ---------- helpers ---------- */

function useManifest() {
  const [manifest, setManifest] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch(`${ROOM_BASE}manifest.json`)
      .then((r) => r.json())
      .then((m) => alive && setManifest(m));
    return () => {
      alive = false;
    };
  }, []);
  return manifest;
}

function setCursor(v) {
  document.body.style.cursor = v;
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function sampleGradient(stops, t) {
  const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  const f = x - i;
  return stops[i].map((v, j) => v + (stops[i + 1][j] - v) * f);
}

/* ---------- the room ---------- */

function Room({ manifest, onHotspot }) {
  const { gl, scene: rootScene, camera } = useThree();
  const { scene } = useGLTF(ROOM_BASE + manifest.glb, true);
  const dayTextures = useLoader(
    TextureLoader,
    manifest.bakes.map((b) => ROOM_BASE + pick(b.day, b.dayM))
  );
  const [nightReady, setNightReady] = useState(false);
  const { preset } = useRoomState();

  const room = useMemo(() => {
    if (scene.userData.room) return scene.userData.room;
    const blank = prepTexture(new TextureLoader(lateManager).load(ROOM_BASE + "black.png"));
    const baked = [];
    const glows = [];
    const lit = [];
    const nightOnly = [];
    const glowInfo = {};
    let chair = null;
    (manifest.glow || []).forEach((g) => (glowInfo[g.mesh] = g));

    manifest.bakes.forEach((b, i) => {
      const day = prepTexture(dayTextures[i]);
      const meshes = (b.meshes || [b.mesh]).map((n) => scene.getObjectByName(n)).filter(Boolean);
      if (!meshes.length) return;
      if (!b.night) {
        // glow group: one material per mesh, so each can get its own colour
        meshes.forEach((m) => {
          m.material = glowMaterial(day);
          glows.push({ mesh: m, info: glowInfo[m.name] || { kind: "lamps" } });
        });
        return;
      }
      const mat = bakedMaterial(day, blank);
      meshes.forEach((m) => (m.material = mat));
      baked.push({ mat, night: b.night, entry: b, lo: { day }, hi: null });
      if (b.mesh === "Bake_Chair") {
        // the chair can fade out when it stands between the camera and a focused object
        mat.transparent = true;
        chair = { mat, mesh: meshes[0], opacity: 1 };
      }
    });

    (manifest.screens || []).forEach((s) => {
      const mesh = scene.getObjectByName(s.mesh);
      if (!mesh) return;
      let map;
      if (s.video) {
        const video = document.createElement("video");
        video.src = ROOM_BASE + s.video;
        video.crossOrigin = "anonymous";
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.play().catch(() => {});
        map = new VideoTexture(video);
        map.flipY = false;
        map.colorSpace = SRGBColorSpace;
      } else {
        // frame photos live in Vercel Blob (full URL), not in the public repo
        const src = /^https?:\/\//.test(s.image) ? s.image : ROOM_BASE + s.image;
        map = prepTexture(new TextureLoader(lateManager).load(src));
      }
      const mat = new MeshBasicMaterial({ map, toneMapped: false });
      mesh.material = mat;
      lit.push({ mat, mesh, day: s.day ?? 1, night: s.night ?? 1, photo: !!s.mesh.startsWith("Photo_") });
    });

    (manifest.nightOnly || []).forEach((n) => {
      const mesh = scene.getObjectByName(n.mesh);
      if (!mesh) return;
      mesh.material = new MeshBasicMaterial({ color: new Color(), transparent: true, opacity: 0, toneMapped: false });
      mesh.visible = false;
      nightOnly.push({ mesh, layer: LAYER_NAMES.indexOf(n.layer) });
    });

    // the old flat click quads are replaced by hotspot boxes
    scene.traverse((o) => {
      if (o.isMesh && o.name.startsWith("Hit_")) o.visible = false;
    });

    // Chair seat on a pivot at the gas-lift axis
    let swivel = null;
    let swivelRest = null;
    const seat = scene.getObjectByName("Bake_Chair");
    if (seat && manifest.chairPivot) {
      swivel = new Group();
      swivel.position.fromArray(manifest.chairPivot);
      scene.add(swivel);
      scene.updateMatrixWorld(true);
      swivel.attach(seat);
      swivelRest = swivel.quaternion.clone();
    }

    // Fan rotors spin about their own hub axis
    const fans = [];
    (manifest.fans || []).forEach((f) => {
      const rotor = scene.getObjectByName(f.mesh);
      if (!rotor) return;
      const pivot = new Group();
      pivot.position.fromArray(f.center);
      scene.add(pivot);
      scene.updateMatrixWorld(true);
      pivot.attach(rotor);
      fans.push({ pivot, axis: new Vector3().fromArray(f.axis).normalize(), speed: 9 + Math.random() * 3 });
    });

    // Hotspot boxes (invisible, raycast only)
    const hitMat = new MeshBasicMaterial({ visible: false });
    const hotspots = (manifest.hotspots || [])
      .filter((h) => HOTSPOTS[h.key])
      .map((h) => {
        const min = new Vector3().fromArray(h.min);
        const max = new Vector3().fromArray(h.max);
        const size = max.clone().sub(min);
        const center = min.clone().add(max).multiplyScalar(0.5);
        const box = new Mesh(new BoxGeometry(size.x + 0.02, size.y + 0.02, size.z + 0.02), hitMat);
        box.position.copy(center);
        box.userData.key = h.key;
        return {
          key: h.key,
          box,
          center,
          radius: size.length() / 2,
          cam: h.cam ? new Vector3().fromArray(h.cam) : null,
          look: h.look ? new Vector3().fromArray(h.look) : null,
        };
      });

    // Only the room shell and the plinth show in the water (the reflection is
    // seen from below the floor, so the furniture never appears in it)
    ["Bake_Room", "Bake_Plinth"].forEach((n) => {
      const o = scene.getObjectByName(n);
      if (o) o.layers.enable(REFLECT_LAYER);
    });

    // Centre the room on the origin with the floor at FLOOR_Y (the plinth
    // under the floor is left out so the framing stays the same)
    const plinth = scene.getObjectByName("Bake_Plinth");
    const plinthParent = plinth && plinth.parent;
    if (plinth) plinthParent.remove(plinth);
    const bb = new Box3().setFromObject(scene);
    if (plinth) plinthParent.add(plinth);
    const c = bb.getCenter(new Vector3());
    const offset = new Vector3(-c.x, FLOOR_Y - bb.min.y, -c.z);

    // transparent bits stay out of the depth pre-pass
    nightOnly.forEach((n) => renderFlags.hideInPrepass.set(n.mesh, () => true));
    if (chair) renderFlags.hideInPrepass.set(chair.mesh, () => chair.opacity < 0.98);

    // lowest world point of the plain (non-shader) meshes, for the reveal sweep
    const lowY = (mesh) => new Box3().setFromObject(mesh).min.y + offset.y;
    lit.forEach((l) => (l.minY = lowY(l.mesh)));
    nightOnly.forEach((n) => (n.minY = lowY(n.mesh)));

    const r = {
      baked,
      glows,
      lit,
      nightOnly,
      swivel,
      swivelRest,
      fans,
      hotspots,
      offset,
      chair,
      nightLoaded: false,
      revealT: getRoomState().introPlayed ? REVEAL_TIME : 0,
      warm: false,
    };
    scene.userData.room = r;
    return r;
  }, [scene, manifest, dayTextures]);

  // share hotspot positions (in world space) with the camera controller
  useEffect(() => {
    setRoomState({
      hotspotWorld: Object.fromEntries(
        room.hotspots.map((h) => [
          h.key,
          {
            center: h.center.clone().add(room.offset),
            radius: h.radius,
            cam: h.cam && h.cam.clone().add(room.offset),
            look: h.look && h.look.clone().add(room.offset),
          },
        ])
      ),
    });
  }, [room]);

  // Night textures: fetched only once a night mood is picked (on desktop also
  // once the intro has finished), then uploaded one per frame so there is never
  // a long freeze.
  const { introPlayed, focus, pending } = useRoomState();
  const detailKey = pending || focus;
  const wantNight = (preset && preset !== "day") || (!MOBILE && introPlayed);
  useEffect(() => {
    if (room.nightLoaded) {
      setNightReady(true);
      return;
    }
    if (!wantNight || room.nightLoading) return;
    room.nightLoading = true;
    const delay = preset && preset !== "day" ? 0 : 1500;
    let fired = false;
    const id = setTimeout(async () => {
      fired = true;
      for (const g of room.baked) {
        const n = g.night;
        const urls = [pick(n.base, n.baseM), pick(n.albedo, n.albedoM), ...(MOBILE && n.layersM ? n.layersM : n.layers)];
        const tex = await Promise.all(urls.map((u) => loadBitmapTexture(u, 4)));
        const up = [];
        for (const t of tex) up.push(await uploadTexture(gl, t));
        Object.assign(g.lo, { base: up[0], albedo: up[1], la: up[2], lb: up[3] });
        applyTextures(g);
        g.mat.userData.kBase = n.kBase;
        g.mat.userData.k = n.k;
      }
      room.nightLoaded = true;
      setNightReady(true);
    }, delay);
    return () => {
      clearTimeout(id);
      if (!fired) room.nightLoading = false;
    };
  }, [room, wantNight]);

  // Phones: full-resolution textures only for the groups around the focused object
  useEffect(() => {
    if (!MOBILE) return;
    const wanted = new Set(((detailKey && HOTSPOTS[detailKey]?.groups) || []).map((g) => "Bake_" + g));
    // release groups we no longer look at
    for (const g of room.baked) {
      if (g.hi && !wanted.has(g.entry.mesh)) {
        const old = g.hi;
        g.hi = null;
        applyTextures(g);
        Object.values(old).forEach(disposeTexture);
      }
    }
    let cancelled = false;
    (async () => {
      for (const g of room.baked) {
        if (!wanted.has(g.entry.mesh) || g.hi || !g.entry.dayM) continue;
        const n = g.night;
        const jobs = { day: g.entry.day };
        if (room.nightLoaded && n) {
          if (n.baseM) jobs.base = n.base;
          if (n.albedoM) jobs.albedo = n.albedo;
          if (n.layersM && n.layersM[0] !== n.layers[0]) {
            jobs.la = n.layers[0];
            jobs.lb = n.layers[1];
          }
        }
        const hi = {};
        for (const [k, url] of Object.entries(jobs)) {
          hi[k] = await uploadTexture(gl, await loadBitmapTexture(url, k === "day" ? 8 : 4));
          if (cancelled) {
            Object.values(hi).forEach(disposeTexture);
            return;
          }
        }
        g.hi = hi;
        applyTextures(g);
      }
      // everything is on the GPU: now the camera can fly without hitches
      if (!cancelled && pending && getRoomState().pending === pending) {
        await nextFrame();
        setRoomState({ focus: pending, pending: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailKey, room]);

  useEffect(() => {
    setPresetTarget(preset);
  }, [preset]);

  // Warm-up before the room is shown: upload every texture (one per frame),
  // compile the shaders, then wait for a few steady frames. Only then is the
  // room "ready" and the reveal starts, so the print-out never stutters.
  useEffect(() => {
    if (room.warm) {
      setRoomState({ ready: true, warming: false });
      return;
    }
    let alive = true;
    (async () => {
      setRoomState({ warming: true });
      const textures = new Set();
      room.baked.forEach((g) => textures.add(g.mat.uniforms.uDay.value));
      room.glows.forEach((g) => textures.add(g.mesh.material.uniforms.uDay.value));
      room.lit.forEach((l) => l.mat.map && textures.add(l.mat.map));
      for (const t of textures) {
        if (!alive) return;
        await nextFrame();
        if (t && t.image && !t.isVideoTexture) gl.initTexture(t);
      }
      // opening in a night mood: have the night textures on the GPU before the
      // print-out, so nothing uploads while it runs
      while (alive && getRoomState().preset !== "day" && !room.nightLoaded) await nextFrame();
      await nextFrame();
      gl.compile(rootScene, camera);
      let steady = 0;
      let last = performance.now();
      const t0 = last;
      while (steady < 8 && performance.now() - t0 < 2500) {
        await nextFrame();
        const now = performance.now();
        steady = now - last < 24 ? steady + 1 : 0;
        last = now;
      }
      await new Promise((r) => setTimeout(r, 300)); // a short beat before the print-out
      if (!alive) return;
      room.warm = true;
      setRoomState({ ready: true, warming: false });
    })();
    return () => {
      alive = false;
    };
  }, [room]);

  useEffect(() => {
    const wantsNight = preset && preset !== "day";
    setRoomState({ loadingNight: wantsNight && !nightReady });
  }, [preset, nightReady]);

  const tmpQ = useMemo(() => new Quaternion(), []);
  const tmpC = useMemo(() => new Vector3(), []);
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    stepLighting(dt);
    const night = nightReady ? live.night : 0;
    const I = live.intro;

    if (room.warm && room.revealT < REVEAL_TIME) room.revealT = Math.min(REVEAL_TIME, room.revealT + dt);
    renderFlags.revealing = room.revealT < REVEAL_TIME;
    const rk = room.revealT / REVEAL_TIME;
    const re = rk < 0.5 ? 4 * rk * rk * rk : 1 - Math.pow(-2 * rk + 2, 3) / 2;
    REVEAL.value = rk >= 1 ? 10 : REVEAL_FROM + (REVEAL_TO - REVEAL_FROM) * re;
    REVEAL_EDGE.value.set(live.accent.r, live.accent.g, live.accent.b).multiplyScalar(1 - Math.max(0, rk - 0.85) / 0.15);

    room.baked.forEach(({ mat }) => {
      const u = mat.uniforms;
      u.uNight.value = night;
      u.uDayGain.value = I.day;
      const k = mat.userData.k;
      if (k) {
        u.uBaseK.value = mat.userData.kBase * I.base;
        live.layers.forEach((col, i) => u.uCol.value[i].set(col[0], col[1], col[2]).multiplyScalar(k[i] * I.layers[i]));
      }
    });

    room.glows.forEach(({ mesh, info }) => {
      const u = mesh.material.uniforms;
      u.uNight.value = night;
      u.uDayGain.value = I.day;
      if (info.kind === "nano") {
        const g = sampleGradient(live.nano, info.t ?? 0.5);
        tmpC.set(g[0], g[1], g[2]).multiplyScalar(2.2 * live.nanoGain * I.layers[0]);
      } else {
        const l = live.layers[4];
        tmpC.set(l[0], l[1], l[2]).multiplyScalar(3.0 * I.layers[4]);
      }
      u.uGlow.value.copy(tmpC);
    });

    // how much light falls on the walls at night (ceiling spots + lamps)
    const luma = (c) => 0.3 * c[0] + 0.55 * c[1] + 0.15 * c[2];
    const wallLight = Math.min(1, 0.18 + 0.7 * (luma(live.layers[3]) + luma(live.layers[4])));
    room.lit.forEach(({ mat, mesh, minY, day, night: n, photo }) => {
      const nightV = photo ? n * wallLight : n; // photos aren't screens: they dim with the room
      const v = (day + (nightV - day) * night) * Math.max(I.day, I.base);
      mat.color.setRGB(v, v, v);
      mesh.visible = REVEAL.value > minY;
    });

    room.nightOnly.forEach(({ mesh, layer, minY }) => {
      const l = live.layers[layer] || [0, 0, 0];
      const m = Math.max(l[0], l[1], l[2], 1e-4);
      mesh.material.color.setRGB(l[0] / m, l[1] / m, l[2] / m);
      const a = night * Math.min(1, m) * (I.layers[layer] ?? 0);
      mesh.material.opacity = a;
      mesh.visible = a > 0.01 && REVEAL.value > minY;
    });

    room.fans.forEach((f) => f.pivot.rotateOnAxis(f.axis, f.speed * dt));

    if (room.chair) {
      const c = room.chair;
      const want = getRoomState().chairHidden ? 0 : 1;
      c.opacity += (want - c.opacity) * (1 - Math.exp(-dt * 8));
      c.mat.uniforms.uOpacity.value = c.opacity;
      c.mat.depthWrite = c.opacity > 0.98;
      c.mesh.visible = c.opacity > 0.02;
    }

    // Lazy back-and-forth swivel, like someone fidgeting in the chair
    if (room.swivel) {
      const t = state.clock.elapsedTime;
      const angle = Math.sin(t * 0.4) * 0.35 + Math.sin(t * 0.13) * 0.1;
      tmpQ.setFromAxisAngle(Y_AXIS, angle);
      room.swivel.quaternion.copy(room.swivelRest).multiply(tmpQ);
    }
  });

  return (
    <group position={room.offset}>
      <primitive object={scene} />
      {room.hotspots.map((h) => (
        <primitive
          key={h.key}
          object={h.box}
          onPointerOver={(e) => {
            e.stopPropagation();
            if (getRoomState().focus || !getRoomState().started) return;
            setRoomState({ hover: h.key });
            setCursor("pointer");
          }}
          onPointerOut={() => {
            if (getRoomState().hover === h.key) setRoomState({ hover: null });
            setCursor("auto");
          }}
          onClick={(e) => {
            e.stopPropagation();
            onHotspot(h.key);
          }}
        />
      ))}
    </group>
  );
}

/* ---------- camera: intro, orbit, focus ---------- */

function poseFromSpherical(s, pullBack) {
  const sph = new Spherical(s.distance * pullBack, s.polar, s.azimuth);
  return new Vector3().setFromSpherical(sph).add(TARGET);
}

const UP = new Vector3(0, 1, 0);
const HALF_FOV = Math.tan((45 / 2) * (Math.PI / 180));

// Focus shots were designed in Blender (clear line of sight, object framed).
// On wide screens the object is pushed right of centre so the info card on the
// left doesn't cover it.
function focusPose(key, spot, aspect, pullBack) {
  const cfg = HOTSPOTS[key];
  let pos;
  let look;
  if (spot.cam && spot.look) {
    look = spot.look.clone();
    pos = look.clone().add(spot.cam.clone().sub(look).multiplyScalar(pullBack));
  } else {
    const dir = new Vector3().fromArray(cfg.view || [-1, 0.4, 0.3]).normalize();
    look = spot.center.clone();
    pos = look.clone().addScaledVector(dir, (cfg.distance ?? spot.radius * 2.4 + 0.45) * pullBack);
  }
  const shift = cfg.title && aspect > 1.2 ? cfg.shift ?? 0.28 : 0;
  if (shift) {
    const fwd = look.clone().sub(pos);
    const d = fwd.length();
    const right = fwd.normalize().cross(UP).normalize();
    look.addScaledVector(right, -shift * d * HALF_FOV * aspect);
  }
  return { pos, target: look };
}

// Is the (swivelling) chair between the camera and what it looks at? The chair
// swings about ±25°, so its box is padded a little.
const _box = new Box3();
const _ray = new Ray();
const _hit = new Vector3();
function chairInTheWay(scene, pose) {
  const chair = scene.getObjectByName("Bake_Chair");
  if (!chair) return false;
  _box.setFromObject(chair).expandByScalar(0.08);
  const dir = pose.target.clone().sub(pose.pos);
  const len = dir.length();
  _ray.set(pose.pos, dir.normalize());
  const hit = _ray.intersectBox(_box, _hit);
  return !!hit && hit.distanceTo(pose.pos) < len;
}

// Pre-Enter framing: whole room on the right, landing text on the left.
// `swing` (0..1) moves the camera round and back for the arrival swing.
function introPose(aspect, pullBack, swing = 0) {
  const target = TARGET.clone();
  if (aspect > 1.2) target.add(INTRO_SHIFT);
  const sph = new Spherical(
    INTRO.distance * pullBack * (1 + 0.55 * swing),
    INTRO.polar - 0.22 * swing,
    INTRO.azimuth - 1.1 * swing
  );
  return { pos: new Vector3().setFromSpherical(sph).add(target), target };
}

export default function BakedRoomScene({ onEnterMacbook }) {
  const manifest = useManifest();
  const { camera, size, scene } = useThree();
  // the MacBook scene paints a grey background; the room shows the page behind it
  useEffect(() => {
    scene.background = null;
  }, [scene]);

  // previews only: expose the scene so it can be inspected from the console
  useEffect(() => {
    if (/-projects\.vercel\.app$/.test(window.location.hostname) || window.location.hostname === "localhost") {
      window.__room = { scene, camera };
    }
  }, [scene, camera]);
  const controls = useRef();
  const { started, focus } = useRoomState();
  const tween = useRef(null);
  const introDone = useRef(false);
  const lightIntro = useRef(null);
  const saved = useRef(null);
  const hold = useRef(null); // focus pose kept while a card is open
  const tmpTarget = useMemo(() => new Vector3(), []);

  const pullBack = Math.min(Math.max(1, DESKTOP_ASPECT / (size.width / size.height)), 2.2);
  const home = useMemo(() => ({ pos: poseFromSpherical(HOME, pullBack), target: TARGET.clone() }), [pullBack]);

  function startTween(to, duration, onDone, label = "tween") {
    const ctl = controls.current;
    tween.current = {
      label,
      fromPos: camera.position.clone(),
      fromTarget: ctl ? ctl.target.clone() : TARGET.clone(),
      to,
      t: 0,
      duration,
      onDone,
    };
  }

  // Before the visitor presses Enter the whole room waits, dimmed, behind the landing card.
  // Coming back from the MacBook the intro is skipped.
  useEffect(() => {
    if (getRoomState().introPlayed) {
      introDone.current = true;
      const I = live.intro;
      I.day = 1;
      I.base = 1;
      I.layers.fill(1);
      camera.position.copy(home.pos);
      if (controls.current) controls.current.target.copy(TARGET);
      return;
    }
    const I = live.intro;
    I.day = PRE.day;
    I.base = PRE.base;
    I.layers.fill(PRE.layers);
    // wait round the side until the room has loaded, then swing in with the reveal
    const pose = introPose(size.width / size.height, pullBack, 1);
    camera.position.copy(pose.pos);
    camera.lookAt(pose.target);
    if (controls.current) controls.current.target.copy(pose.target);
  }, []);

  const { ready } = useRoomState();
  const swung = useRef(false);
  useEffect(() => {
    if (!ready || swung.current || getRoomState().introPlayed || getRoomState().started) return;
    swung.current = true;
    startTween(introPose(size.width / size.height, pullBack), REVEAL_TIME + 0.2, () => {}, "swing");
  }, [ready]);

  // Enter: fly in, then switch the lights on one by one
  useEffect(() => {
    if (!started || introDone.current) return;
    introDone.current = true;
    startTween(home, 3.4, () => setRoomState({ introPlayed: true }), "enter");
    lightIntro.current = 0;
  }, [started]);

  // Focus on a hotspot / return home
  useEffect(() => {
    const spots = getRoomState().hotspotWorld || {};
    if (focus && spots[focus]) {
      if (!saved.current && controls.current) {
        saved.current = { pos: camera.position.clone(), target: controls.current.target.clone() };
      }
      const pose = focusPose(focus, spots[focus], size.width / size.height, pullBack);
      setRoomState({ chairHidden: chairInTheWay(scene, pose) });
      if (HOTSPOTS[focus].action === "macbook") {
        // frame the MacBook, then push in close before the scene change
        const close = {
          pos: pose.target.clone().lerp(pose.pos, 0.35),
          target: pose.target.clone(),
        };
        startTween(pose, 1.4, () => {
          startTween(close, 0.9, () => {
            saved.current = null;
            onEnterMacbook && onEnterMacbook();
          });
        });
      } else {
        startTween(pose, 1.3, () => {}, "zoom-in");
      }
    } else if (!focus && saved.current) {
      hold.current = null;
      setRoomState({ chairHidden: false });
      startTween(saved.current, 1.2, () => {}, "zoom-out");
      saved.current = null;
    }
  }, [focus]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setRoomState({ focus: null, pending: null });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      setCursor("auto");
      setRoomState({ ready: false, focus: null, pending: null, hover: null, chairHidden: false });
    };
  }, []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const ctl = controls.current;
    const tw = tween.current;
    if (tw) {
      tw.t = Math.min(1, tw.t + dt / tw.duration);
      const k = ease(tw.t);
      camera.position.lerpVectors(tw.fromPos, tw.to.pos, k);
      // drive the camera directly: OrbitControls would clamp focus poses
      tmpTarget.lerpVectors(tw.fromTarget, tw.to.target, k);
      camera.lookAt(tmpTarget);
      if (ctl) ctl.target.copy(tmpTarget);
      if (tw.t >= 1) {
        tween.current = null;
        if (getRoomState().focus) hold.current = tw.to;
        tw.onDone();
      }
    }
    const st = getRoomState();
    // OrbitControls clamps distance/angles even when disabled, so a focus pose
    // closer than minDistance is re-applied here every frame.
    if (!tween.current && hold.current && st.focus) {
      camera.position.copy(hold.current.pos);
      camera.lookAt(hold.current.target);
      if (ctl) ctl.target.copy(hold.current.target);
    }
    if (ctl) ctl.enabled = !tween.current && !st.focus && st.started;
    renderFlags.phase = renderFlags.revealing ? "print" : tween.current ? tween.current.label : st.focus ? "focused" : "idle";

    // intro lights: day fades in; at night each layer switches on in turn
    const I = live.intro;
    if (lightIntro.current !== null) {
      lightIntro.current += dt;
      const t = lightIntro.current - 1.4; // start while the camera is still flying in
      const ramp = (from, x) => from + (1 - from) * Math.min(1, Math.max(0, x));
      I.day = ramp(PRE.day, t / 1.6);
      I.base = ramp(PRE.base, t / 1.2);
      const order = [5, 2, 1, 0, 4, 3]; // sofa, under desk, desk wall, nanoleaf, lamps, ceiling
      order.forEach((li, n) => {
        I.layers[li] = ramp(PRE.layers, (t - 0.5 - n * 0.35) / 0.45);
      });
      if (t > 4) lightIntro.current = null;
    }
  });

  const onHotspot = (key) => {
    const cfg = HOTSPOTS[key];
    const st = getRoomState();
    if (!cfg || !st.started || st.focus || st.pending) return;
    if (cfg.action === "lights") {
      setRoomState({ deckPulse: Date.now() });
      return;
    }
    if (cfg.action === "cycle") {
      setRoomState({ cyclePreset: Date.now() });
      return;
    }
    setCursor("auto");
    // Phones: fetch the full-res textures first (a spinner shows), fly once they're in
    if (MOBILE && cfg.title && cfg.groups) {
      setRoomState({ pending: key, hover: null });
      return;
    }
    setRoomState({ focus: key, hover: null });
  };

  return (
    <>
      <OrbitControls
        ref={controls}
        makeDefault
        target={TARGET}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={2}
        maxDistance={started ? 10 * pullBack : 40}
        minPolarAngle={0.45}
        maxPolarAngle={1.35}
        minAzimuthAngle={-1.45}
        maxAzimuthAngle={0.05}
        rotateSpeed={0.5}
      />
      <RoomRenderer />
      <RoomWorld />
      <WaterLife />
      <Suspense fallback={null}>{manifest && <Room manifest={manifest} onHotspot={onHotspot} />}</Suspense>
    </>
  );
}

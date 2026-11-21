import { OrbitControls, useGLTF } from "@react-three/drei";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Box3,
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  ShaderMaterial,
  SRGBColorSpace,
  Spherical,
  TextureLoader,
  Vector3,
  VideoTexture,
} from "three";
import { HOTSPOTS, ROOM_BASE } from "./roomConfig.js";
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
const INTRO = { azimuth: -1.15, polar: 1.25, distance: 13 };
const DESKTOP_ASPECT = 1.6;
const Y_AXIS = new Vector3(0, 1, 0);
const EXPOSURE = Math.pow(2, 0.5); // fitted against the Cycles night bake
const CONTRAST = 0.55;

function prepTexture(t) {
  t.flipY = false; // glTF UV convention
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ---------- shaders ---------- */

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
  uniform sampler2D uL0;
  uniform sampler2D uL1;
  uniform sampler2D uL2;
  uniform sampler2D uL3;
  uniform sampler2D uL4;
  uniform sampler2D uL5;
  uniform float uNight;
  uniform float uDayGain;
  uniform float uBaseK;
  uniform float uExposure;
  uniform float uContrast;
  uniform vec3 uCol[6];
  varying vec2 vUv;
  ${agx}
  void main() {
    vec3 day = texture2D(uDay, vUv).rgb * uDayGain;
    vec3 col = day;
    if (uNight > 0.001) {
      vec3 albedo = texture2D(uAlbedo, vUv).rgb;
      vec3 light = uCol[0] * texture2D(uL0, vUv).r
                 + uCol[1] * texture2D(uL1, vUv).r
                 + uCol[2] * texture2D(uL2, vUv).r
                 + uCol[3] * texture2D(uL3, vUv).r
                 + uCol[4] * texture2D(uL4, vUv).r
                 + uCol[5] * texture2D(uL5, vUv).r;
      vec3 hdr = texture2D(uBase, vUv).rgb * uBaseK + albedo * light;
      col = mix(day, agx(hdr * uExposure), uNight);
    }
    gl_FragColor = vec4(col, 1.0);
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
  ${agx}
  void main() {
    vec3 day = texture2D(uDay, vUv).rgb * uDayGain;
    gl_FragColor = vec4(mix(day, agx(uGlow), uNight), 1.0);
    #include <colorspace_fragment>
  }
`;

function bakedMaterial(day, blank) {
  const u = {
    uDay: { value: day },
    uBase: { value: blank },
    uAlbedo: { value: blank },
    uNight: { value: 0 },
    uDayGain: { value: 0 },
    uBaseK: { value: 0 },
    uExposure: { value: EXPOSURE },
    uContrast: { value: CONTRAST },
    uCol: { value: LAYER_NAMES.map(() => new Vector3()) },
  };
  LAYER_NAMES.forEach((_, i) => (u["uL" + i] = { value: blank }));
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
  const { scene } = useGLTF(ROOM_BASE + manifest.glb, true);
  const dayTextures = useLoader(
    TextureLoader,
    manifest.bakes.map((b) => ROOM_BASE + b.day)
  );
  const [nightReady, setNightReady] = useState(false);
  const { preset } = useRoomState();

  const room = useMemo(() => {
    if (scene.userData.room) return scene.userData.room;
    const blank = prepTexture(new TextureLoader().load(ROOM_BASE + "black.png"));
    const baked = [];
    const glows = [];
    const lit = [];
    const nightOnly = [];
    const glowInfo = {};
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
      baked.push({ mat, night: b.night });
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
        map = prepTexture(new TextureLoader().load(ROOM_BASE + s.image));
      }
      const mat = new MeshBasicMaterial({ map, toneMapped: false });
      mesh.material = mat;
      lit.push({ mat, day: s.day ?? 1, night: s.night ?? 1 });
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
        return { key: h.key, box, center, radius: size.length() / 2 };
      });

    // Centre the room on the origin with the floor at FLOOR_Y
    const bb = new Box3().setFromObject(scene);
    const c = bb.getCenter(new Vector3());
    const offset = new Vector3(-c.x, FLOOR_Y - bb.min.y, -c.z);

    const r = { baked, glows, lit, nightOnly, swivel, swivelRest, fans, hotspots, offset, nightLoaded: false };
    scene.userData.room = r;
    return r;
  }, [scene, manifest, dayTextures]);

  // share hotspot positions (in world space) with the camera controller
  useEffect(() => {
    setRoomState({
      hotspotWorld: Object.fromEntries(
        room.hotspots.map((h) => [h.key, { center: h.center.clone().add(room.offset), radius: h.radius }])
      ),
    });
  }, [room]);

  // Night textures stream in after the room is visible
  useEffect(() => {
    if (room.nightLoaded) {
      setNightReady(true);
      return;
    }
    let cancelled = false;
    const loader = new TextureLoader();
    const load = (url) =>
      new Promise((res) => loader.load(ROOM_BASE + url, (t) => res(prepTexture(t)), undefined, () => res(null)));
    const id = setTimeout(async () => {
      for (const { mat, night } of room.baked) {
        const [base, albedo, ...layers] = await Promise.all([night.base, night.albedo, ...night.layers].map(load));
        if (base) mat.uniforms.uBase.value = base;
        if (albedo) mat.uniforms.uAlbedo.value = albedo;
        layers.forEach((t, i) => t && (mat.uniforms["uL" + i].value = t));
        mat.userData.kBase = night.kBase;
        mat.userData.k = night.k;
      }
      room.nightLoaded = true;
      if (!cancelled) setNightReady(true);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [room]);

  useEffect(() => {
    setPresetTarget(preset);
  }, [preset]);

  useEffect(() => {
    setRoomState({ ready: true });
  }, []);

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

    room.lit.forEach(({ mat, day, night: n }) => {
      const v = (day + (n - day) * night) * Math.max(I.day, I.base);
      mat.color.setRGB(v, v, v);
    });

    room.nightOnly.forEach(({ mesh, layer }) => {
      const l = live.layers[layer] || [0, 0, 0];
      const m = Math.max(l[0], l[1], l[2], 1e-4);
      mesh.material.color.setRGB(l[0] / m, l[1] / m, l[2] / m);
      const a = night * Math.min(1, m) * (I.layers[layer] ?? 0);
      mesh.material.opacity = a;
      mesh.visible = a > 0.01;
    });

    room.fans.forEach((f) => f.pivot.rotateOnAxis(f.axis, f.speed * dt));

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

function focusPose(key, spot) {
  const cfg = HOTSPOTS[key];
  const dir = new Vector3().fromArray(cfg.view || [-1, 0.4, 0.3]).normalize();
  const dist = cfg.distance ?? spot.radius * 2.4 + 0.45;
  return { pos: spot.center.clone().addScaledVector(dir, dist), target: spot.center.clone() };
}

export default function BakedRoomScene({ onEnterMacbook }) {
  const manifest = useManifest();
  const { camera, size } = useThree();
  const controls = useRef();
  const { started, focus } = useRoomState();
  const tween = useRef(null);
  const introDone = useRef(false);
  const lightIntro = useRef(null);
  const saved = useRef(null);
  const tmpTarget = useMemo(() => new Vector3(), []);

  const pullBack = Math.min(Math.max(1, DESKTOP_ASPECT / (size.width / size.height)), 2.2);
  const home = useMemo(() => ({ pos: poseFromSpherical(HOME, pullBack), target: TARGET.clone() }), [pullBack]);

  function startTween(to, duration, onDone) {
    const ctl = controls.current;
    tween.current = {
      fromPos: camera.position.clone(),
      fromTarget: ctl ? ctl.target.clone() : TARGET.clone(),
      to,
      t: 0,
      duration,
      onDone,
    };
  }

  // Before the visitor presses Enter the camera waits far outside, room dark.
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
    camera.position.copy(poseFromSpherical(INTRO, pullBack));
    camera.lookAt(TARGET);
    if (controls.current) controls.current.target.copy(TARGET);
  }, []);

  // Enter: fly in, then switch the lights on one by one
  useEffect(() => {
    if (!started || introDone.current) return;
    introDone.current = true;
    startTween(home, 3.4, () => setRoomState({ introPlayed: true }));
    lightIntro.current = 0;
  }, [started]);

  // Focus on a hotspot / return home
  useEffect(() => {
    const spots = getRoomState().hotspotWorld || {};
    if (focus && spots[focus]) {
      if (!saved.current && controls.current) {
        saved.current = { pos: camera.position.clone(), target: controls.current.target.clone() };
      }
      const pose = focusPose(focus, spots[focus]);
      if (HOTSPOTS[focus].action === "macbook") {
        startTween(pose, 1.6, () => {
          saved.current = null;
          onEnterMacbook && onEnterMacbook();
        });
      } else {
        startTween(pose, 1.3, () => {});
      }
    } else if (!focus && saved.current) {
      startTween(saved.current, 1.2, () => {});
      saved.current = null;
    }
  }, [focus]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setRoomState({ focus: null });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      setCursor("auto");
      setRoomState({ ready: false, focus: null, hover: null });
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
        tw.onDone();
      }
    }
    const st = getRoomState();
    if (ctl) ctl.enabled = !tween.current && !st.focus && st.started;

    // intro lights: day fades in; at night each layer switches on in turn
    const I = live.intro;
    if (lightIntro.current !== null) {
      lightIntro.current += dt;
      const t = lightIntro.current - 1.4; // start while the camera is still flying in
      I.day = Math.min(1, Math.max(0, t / 1.6));
      I.base = Math.min(1, Math.max(0, t / 1.2));
      const order = [5, 2, 1, 0, 4, 3]; // sofa, under desk, desk wall, nanoleaf, lamps, ceiling
      order.forEach((li, n) => {
        I.layers[li] = Math.min(1, Math.max(0, (t - 0.5 - n * 0.35) / 0.45));
      });
      if (t > 4) lightIntro.current = null;
    }
  });

  const onHotspot = (key) => {
    const cfg = HOTSPOTS[key];
    const st = getRoomState();
    if (!cfg || !st.started || st.focus) return;
    if (cfg.action === "lights") {
      setRoomState({ deckPulse: Date.now() });
      return;
    }
    if (cfg.action === "cycle") {
      setRoomState({ cyclePreset: Date.now() });
      return;
    }
    setRoomState({ focus: key, hover: null });
    setCursor("auto");
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
        maxDistance={7 * pullBack}
        minPolarAngle={0.45}
        maxPolarAngle={1.35}
        minAzimuthAngle={-1.45}
        maxAzimuthAngle={0.05}
        rotateSpeed={0.5}
      />
      <Suspense fallback={null}>{manifest && <Room manifest={manifest} onHotspot={onHotspot} />}</Suspense>
    </>
  );
}

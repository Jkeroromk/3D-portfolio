import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  AnimationMixer,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LoopRepeat,
  ShaderMaterial,
  Vector3,
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { live } from "./lighting.js";
import { useRoomState } from "./roomStore.js";
import { addRipple, lanternGlow, PLINTH_HALF, REFLECT_LAYER, WATER_Y } from "./RoomWorld.jsx";
import { ROOM_BASE } from "./roomConfig.js";

/*
 * Life on the water:
 *  - rubber ducks drifting round the plinth; now and then one dives and pops
 *    up somewhere else. Click one: squeak, spin, heart. Find all 5 for a parade.
 *  - at night: floating lotus lanterns, fireflies and the odd koi jump.
 * Models: "Yellow rubber duck" by sanch_aozz, "Koi Fish" by 7plus,
 * "Lowpoly textured Floating lotus lantern" by Khyoocumber (Sketchfab, CC BY 4.0).
 */

const PROPS = ROOM_BASE + "props/";
const DUCKS = 5;
const DUCK_HEIGHT = 0.36; // toy-sized next to the room, big enough to spot
// the duck model faces +z; tweak here if it swims sideways
const DUCK_YAW = 0;
const rand = (a, b) => a + Math.random() * (b - a);

// A point on the water at angle a, r metres out from the plinth's edge. The
// path is a squarish superellipse hugging the rectangular plinth, so nothing
// cuts through its corners.
function ringPoint(a, r, out = new Vector3()) {
  const A = PLINTH_HALF.x + r;
  const B = PLINTH_HALF.y + r;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const n = 6;
  const k = 1 / Math.pow(Math.pow(Math.abs(c) / A, n) + Math.pow(Math.abs(s) / B, n), 1 / n);
  return out.set(c * k, WATER_Y, s * k);
}
const _a = new Vector3();
const _b = new Vector3();
// direction of travel along that path (x, z), for facing
function ringTangent(a, r, dir) {
  ringPoint(a - 0.01, r, _a);
  ringPoint(a + 0.01, r, _b);
  return [(_b.x - _a.x) * dir, (_b.z - _a.z) * dir];
}

let audio = null;
function squeak() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(1150, t);
    o.frequency.exponentialRampToValueAtTime(1750, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(950, t + 0.2);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + 0.26);
  } catch {
    /* no audio, no squeak */
  }
}

function floatText(text, x, y, cls) {
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = text;
  el.style.left = x + "px";
  el.style.top = y + "px";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

function toast(text) {
  const el = document.createElement("div");
  el.className = "room-toast";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("room-toast--out"), 4200);
  setTimeout(() => el.remove(), 5000);
}

/* ---------------- ducks ---------------- */

function Ducks() {
  const { scene } = useGLTF(PROPS + "rubber_duck.glb");
  const found = useRef(new Set());
  const parade = useRef({ until: 0, start: false });

  // sitting a little into the water
  const clones = useMemo(() => {
    const s = DUCK_HEIGHT / 3.66;
    return Array.from({ length: DUCKS }, () => {
      const holder = new Group();
      const g = scene.clone(true);
      g.scale.setScalar(s);
      g.position.y = 1.541 * s - DUCK_HEIGHT * 0.22;
      g.traverse((o) => o.isMesh && o.layers.enable(REFLECT_LAYER));
      holder.add(g);
      holder.visible = false;
      return holder;
    });
  }, [scene]);

  const ducks = useMemo(
    () =>
      clones.map((obj, i) => ({
        i,
        obj,
        angle: (i / DUCKS) * Math.PI * 2 + rand(-0.3, 0.3),
        radius: rand(0.45, 2.2),
        speed: rand(0.025, 0.05) * (Math.random() < 0.5 ? -1 : 1),
        phase: rand(0, 6.28),
        depth: 1, // 1 = under water, 0 = floating
        state: "hidden", // hidden -> rising -> float -> diving -> hidden
        timer: 1.2 + i * rand(0.8, 1.6),
        spin: 0,
        hop: 0,
      })),
    [clones]
  );

  const p = useMemo(() => new Vector3(), []);
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;
    const pr = parade.current;
    if (pr.start) {
      pr.start = false;
      pr.until = t + 14;
      ducks.forEach((d) => d.state !== "float" && (d.state = "rising"));
      toast("You found all 5 ducks 🦆  Parade time!");
    }
    const inParade = pr.until > t;
    ducks.forEach((d, n) => {
      d.timer -= dt;
      // life cycle: surface, float a while, sometimes dive and come up elsewhere
      if (d.state === "hidden" && d.timer <= 0) {
        d.state = "rising";
        ringPoint(d.angle, d.radius, p);
        addRipple(p.x, p.z, 0.9);
      } else if (d.state === "rising") {
        d.depth = Math.max(0, d.depth - dt * 2.2);
        if (d.depth === 0) {
          d.state = "float";
          d.timer = rand(18, 40);
        }
      } else if (d.state === "float" && d.timer <= 0 && !inParade) {
        d.state = "diving";
      } else if (d.state === "diving") {
        d.depth = Math.min(1, d.depth + dt * 1.6);
        if (d.depth === 1) {
          d.state = "hidden";
          d.timer = rand(2, 5);
          d.angle = rand(0, Math.PI * 2);
          d.radius = rand(0.45, 2.2);
        }
      }

      let dir = Math.sign(d.speed) || 1;
      if (inParade) {
        // all five in a row, swimming round the room
        const target = t * 0.22 - n * 0.32;
        d.angle += (target - d.angle) * Math.min(1, dt * 1.5);
        d.radius += (0.7 - d.radius) * Math.min(1, dt);
        dir = 1;
      } else {
        d.angle += d.speed * dt;
      }
      ringPoint(d.angle, d.radius, p);
      // direction of travel along the ring
      const [dx, dz] = ringTangent(d.angle, d.radius, dir);
      d.spin = Math.max(0, d.spin - dt * 9);
      d.hop = Math.max(0, d.hop - dt * 2.4);
      const hopY = d.hop > 0 ? Math.sin((1 - d.hop) * Math.PI) * 0.12 : 0;
      const o = d.obj;
      o.position.set(p.x, WATER_Y + Math.sin(t * 1.4 + d.phase) * 0.015 - d.depth * 0.45 + hopY * 1.6, p.z);
      o.rotation.set(Math.sin(t * 1.1 + d.phase) * 0.06, Math.atan2(dx, dz) + DUCK_YAW + d.spin, Math.sin(t * 1.3 + d.phase) * 0.07);
      o.visible = d.depth < 0.98;
    });
  });

  const onDuck = (d) => (e) => {
    e.stopPropagation();
    if (d.state !== "float" && d.state !== "rising") return;
    squeak();
    d.spin = Math.PI * 2;
    d.hop = 1;
    addRipple(d.obj.position.x, d.obj.position.z, 0.7);
    floatText("♥", e.nativeEvent.clientX, e.nativeEvent.clientY - 10, "room-heart");
    found.current.add(d.i);
    if (found.current.size === DUCKS && parade.current.until === 0) parade.current.start = true;
  };

  return (
    <group>
      {ducks.map((d) => (
        <primitive
          key={d.i}
          object={d.obj}
          onClick={onDuck(d)}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => (document.body.style.cursor = "auto")}
        />
      ))}
    </group>
  );
}

/* ---------------- night: lanterns ---------------- */

function Lanterns() {
  const { scene, animations } = useGLTF(PROPS + "lotus_lantern.glb");
  const items = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const obj = cloneSkinned(scene);
        obj.scale.setScalar(3.2); // ~60 cm across
        obj.traverse((o) => {
          if (o.isMesh) {
            o.layers.enable(REFLECT_LAYER);
            o.frustumCulled = false;
          }
        });
        const mixer = new AnimationMixer(obj);
        animations.forEach((clip) => {
          const a = mixer.clipAction(clip);
          a.setLoop(LoopRepeat, Infinity);
          a.time = Math.random() * clip.duration;
          a.play();
        });
        return { obj, mixer, angle: (i / 6) * Math.PI * 2 + rand(-0.25, 0.25), radius: rand(0.55, 2.6), speed: rand(0.008, 0.018), phase: rand(0, 6.28) };
      }),
    [scene, animations]
  );
  const tmp = useMemo(() => new Vector3(), []);
  const fade = useRef(0);
  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const want = live.night > 0.5 ? 1 : 0;
    fade.current += (want - fade.current) * Math.min(1, delta * 1.5);
    items.forEach((it, i) => {
      it.mixer.update(Math.min(delta, 0.05));
      it.angle += it.speed * delta;
      ringPoint(it.angle, it.radius, tmp);
      it.obj.position.set(tmp.x, WATER_Y - 0.04 + Math.sin(t * 0.9 + it.phase) * 0.015 - (1 - fade.current) * 0.7, tmp.z);
      it.obj.rotation.set(Math.sin(t * 0.7 + it.phase) * 0.05, t * 0.05 + it.phase, Math.sin(t * 0.8 + it.phase) * 0.05);
      it.obj.visible = fade.current > 0.02;
      lanternGlow[i].set(tmp.x, tmp.z, fade.current * live.night * 0.7);
    });
  });
  useEffect(() => () => lanternGlow.forEach((l) => l.set(0, 0, 0)), []);
  return (
    <group>
      {items.map((it, i) => (
        <primitive key={i} object={it.obj} />
      ))}
    </group>
  );
}

/* ---------------- night: koi jumps ---------------- */

// the koi model's nose points along -x after its own root rotation; flip if it jumps tail first
const KOI_YAW = Math.PI;

function Koi() {
  const { scene, animations } = useGLTF(PROPS + "koi_fish.glb");
  const fish = useMemo(() => {
    const obj = scene.clone(true);
    obj.traverse((o) => o.isMesh && (o.frustumCulled = false));
    return obj;
  }, [scene]);
  const holder = useRef();
  const mixer = useMemo(() => new AnimationMixer(fish), [fish]);
  useEffect(() => {
    animations.forEach((clip) => mixer.clipAction(clip).play());
  }, [animations, mixer]);
  const jump = useRef({ t: -1, wait: rand(4, 8), from: new Vector3(), to: new Vector3() });
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    mixer.update(dt * 1.6);
    const j = jump.current;
    const g = holder.current;
    if (!g) return;
    if (j.t < 0) {
      g.visible = false;
      if (live.night < 0.5) return;
      j.wait -= dt;
      if (j.wait > 0) return;
      // pick a spot and a direction, then leap
      const a = rand(0, Math.PI * 2);
      ringPoint(a, rand(1.5, 5), j.from);
      const dir = rand(0, Math.PI * 2);
      j.to.set(j.from.x + Math.cos(dir) * 0.9, WATER_Y, j.from.z + Math.sin(dir) * 0.9);
      j.t = 0;
      addRipple(j.from.x, j.from.z, 1.1);
    } else {
      j.t += dt / 1.05;
      const k = Math.min(1, j.t);
      const x = j.from.x + (j.to.x - j.from.x) * k;
      const z = j.from.z + (j.to.z - j.from.z) * k;
      const y = WATER_Y - 0.08 + Math.sin(k * Math.PI) * 0.55;
      g.position.set(x, y, z);
      g.rotation.set(0, Math.atan2(-(j.to.z - j.from.z), j.to.x - j.from.x), 0);
      fish.rotation.z = Math.cos(k * Math.PI) * 0.9; // nose up, then down
      g.visible = true;
      if (k >= 1) {
        addRipple(j.to.x, j.to.z, 1.3);
        j.t = -1;
        j.wait = rand(7, 14);
      }
    }
  });
  return (
    <group ref={holder} visible={false}>
      <group scale={0.07} rotation={[0, KOI_YAW, 0]}>
        <primitive object={fish} />
      </group>
    </group>
  );
}

/* ---------------- night: fireflies ---------------- */

const fireflyVertex = /* glsl */ `
  attribute vec3 seed;
  uniform float uTime;
  uniform float uSize;
  varying float vBlink;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.35 + seed.x * 6.28) * 0.35;
    p.y += sin(uTime * 0.5 + seed.y * 6.28) * 0.18;
    p.z += cos(uTime * 0.3 + seed.z * 6.28) * 0.35;
    vBlink = pow(0.5 + 0.5 * sin(uTime * (1.2 + seed.x * 2.0) + seed.y * 40.0), 3.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * (0.6 + vBlink) / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const fireflyFragment = /* glsl */ `
  uniform float uAlpha;
  varying float vBlink;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vec3(1.0, 0.85, 0.45) * (0.4 + vBlink), a * uAlpha * (0.25 + vBlink));
  }
`;

function Fireflies() {
  const { size, gl } = useThree();
  const geo = useMemo(() => {
    const n = 70;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 3);
    const v = new Vector3();
    for (let i = 0; i < n; i++) {
      ringPoint(rand(0, Math.PI * 2), rand(0.4, 6), v);
      pos.set([v.x, WATER_Y + rand(0.25, 1.8), v.z], i * 3);
      seed.set([Math.random(), Math.random(), Math.random()], i * 3);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("seed", new BufferAttribute(seed, 3));
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uSize: { value: 60 } },
        vertexShader: fireflyVertex,
        fragmentShader: fireflyFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    []
  );
  useFrame((state) => {
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uAlpha.value = Math.max(0, live.night - 0.3) / 0.7;
    mat.uniforms.uSize.value = 55 * gl.getPixelRatio() * (size.height / 900);
  });
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}

/* ---------------- lights for the props ---------------- */

// The room is baked (unlit); only the props use these lights.
function PropLights() {
  const hemi = useRef();
  const sun = useRef();
  const c = useMemo(() => new Color(), []);
  useFrame(() => {
    const n = live.night;
    if (hemi.current) {
      hemi.current.color.copy(live.skyTop).lerp(c.set("#ffffff"), 0.5 * (1 - n));
      hemi.current.groundColor.copy(live.water);
      hemi.current.intensity = 1.6 - n * 1.1;
    }
    if (sun.current) {
      sun.current.color.copy(c.set("#fff3e0")).lerp(live.accent, n * 0.6);
      sun.current.intensity = 2.2 - n * 1.6;
    }
  });
  const lit = (o) => o && o.layers.enable(REFLECT_LAYER);
  return (
    <>
      <hemisphereLight ref={(o) => ((hemi.current = o), lit(o))} />
      <directionalLight ref={(o) => ((sun.current = o), lit(o))} position={[-4, 6, 5]} />
    </>
  );
}

export default function WaterLife() {
  const { started, preset } = useRoomState();
  const nightEver = useRef(false);
  if (preset && preset !== "day") nightEver.current = true;
  if (!started) return null;
  return (
    <>
      <PropLights />
      <Suspense fallback={null}>
        <Ducks />
      </Suspense>
      <Fireflies />
      {/* lanterns and koi only load once a night preset has been used */}
      {nightEver.current && (
        <Suspense fallback={null}>
          <Lanterns />
          <Koi />
        </Suspense>
      )}
    </>
  );
}

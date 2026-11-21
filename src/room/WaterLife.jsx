import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  CanvasTexture,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  AnimationMixer,
  BufferAttribute,
  Box3,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  LoopRepeat,
  ShaderMaterial,
  Vector3,
} from "three";
import { live, sampleGradient } from "./lighting.js";
import { getRoomState, useRoomState } from "./roomStore.js";
import { addRipple, lanternColor, lanternGlow, PLINTH_HALF, REFLECT_LAYER, WATER_Y } from "./RoomWorld.jsx";
import { ROOM_BASE } from "./roomConfig.js";
import { renderFlags } from "./renderFlags.js";

/*
 * Life on the water:
 *  - rubber ducks drifting round the plinth; now and then one dives and pops
 *    up somewhere else. Click one: squeak, spin, heart. Find all 5 for a parade.
 *  - at night: glowing glass orbs, fireflies and the odd koi jump.
 * Models: "Yellow rubber duck" by sanch_aozz, "Koi Fish" by 7plus (Sketchfab, CC BY 4.0).
 */

const PROPS = ROOM_BASE + "props/";

// Sketchfab exports carry their own node scales/rotations, so measure the
// real bounding box and wrap the model so it is `size` metres along its
// longest side (or `height` tall), centred on x/z with its base at y = 0.
function fitModel(model, { size, height }) {
  const box = new Box3().setFromObject(model);
  const dims = box.getSize(new Vector3());
  const k = height ? height / dims.y : size / Math.max(dims.x, dims.y, dims.z);
  const inner = new Group();
  inner.add(model);
  const c = box.getCenter(new Vector3());
  model.position.sub(new Vector3(c.x, box.min.y, c.z));
  const outer = new Group();
  outer.add(inner);
  inner.scale.setScalar(k);
  return { obj: outer, dims: dims.multiplyScalar(k) };
}
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
    return Array.from({ length: DUCKS }, () => {
      const holder = new Group();
      holder.name = "Duck";
      const { obj } = fitModel(scene.clone(true), { height: DUCK_HEIGHT });
      obj.position.y = -DUCK_HEIGHT * 0.22; // sit a little into the water
      obj.traverse((o) => o.isMesh && o.layers.enable(REFLECT_LAYER));
      holder.add(obj);
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
    if (!getRoomState().started) return; // mounted early so it compiles during the warm-up
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

/* ---------------- night: floating light orbs ---------------- */

// Glass orbs that drift round the plinth, half in the water. Each takes a
// colour from the current mood's Nanoleaf gradient and lights the water
// under it. Click one and it flares and sends out a ripple.
const ORBS = 6;

const orbVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * (modelViewMatrix * vec4(position, 1.0));
  }
`;
const orbFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uGain;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    float facing = clamp(dot(normalize(vN), normalize(vView)), 0.0, 1.0);
    float core = pow(facing, 2.5);
    float rim = pow(1.0 - facing, 3.0);
    // tinted glass: a bright core, a darker body and a coloured rim
    vec3 col = uColor * (0.25 + 1.5 * core) * uGain + vec3(1.0) * pow(core, 6.0) * 0.55 * uGain + uColor * rim * 0.9;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// soft round glow for the halo sprites
let haloTexture = null;
function getHalo() {
  if (haloTexture) return haloTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.18, "rgba(255,255,255,0.45)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  haloTexture = new CanvasTexture(c);
  return haloTexture;
}

function Orbs() {
  const items = useMemo(() => {
    const geo = new SphereGeometry(1, 32, 20);
    return Array.from({ length: ORBS }, (_, i) => {
      const r = rand(0.08, 0.12);
      const mat = new ShaderMaterial({
        uniforms: { uColor: { value: new Color(1, 1, 1) }, uGain: { value: 1 } },
        vertexShader: orbVertex,
        fragmentShader: orbFragment,
      });
      const ball = new Mesh(geo, mat);
      ball.scale.setScalar(r);
      ball.layers.enable(REFLECT_LAYER);
      ball.name = "Orb";
      const halo = new Sprite(
        new SpriteMaterial({ map: getHalo(), blending: AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false })
      );
      halo.scale.setScalar(r * 9);
      halo.layers.enable(REFLECT_LAYER);
      const obj = new Group();
      obj.add(ball, halo);
      obj.visible = false;
      return {
        obj,
        ball,
        halo,
        r,
        t: (i + 0.5) / ORBS, // where on the mood gradient its colour comes from
        angle: (i / ORBS) * Math.PI * 2 + rand(-0.3, 0.3),
        radius: rand(0.5, 2.6),
        speed: rand(0.008, 0.02) * (Math.random() < 0.5 ? -1 : 1),
        phase: rand(0, 6.28),
        flare: 0,
      };
    });
  }, []);

  // halos are see-through: keep them out of the depth pre-pass
  useEffect(() => {
    items.forEach((it) => renderFlags.hideInPrepass.set(it.halo, () => true));
    return () => {
      items.forEach((it) => {
        renderFlags.hideInPrepass.delete(it.halo);
        it.ball.material.dispose();
        it.halo.material.dispose();
      });
      lanternGlow.forEach((l) => l.set(0, 0, 0));
    };
  }, [items]);

  const tmp = useMemo(() => new Vector3(), []);
  const fade = useRef(0);
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;
    const want = live.night > 0.5 && getRoomState().started ? 1 : 0;
    fade.current += (want - fade.current) * Math.min(1, dt * 1.2);
    const f = fade.current;
    items.forEach((it, i) => {
      it.angle += it.speed * dt;
      it.flare = Math.max(0, it.flare - dt * 1.4);
      ringPoint(it.angle, it.radius, tmp);
      // half in the water, bobbing; rises out of / sinks into the water as night comes and goes
      const bob = Math.sin(t * 1.1 + it.phase) * 0.012;
      it.obj.position.set(tmp.x, WATER_Y + it.r * 0.35 + bob - (1 - f) * it.r * 2.5, tmp.z);
      it.obj.visible = f > 0.01;
      const c = sampleGradient(live.nano, it.t);
      const pulse = 0.85 + 0.15 * Math.sin(t * 1.7 + it.phase * 3.0);
      const gain = (pulse + it.flare * 1.5) * f;
      it.ball.material.uniforms.uColor.value.setRGB(c[0], c[1], c[2]);
      it.ball.material.uniforms.uGain.value = gain;
      it.halo.material.color.setRGB(c[0], c[1], c[2]).multiplyScalar(1.0 * gain);
      it.halo.scale.setScalar(it.r * (9 + it.flare * 6));
      lanternGlow[i].set(tmp.x, tmp.z, gain * live.night * 1.0);
      lanternColor[i].set(c[0], c[1], c[2]);
    });
  });

  return (
    <group>
      {items.map((it, i) => (
        <primitive
          key={i}
          object={it.obj}
          onClick={(e) => {
            if (e.object !== it.ball) return;
            e.stopPropagation();
            it.flare = 1;
            addRipple(it.obj.position.x, it.obj.position.z, 0.9);
          }}
          onPointerOver={(e) => e.object === it.ball && (document.body.style.cursor = "pointer")}
          onPointerOut={() => (document.body.style.cursor = "auto")}
        />
      ))}
    </group>
  );
}

/* ---------------- night: koi jumps ---------------- */

// flip to Math.PI if the koi jumps tail first
const KOI_YAW = 0;

function Koi() {
  const { scene, animations } = useGLTF(PROPS + "koi_fish.glb");
  const { fish, fitted } = useMemo(() => {
    const obj = scene.clone(true);
    obj.traverse((o) => o.isMesh && (o.frustumCulled = false));
    const f = fitModel(obj, { size: 0.55 });
    // lay the fish's long axis along +x of the jump frame
    if (f.dims.z > f.dims.x) f.obj.rotation.y = Math.PI / 2;
    f.obj.position.y = -f.dims.y / 2;
    return { fish: obj, fitted: f.obj };
  }, [scene]);
  const holder = useRef();
  const pitch = useRef();
  const { gl, camera, scene: root } = useThree();
  useEffect(() => {
    const g = holder.current;
    if (!g) return;
    g.name = "Koi";
    // upload and compile now, while it's hidden, not on its first jump
    g.traverse((o) => {
      const m = o.material;
      if (m) ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap"].forEach((k) => m[k] && gl.initTexture(m[k]));
    });
    if (gl.compileAsync) gl.compileAsync(g, camera, root).catch(() => {});
    else gl.compile(g, camera, root);
  }, [fitted]);
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
      if (live.night < 0.5 || !getRoomState().started) return;
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
      if (pitch.current) pitch.current.rotation.z = Math.cos(k * Math.PI) * 0.9; // nose up, then down
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
      <group ref={pitch}>
        <group rotation={[0, KOI_YAW, 0]}>
          <primitive object={fitted} />
        </group>
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
    mat.uniforms.uAlpha.value = getRoomState().started ? Math.max(0, live.night - 0.3) / 0.7 : 0;
    mat.uniforms.uSize.value = 55 * gl.getPixelRatio() * (size.height / 900);
  });
  const pts = useRef();
  useEffect(() => {
    const o = pts.current;
    if (!o) return;
    renderFlags.hideInPrepass.set(o, () => true);
    return () => renderFlags.hideInPrepass.delete(o);
  }, []);
  return <points ref={pts} geometry={geo} material={mat} frustumCulled={false} />;
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
  // Mounted from the start (everything stays hidden until Enter), so the
  // models and shaders are ready by the warm-up instead of compiling mid-flight.
  const { preset, ready } = useRoomState();
  const nightEver = useRef(false);
  if (preset && preset !== "day") nightEver.current = true;
  return (
    <>
      <PropLights />
      <Suspense fallback={null}>
        <Ducks />
      </Suspense>
      <Fireflies />
      <Orbs />
      {/* the koi (5 MB) only loads once the room is up and a night preset has been used */}
      {nightEver.current && ready && (
        <Suspense fallback={null}>
          <Koi />
        </Suspense>
      )}
    </>
  );
}

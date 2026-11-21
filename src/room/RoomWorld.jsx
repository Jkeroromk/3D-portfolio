import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BackSide,
  Color,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  PerspectiveCamera,
  Plane,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from "three";
import { live } from "./lighting.js";
import { MOBILE } from "./device.js";
import { renderFlags } from "./renderFlags.js";

/*
 * The world around the room: a sky dome that follows the lighting preset
 * (stars at night) and calm water with ripples and a real-time reflection of
 * the plinth, the outer walls and the sky. The reflection only renders the
 * meshes on REFLECT_LAYER, at reduced resolution; phones skip it and reflect
 * the sky colour only.
 */

export const REFLECT_LAYER = 1;
export const WATER_Y = -1.7; // 0.4 m below the room floor, as in the Blender concept
// The plinth in world space (centre 0,0) - ripples ring out from its edges
export const PLINTH_HALF = new Vector2(2.68, 1.61);

// Ripples anyone can drop into the water (clicks, ducks surfacing, koi
// splashing): x, z, start time, strength. Oldest one is recycled.
const MAX_RIPPLES = 8;
const ripples = Array.from({ length: MAX_RIPPLES }, () => new Vector4(0, 0, -100, 0));
let rippleNext = 0;
let clockNow = 0;
export function addRipple(x, z, strength = 1) {
  ripples[rippleNext].set(x, z, clockNow, strength);
  rippleNext = (rippleNext + 1) % MAX_RIPPLES;
}

// Warm light pools on the water under the floating lanterns (x, z, intensity)
export const lanternGlow = Array.from({ length: 6 }, () => new Vector3(0, 0, 0));

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform float uNight;
  uniform float uTime;
  varying vec3 vDir;
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  void main() {
    vec3 d = normalize(vDir);
    float t = clamp(d.y * 1.4 + 0.05, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(t, 0.55));
    // stars at night, fading out towards the horizon
    if (uNight > 0.01 && d.y > 0.0) {
      vec3 g = d * 260.0;
      vec3 cell = floor(g);
      float h = hash(cell);
      if (h > 0.9965) {
        vec3 c = cell + 0.5 + 0.35 * (vec3(hash(cell + 1.3), hash(cell + 2.7), hash(cell + 4.1)) - 0.5);
        float r = length(g - c);
        float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 3.0) + h * 60.0);
        col += vec3(0.9, 0.92, 1.0) * smoothstep(0.32, 0.0, r) * tw * uNight * smoothstep(0.0, 0.35, d.y);
      }
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const waterVertex = /* glsl */ `
  uniform mat4 uTexMat;
  varying vec3 vWorld;
  varying vec4 vReflect;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vReflect = uTexMat * w;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const waterFragment = /* glsl */ `
  uniform sampler2D uReflect;
  uniform float uHasReflect;
  uniform float uTime;
  uniform vec3 uWater;
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform vec2 uPlinth;
  uniform vec4 uRipples[${MAX_RIPPLES}];
  uniform vec3 uLanterns[6];
  varying vec3 vWorld;
  varying vec4 vReflect;

  // height of the water surface: a few slow swells, small wind ripples and
  // rings travelling out from the plinth. Returns (height, d/dx, d/dz).
  vec3 wave(vec2 p, vec2 dir, float freq, float speed, float amp) {
    float ph = dot(p, dir) * freq + uTime * speed;
    return vec3(sin(ph) * amp, cos(ph) * amp * freq * dir);
  }
  vec3 surface(vec2 p) {
    vec3 h = vec3(0.0);
    h += wave(p, normalize(vec2(1.0, 0.35)), 0.9, 0.55, 0.030);
    h += wave(p, normalize(vec2(-0.45, 1.0)), 1.6, 0.85, 0.016);
    h += wave(p, normalize(vec2(0.8, -0.6)), 3.1, 1.40, 0.007);
    h += wave(p, normalize(vec2(-1.0, -0.2)), 5.3, 2.10, 0.0035);
    h += wave(p, normalize(vec2(0.2, 1.0)), 8.7, 2.90, 0.0018);
    // rings from the plinth edges
    vec2 q = abs(p) - uPlinth;
    float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    if (dist > 0.0) {
      vec2 grad = q.x > q.y ? vec2(sign(p.x), 0.0) : vec2(0.0, sign(p.y));
      if (q.x > 0.0 && q.y > 0.0) grad = normalize(max(q, 0.0)) * sign(p);
      float k = 9.0;
      float env = exp(-dist * 0.55) * smoothstep(0.0, 0.25, dist);
      float ph = dist * k - uTime * 1.9;
      h.x += sin(ph) * 0.012 * env;
      h.yz += grad * cos(ph) * 0.012 * k * env;
    }
    // ripples dropped in by clicks, ducks and fish
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      vec4 rp = uRipples[i];
      float age = uTime - rp.z;
      if (age < 0.0 || age > 4.0 || rp.w <= 0.0) continue;
      vec2 dv = p - rp.xy;
      float d = length(dv) + 1e-4;
      float front = age * 1.15;
      float x = d - front;
      float env = exp(-x * x * 10.0) * exp(-age * 0.9) * smoothstep(0.0, 0.15, age) * rp.w;
      float k = 16.0;
      h.x += sin(x * k) * 0.02 * env;
      h.yz += (dv / d) * cos(x * k) * 0.02 * k * env;
    }
    return h;
  }

  void main() {
    vec3 s = surface(vWorld.xz);
    vec3 n = normalize(vec3(-s.y, 1.0, -s.z));
    vec3 v = normalize(cameraPosition - vWorld);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);

    // sky seen in the water
    vec3 r = reflect(-v, n);
    float t = clamp(r.y * 1.4 + 0.05, 0.0, 1.0);
    vec3 sky = mix(uHorizon, uTop, pow(t, 0.55));

    vec3 refl = sky;
    if (uHasReflect > 0.5) {
      vec2 uv = vReflect.xy / vReflect.w + n.xz * 0.045;
      vec4 rc = texture2D(uReflect, uv);
      refl = mix(sky, rc.rgb, rc.a);
    }

    float dist = length(vWorld.xz);
    vec3 col = mix(uWater, refl, clamp(0.35 + fres * 0.9, 0.0, 1.0));
    // the room's lights spill onto the water close to the plinth
    vec2 q = abs(vWorld.xz) - uPlinth;
    float pd = length(max(q, 0.0));
    col += uGlow * exp(-pd * 1.6) * 0.5;
    // floating lanterns light the water around them
    for (int i = 0; i < 6; i++) {
      vec3 l = uLanterns[i];
      if (l.z <= 0.0) continue;
      float dl = length(vWorld.xz - l.xy);
      col += vec3(1.0, 0.62, 0.28) * l.z * (exp(-dl * 3.2) * 0.9 + exp(-dl * 0.9) * 0.12);
    }
    // haze into the horizon
    col = mix(col, uHorizon, smoothstep(10.0, 48.0, dist));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export default function RoomWorld() {
  const { gl, scene, camera, size } = useThree();
  const water = useRef();
  const sky = useRef();

  const skyMat = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uTop: { value: new Color() },
          uHorizon: { value: new Color() },
          uNight: { value: 0 },
          uTime: { value: 0 },
        },
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: BackSide,
        depthWrite: false,
      }),
    []
  );

  const reflect = useMemo(() => {
    if (MOBILE) return null;
    const rt = new WebGLRenderTarget(512, 256, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter });
    const cam = new PerspectiveCamera();
    cam.layers.set(REFLECT_LAYER);
    return { rt, cam, texMat: new Matrix4() };
  }, []);

  const waterMat = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uReflect: { value: reflect ? reflect.rt.texture : null },
          uHasReflect: { value: reflect ? 1 : 0 },
          uTexMat: { value: reflect ? reflect.texMat : new Matrix4() },
          uTime: { value: 0 },
          uWater: { value: new Color() },
          uTop: { value: new Color() },
          uHorizon: { value: new Color() },
          uGlow: { value: new Vector3() },
          uPlinth: { value: PLINTH_HALF.clone() },
          uRipples: { value: ripples },
          uLanterns: { value: lanternGlow },
        },
        vertexShader: waterVertex,
        fragmentShader: waterFragment,
      }),
    [reflect]
  );

  // reflection resolution follows the canvas (half size, capped)
  useEffect(() => {
    if (!reflect) return;
    const dpr = gl.getPixelRatio();
    const w = Math.min(1024, Math.round(size.width * dpr * 0.5));
    reflect.rt.setSize(w, Math.round((w * size.height) / size.width));
  }, [size, reflect, gl]);

  useEffect(
    () => () => {
      if (reflect) reflect.rt.dispose();
      skyMat.dispose();
      waterMat.dispose();
    },
    []
  );

  // scratch objects for the mirror camera
  const tmp = useMemo(
    () => ({
      normal: new Vector3(0, 1, 0),
      point: new Vector3(0, WATER_Y, 0),
      view: new Vector3(),
      target: new Vector3(),
      look: new Vector3(),
      rot: new Matrix4(),
      plane: new Plane(),
      clip: new Vector4(),
      q: new Vector4(),
    }),
    []
  );

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    clockNow = time;
    const night = live.night;
    const I = live.intro;

    skyMat.uniforms.uTop.value.copy(live.skyTop);
    skyMat.uniforms.uHorizon.value.copy(live.skyHorizon);
    skyMat.uniforms.uNight.value = night;
    skyMat.uniforms.uTime.value = time;
    if (sky.current) sky.current.position.copy(camera.position);

    const u = waterMat.uniforms;
    u.uTime.value = time;
    u.uWater.value.copy(live.water);
    u.uTop.value.copy(live.skyTop);
    u.uHorizon.value.copy(live.skyHorizon);
    const L = live.layers;
    u.uGlow.value
      .set(
        L[5][0] * 0.7 + L[0][0] * 0.25 + L[1][0] * 0.2,
        L[5][1] * 0.7 + L[0][1] * 0.25 + L[1][1] * 0.2,
        L[5][2] * 0.7 + L[0][2] * 0.25 + L[1][2] * 0.2
      )
      .multiplyScalar(night * Math.max(I.layers[5], I.layers[0]) * 0.35);
  });

  // Render the mirror view right before the water is drawn, i.e. after every
  // useFrame has moved the camera, so the reflection never lags a frame.
  useEffect(() => {
    if (!reflect || !water.current) return;
    water.current.onBeforeRender = (renderer, _scene, camera) => {
      if (renderFlags.prepass) return; // depth pre-pass: no reflection needed
      const gl = renderer;

      // mirror the camera in the water plane (as three's Reflector does)
      const { normal, point, view, target, look, rot, plane, clip, q } = tmp;
      const cam = reflect.cam;
      view.subVectors(point, camera.position);
      if (view.dot(normal) > 0) return; // camera under water
      view.reflect(normal).negate().add(point);
      rot.extractRotation(camera.matrixWorld);
      look.set(0, 0, -1).applyMatrix4(rot).add(camera.position);
      target.subVectors(point, look).reflect(normal).negate().add(point);
      cam.position.copy(view);
      cam.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
      cam.lookAt(target);
      cam.near = camera.near;
      cam.far = camera.far;
      cam.updateMatrixWorld();
      cam.projectionMatrix.copy(camera.projectionMatrix);

      reflect.texMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      reflect.texMat.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

      // oblique near plane: nothing below the water ends up in the reflection
      plane.setFromNormalAndCoplanarPoint(normal, point).applyMatrix4(cam.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const pm = cam.projectionMatrix.elements;
      q.set((Math.sign(clip.x) + pm[8]) / pm[0], (Math.sign(clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
      clip.multiplyScalar(2 / clip.dot(q));
      pm[2] = clip.x;
      pm[6] = clip.y;
      pm[10] = clip.z + 1 - 0.003;
      pm[14] = clip.w;
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();

      const prevTarget = gl.getRenderTarget();
      const prevClear = gl.getClearAlpha();
      gl.setRenderTarget(reflect.rt);
      gl.setClearAlpha(0);
      gl.clear();
      gl.render(scene, cam);
      gl.setRenderTarget(prevTarget);
      gl.setClearAlpha(prevClear);
    };
  }, [reflect, scene, tmp]);

  return (
    <>
      <mesh ref={sky} material={skyMat} frustumCulled={false} renderOrder={-10} onUpdate={(m) => m.layers.enable(REFLECT_LAYER)}>
        <sphereGeometry args={[150, 48, 24]} />
      </mesh>
      <mesh
        ref={water}
        material={waterMat}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, WATER_Y, 0]}
        onClick={(e) => {
          // ignore the end of a drag (orbiting)
          if (e.delta > 6) return;
          e.stopPropagation();
          addRipple(e.point.x, e.point.z, 1);
        }}
      >
        <planeGeometry args={[400, 400, 1, 1]} />
      </mesh>
    </>
  );
}

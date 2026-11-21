import { Html, OrbitControls, useGLTF } from "@react-three/drei";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  AdditiveBlending,
  Box3,
  Color,
  DoubleSide,
  Group,
  MeshBasicMaterial,
  Quaternion,
  ShaderMaterial,
  SRGBColorSpace,
  Spherical,
  TextureLoader,
  Vector3,
  VideoTexture,
} from "three";
import { LINKS, ROOM_BASE } from "./roomConfig.js";
import { setRoomState, useRoomState } from "./roomStore.js";

/*
 * WorkPlace: Jason's room, modelled and lit in Blender, with the lighting
 * baked into textures (one day set, one night set). Every baked mesh uses a
 * tiny shader that cross-fades between its day and night texture.
 *
 * public/models/room/manifest.json is written by the Blender export script.
 */

const FLOOR_Y = -1.3;
const TARGET = new Vector3(0, -0.6, 0);
const START = { azimuth: -0.62, polar: 0.98, distance: 4.4 };
const DESKTOP_ASPECT = 1.6;
const Y_AXIS = new Vector3(0, 1, 0);

function prepTexture(t) {
  t.flipY = false; // glTF UV convention
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const bakedVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const bakedFragment = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform float uMix;
  varying vec2 vUv;
  void main() {
    vec3 day = texture2D(uDay, vUv).rgb;
    vec3 night = texture2D(uNight, vUv).rgb;
    gl_FragColor = vec4(mix(day, night, uMix), 1.0);
    #include <colorspace_fragment>
  }
`;

function makeBakedMaterial(day) {
  return new ShaderMaterial({
    uniforms: { uDay: { value: day }, uNight: { value: day }, uMix: { value: 0 } },
    vertexShader: bakedVertex,
    fragmentShader: bakedFragment,
    side: DoubleSide,
  });
}

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

/* ---------- the room itself ---------- */

function Room({ manifest }) {
  const { scene } = useGLTF(ROOM_BASE + manifest.glb, true);
  const dayTextures = useLoader(
    TextureLoader,
    manifest.bakes.map((b) => ROOM_BASE + b.day)
  );
  const { night } = useRoomState();

  const mix = useRef(0);
  const [nightReady, setNightReady] = useState(false);

  // Set the materials up once per loaded scene. useGLTF caches the scene, so
  // the result is kept on scene.userData and reused when the tab is reopened.
  const room = useMemo(() => {
    if (scene.userData.room) return scene.userData.room;
    const baked = [];
    const lit = [];
    const nightOnly = [];

    manifest.bakes.forEach((b, i) => {
      const meshes = (b.meshes || [b.mesh]).map((n) => scene.getObjectByName(n)).filter(Boolean);
      if (!meshes.length) return;
      const mat = makeBakedMaterial(prepTexture(dayTextures[i]));
      meshes.forEach((m) => (m.material = mat));
      baked.push({ mat, night: ROOM_BASE + b.night });
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
      if (s.night !== undefined) lit.push({ mat, day: s.day ?? 1, night: s.night });
    });

    // See-through panels: not baked, just a faint tint
    (manifest.glass || []).forEach((g) => {
      const mesh = scene.getObjectByName(g.mesh);
      if (!mesh) return;
      mesh.material = new MeshBasicMaterial({
        color: new Color(...(g.color || [0.85, 0.9, 1])),
        transparent: true,
        opacity: g.opacity ?? 0.1,
        depthWrite: false,
        toneMapped: false,
      });
      mesh.renderOrder = 5;
    });

    (manifest.nightOnly || []).forEach((n) => {
      const mesh = scene.getObjectByName(n.mesh);
      if (!mesh) return;
      mesh.material = new MeshBasicMaterial({
        color: new Color(...n.color),
        transparent: true,
        opacity: 0,
        toneMapped: false,
      });
      mesh.visible = false;
      nightOnly.push(mesh);
    });

    // Invisible click targets (frames, G9). Pull them out of the glTF tree so
    // only these few quads are raycast on pointer move, not the whole room.
    scene.updateMatrixWorld(true);
    const hits = [];
    scene.traverse((o) => {
      if (o.isMesh && o.name.startsWith("Hit_")) hits.push(o);
    });
    hits.forEach((o) => {
      const m = o.matrixWorld.clone();
      o.removeFromParent();
      m.decompose(o.position, o.quaternion, o.scale);
      o.material = new MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      o.renderOrder = 10;
    });

    // Chair: hang the seat on a pivot at the gas-lift axis
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

    // Fans: each rotor spins about its own axis through its hub
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

    // Centre the room on the origin with the floor at FLOOR_Y
    const box = new Box3().setFromObject(scene);
    const c = box.getCenter(new Vector3());
    const offset = [-c.x, FLOOR_Y - box.min.y, -c.z];

    const r = { baked, lit, nightOnly, hits, swivel, swivelRest, fans, offset, nightLoaded: false };
    scene.userData.room = r;
    return r;
  }, [scene, manifest, dayTextures]);

  // Load the night textures in the background once the day set is up
  useEffect(() => {
    if (room.nightLoaded) {
      setNightReady(true);
      return;
    }
    let cancelled = false;
    const loader = new TextureLoader();
    const id = setTimeout(() => {
      Promise.all(
        room.baked.map(
          ({ mat, night }) =>
            new Promise((res) =>
              loader.load(
                night,
                (t) => {
                  mat.uniforms.uNight.value = prepTexture(t);
                  res();
                },
                undefined,
                res
              )
            )
        )
      ).then(() => {
        room.nightLoaded = true;
        if (!cancelled) setNightReady(true);
      });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [room]);

  useEffect(() => {
    setRoomState({ loadingNight: night && !nightReady });
  }, [night, nightReady]);

  // Everything Room suspends on (glb + day textures) is in: hide the loader
  useEffect(() => {
    setRoomState({ ready: true });
  }, []);

  const tmpQ = useMemo(() => new Quaternion(), []);
  useFrame((state, delta) => {
    const goal = night && nightReady ? 1 : 0;
    mix.current += (goal - mix.current) * Math.min(1, delta * 3);
    const m = mix.current;
    room.baked.forEach(({ mat }) => (mat.uniforms.uMix.value = m));
    room.lit.forEach(({ mat, day, night: n }) => {
      const k = day + (n - day) * m;
      mat.color.setRGB(k, k, k);
    });
    room.nightOnly.forEach((mesh) => {
      mesh.visible = m > 0.01;
      mesh.material.opacity = m;
    });

    room.fans.forEach((f) => f.pivot.rotateOnAxis(f.axis, f.speed * delta));

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
      {room.hits.map((h) => (
        <Hotspot key={h.name} mesh={h} />
      ))}
    </group>
  );
}

function Hotspot({ mesh }) {
  const link = LINKS[mesh.name];
  const [hovered, setHovered] = useState(false);
  const clickable = !!link?.url;

  useFrame((_, delta) => {
    const goal = hovered && clickable ? 0.18 : 0;
    mesh.material.opacity += (goal - mesh.material.opacity) * Math.min(1, delta * 8);
  });

  const center = useMemo(() => {
    mesh.geometry.computeBoundingBox();
    return mesh.geometry.boundingBox.getCenter(new Vector3());
  }, [mesh]);

  return (
    <primitive
      object={mesh}
      onPointerOver={(e) => {
        e.stopPropagation();
        if (!clickable) return;
        setHovered(true);
        setCursor("pointer");
      }}
      onPointerOut={() => {
        setHovered(false);
        setCursor("auto");
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (clickable) window.open(link.url, "_blank", "noopener");
      }}
    >
      {clickable && hovered && (
        <Html position={center} center zIndexRange={[20, 0]}>
          <div className="room-tooltip">{link.label} ↗</div>
        </Html>
      )}
    </primitive>
  );
}

/* ---------- scene wrapper: camera, controls, events ---------- */

export default function BakedRoomScene() {
  const manifest = useManifest();
  const { camera, size } = useThree();
  const controls = useRef();

  // Start position: pulled back on narrow / portrait screens
  useEffect(() => {
    const aspect = size.width / size.height;
    const pullBack = Math.min(Math.max(1, DESKTOP_ASPECT / aspect), 2.2);
    const s = new Spherical(START.distance * pullBack, START.polar, START.azimuth);
    camera.position.copy(new Vector3().setFromSpherical(s).add(TARGET));
    camera.lookAt(TARGET);
    if (controls.current) {
      controls.current.target.copy(TARGET);
      controls.current.maxDistance = 7 * pullBack;
      controls.current.update();
    }
  }, [camera, size.width, size.height]);

  useEffect(() => {
    return () => {
      setCursor("auto");
      setRoomState({ ready: false });
    };
  }, []);

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
        maxDistance={7}
        minPolarAngle={0.45}
        maxPolarAngle={1.35}
        minAzimuthAngle={-1.45}
        maxAzimuthAngle={0.05}
        rotateSpeed={0.5}
      />
      <Suspense fallback={null}>{manifest && <Room manifest={manifest} />}</Suspense>
    </>
  );
}


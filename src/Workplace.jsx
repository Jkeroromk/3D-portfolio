import { Environment, PresentationControls, Text } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import {
  CanvasTexture,
  Color,
  DoubleSide,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from "three";

/*
 * WorkPlace: a cut-away diorama of Jason's real desk setup.
 * Units are metres. The room's floor sits at local y = 0, the back wall
 * runs along -z and the window/curtain wall along -x.
 */

const DESK = 0.765; // desk top height
const WHITE = "#f1f1f1";
const BLACK = "#1b1b1b";
const CAMERA_TARGET = new Vector3(-2, 2.6, 5.2);
const DESKTOP_ASPECT = 1.35;

const NANOLEAF_PALETTES = [
  { color: "#ffe2b8", light: "#ffe7c4" },
  { color: "#b388ff", light: "#9b6bff" },
  { color: "#5ce1e6", light: "#3fd3dc" },
  { color: "#ff7eb6", light: "#ff5fa2" },
];

/* ---------- small building blocks ---------- */

function Box({ size, color = WHITE, emissive, emissiveIntensity = 1, roughness = 0.75, ...props }) {
  return (
    <mesh castShadow receiveShadow {...props}>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        roughness={roughness}
        emissive={emissive || "#000000"}
        emissiveIntensity={emissive ? emissiveIntensity : 0}
      />
    </mesh>
  );
}

function Cyl({ args, color = BLACK, roughness = 0.6, ...props }) {
  return (
    <mesh castShadow receiveShadow {...props}>
      <cylinderGeometry args={args} />
      <meshStandardMaterial color={color} roughness={roughness} />
    </mesh>
  );
}

// A rod between two points (boom arm, chair legs...)
function Segment({ from, to, radius = 0.014, color = BLACK }) {
  const a = new Vector3(...from);
  const b = new Vector3(...to);
  const dir = b.clone().sub(a);
  const length = dir.length();
  const quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
  const position = a.add(b).multiplyScalar(0.5);
  return (
    <mesh position={position} quaternion={quaternion} castShadow>
      <cylinderGeometry args={[radius, radius, length, 10]} />
      <meshStandardMaterial color={color} roughness={0.5} />
    </mesh>
  );
}

// Unlit screen surface
function Screen({ size, texture, ...props }) {
  return (
    <mesh {...props}>
      <planeGeometry args={size} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

/* ---------- screen textures (drawn on a canvas, no image files) ---------- */

function makeTexture(width, height, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d"), width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawMusicWindow(ctx, x, y, w, h) {
  ctx.fillStyle = "#121212";
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.fillStyle = "#e8622c";
  ctx.beginPath();
  ctx.arc(x + w * 0.68, y + h * 0.28, w * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#c0392b";
  ctx.beginPath();
  ctx.arc(x + w * 0.68, y + h * 0.28, w * 0.13, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i === 2 ? "#1ed760" : "#3a3a3a";
    ctx.fillRect(x + 16, y + h * 0.12 + i * h * 0.1, w * 0.34, h * 0.05);
  }
}

function useScreenTextures() {
  return useMemo(() => {
    // Curved ultrawide: wood wallpaper left, misty mountains right, two music windows
    const ultrawide = makeTexture(2048, 600, (ctx, w, h) => {
      for (let x = 0; x < w / 2; x += 18) {
        ctx.fillStyle = (x / 18) % 2 ? "#8d8a86" : "#7f7c78";
        ctx.fillRect(x, 0, 18, h);
      }
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#f4f4f2");
      sky.addColorStop(1, "#d8dbdc");
      ctx.fillStyle = sky;
      ctx.fillRect(w / 2, 0, w / 2, h);
      ctx.fillStyle = "#9aa1a6";
      ctx.beginPath();
      ctx.moveTo(w / 2, h * 0.75);
      [0.56, 0.62, 0.68, 0.73, 0.8, 0.88, 0.95, 1].forEach((px, i) => {
        ctx.lineTo(w * px, h * (i % 2 ? 0.62 : 0.38));
      });
      ctx.lineTo(w, h);
      ctx.lineTo(w / 2, h);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(w / 2, h * 0.6, w / 2, h * 0.2);
      drawMusicWindow(ctx, w * 0.06, h * 0.08, w * 0.17, h * 0.78);
      drawMusicWindow(ctx, w * 0.8, h * 0.12, w * 0.15, h * 0.72);
      ctx.fillStyle = "#202020";
      ctx.fillRect(0, h - 26, w, 26);
    });
    // the cylinder's u runs right-to-left when seen from the front
    ultrawide.wrapS = RepeatWrapping;
    ultrawide.repeat.x = -1;
    ultrawide.needsUpdate = true;

    // Upper monitor: DAW mixer
    const daw = makeTexture(640, 380, (ctx, w, h) => {
      ctx.fillStyle = "#1c2330";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#2b3546";
      ctx.fillRect(0, 0, w, 26);
      for (let i = 0; i < 14; i++) {
        const x = 24 + i * 42;
        ctx.fillStyle = "#2f3a4c";
        ctx.fillRect(x, 40, 34, 230);
        ctx.fillStyle = "#11161f";
        ctx.fillRect(x + 15, 60, 4, 190);
        const level = 0.35 + ((i * 37) % 50) / 100;
        ctx.fillStyle = i === 6 ? "#e74c3c" : "#2ecc71";
        ctx.fillRect(x + 24, 250 - 180 * level, 5, 180 * level);
        ctx.fillStyle = "#d7dce3";
        ctx.fillRect(x + 8, 120 + ((i * 53) % 90), 18, 10);
      }
      ctx.fillStyle = "#6b4630";
      ctx.fillRect(0, 285, w, h - 285);
      ctx.fillStyle = "#a8743f";
      ctx.fillRect(w * 0.35, 300, w * 0.3, 60);
    });

    // Vertical monitor: blue-sky wallpaper with a white AE86-style car
    const vertical = makeTexture(240, 432, (ctx, w, h) => {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#5aa9e6");
      sky.addColorStop(1, "#dff1ff");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#7d8b99";
      ctx.fillRect(w * 0.7, h * 0.15, 4, h * 0.55);
      ctx.fillStyle = "#26303c";
      ctx.fillRect(w * 0.36, h * 0.48, 22, 70);
      ctx.beginPath();
      ctx.arc(w * 0.36 + 11, h * 0.46, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f7f7f7";
      ctx.fillRect(w * 0.2, h * 0.66, w * 0.7, 34);
      ctx.fillRect(w * 0.35, h * 0.62, w * 0.35, 22);
      ctx.fillStyle = "#111";
      ctx.fillRect(w * 0.2, h * 0.66 + 26, w * 0.7, 8);
      ctx.beginPath();
      ctx.arc(w * 0.33, h * 0.66 + 36, 11, 0, Math.PI * 2);
      ctx.arc(w * 0.78, h * 0.66 + 36, 11, 0, Math.PI * 2);
      ctx.fill();
    });

    return { ultrawide, daw, vertical };
  }, []);
}

/* ---------- room shell ---------- */

function Curtain() {
  const geometry = useMemo(() => {
    const g = new PlaneGeometry(1.55, 2.25, 44, 1);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, 0.035 * Math.sin(pos.getX(i) * 22));
    }
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <mesh geometry={geometry} position={[-1.53, 1.18, -0.2]} rotation-y={Math.PI / 2} castShadow receiveShadow>
      <meshStandardMaterial color="#77716a" roughness={1} side={DoubleSide} />
    </mesh>
  );
}

function RoomShell() {
  return (
    <group>
      {/* floor */}
      <Box size={[3.3, 0.1, 2.7]} position={[-0.05, -0.05, -0.05]} color="#8f8a84" roughness={1} />
      {/* back wall */}
      <Box size={[3.3, 2.45, 0.08]} position={[-0.05, 1.225, -1.36]} color="#e6e4e1" roughness={0.95} />
      {/* window wall */}
      <Box size={[0.08, 2.45, 2.7]} position={[-1.66, 1.225, -0.05]} color="#dedbd7" roughness={0.95} />
      {/* skirting */}
      <Box size={[3.2, 0.06, 0.015]} position={[0, 0.03, -1.315]} color="#d2cfcb" />
      <Curtain />
    </group>
  );
}

/* ---------- furniture ---------- */

function Desk() {
  const t = 0.03;
  return (
    <group>
      {/* main desk along the back wall */}
      <Box size={[2.0, t, 0.7]} position={[0.4, DESK - t / 2, -0.95]} color={WHITE} roughness={0.5} />
      {/* L return on the left, where the PC lives */}
      <Box size={[0.65, t, 0.85]} position={[-0.925, DESK - t / 2, -0.575]} color={WHITE} roughness={0.5} />
      {[
        [1.36, -1.26],
        [1.36, -0.64],
        [-0.56, -1.26],
        [-1.21, -0.19],
        [-0.64, -0.19],
      ].map(([x, z], i) => (
        <Box key={i} size={[0.05, DESK - t, 0.05]} position={[x, (DESK - t) / 2, z]} color="#e9e9e9" />
      ))}
      {/* felt desk mat */}
      <Box size={[1.45, 0.004, 0.42]} position={[0.42, DESK + 0.002, -0.78]} color="#8e8c89" roughness={1} />
    </group>
  );
}

function Bookshelf() {
  const books = useMemo(() => {
    const colors = ["#2f4b7c", "#f0f0f0", "#c94c4c", "#3a3a3a", "#6a8caf", "#e0c36a", "#4d7a5c", "#1f3b6e"];
    const list = [];
    [0.62, 1.18].forEach((y, row) => {
      let x = -1.46;
      while (x < -0.82) {
        const w = 0.03 + ((list.length * 7) % 5) * 0.008;
        const h = 0.22 + ((list.length * 11) % 6) * 0.02;
        list.push({ x: x + w / 2, y: y + h / 2, w, h, color: colors[(list.length + row) % colors.length] });
        x += w + 0.004;
      }
    });
    return list;
  }, []);

  const shelfX = -1.12;
  const shelfZ = -1.15;
  return (
    <group>
      <Box size={[0.03, 1.75, 0.3]} position={[-1.5, 0.875, shelfZ]} />
      <Box size={[0.03, 1.75, 0.3]} position={[-0.74, 0.875, shelfZ]} />
      <Box size={[0.79, 1.75, 0.01]} position={[shelfX, 0.875, -1.297]} color="#e4e4e4" />
      {[0.02, 0.6, 1.16, 1.74].map((y) => (
        <Box key={y} size={[0.76, 0.025, 0.3]} position={[shelfX, y, shelfZ]} />
      ))}
      {books.map((b, i) => (
        <Box key={i} size={[b.w, b.h, 0.22]} position={[b.x, b.y, shelfZ + 0.02]} color={b.color} />
      ))}
      <LegoCrane position={[-1.12, 1.755, -1.15]} />
    </group>
  );
}

function LegoCrane(props) {
  const yellow = "#f2c200";
  return (
    <group {...props} rotation-y={0.15}>
      <Box size={[0.5, 0.06, 0.12]} position={[0, 0.07, 0]} color={yellow} />
      <Box size={[0.1, 0.07, 0.11]} position={[0.21, 0.135, 0]} color={yellow} />
      <Box size={[0.07, 0.04, 0.115]} position={[0.21, 0.14, 0]} color="#22313d" />
      {[-0.18, -0.08, 0.06, 0.18].map((x) =>
        [-0.065, 0.065].map((z) => (
          <Cyl key={`${x}${z}`} args={[0.035, 0.035, 0.025, 14]} position={[x, 0.035, z]} rotation-x={Math.PI / 2} color="#1c1c1c" />
        ))
      )}
      {/* boom */}
      <Box size={[0.42, 0.04, 0.05]} position={[-0.08, 0.17, 0]} rotation-z={0.22} color={yellow} />
      <Box size={[0.08, 0.06, 0.08]} position={[-0.08, 0.12, 0]} color="#2a2a2a" />
    </group>
  );
}

function Chair(props) {
  const fabric = "#a3a3a1";
  const legs = [0, 1, 2, 3, 4].map((i) => {
    const a = (i / 5) * Math.PI * 2;
    return [Math.cos(a) * 0.32, 0.06, Math.sin(a) * 0.32];
  });
  return (
    <group {...props}>
      {legs.map((end, i) => (
        <group key={i}>
          <Segment from={[0, 0.09, 0]} to={end} radius={0.02} />
          <mesh position={[end[0], 0.03, end[2]]} castShadow>
            <sphereGeometry args={[0.03, 12, 12]} />
            <meshStandardMaterial color={BLACK} />
          </mesh>
        </group>
      ))}
      <Cyl args={[0.028, 0.028, 0.34, 12]} position={[0, 0.26, 0]} color="#333" />
      {/* seat */}
      <Box size={[0.54, 0.11, 0.5]} position={[0, 0.48, 0]} color={fabric} roughness={1} />
      <Box size={[0.5, 0.012, 0.46]} position={[0, 0.54, 0]} color="#3a3a3a" roughness={1} />
      {/* armrests */}
      {[-0.31, 0.31].map((x) => (
        <group key={x}>
          <Box size={[0.04, 0.2, 0.06]} position={[x, 0.6, 0.02]} color={BLACK} />
          <Box size={[0.09, 0.035, 0.27]} position={[x, 0.71, -0.02]} color={BLACK} roughness={0.5} />
        </group>
      ))}
      {/* backrest, leaning back */}
      <group position={[0, 0.5, 0.24]} rotation-x={0.14}>
        <Box size={[0.52, 0.9, 0.13]} position={[0, 0.47, 0]} color={fabric} roughness={1} />
        {[-0.275, 0.275].map((x) => (
          <Box key={x} size={[0.04, 0.9, 0.14]} position={[x, 0.47, 0]} color="#2c2c2c" />
        ))}
        <Box size={[0.3, 0.12, 0.08]} position={[0, 0.78, -0.09]} color={BLACK} roughness={0.9} />
        <Box size={[0.32, 0.14, 0.06]} position={[0, 0.2, -0.08]} color="#2c2c2c" roughness={0.9} />
      </group>
    </group>
  );
}

/* ---------- desk gear ---------- */

function UltrawideMonitor({ texture }) {
  const R = 1.0;
  const width = 1.12;
  const theta = width / R;
  const cy = 1.17;
  return (
    <group position={[0.45, 0, 0]}>
      {/* stand */}
      <Box size={[0.36, 0.02, 0.2]} position={[0, DESK + 0.01, -1.2]} color="#2a2a2a" />
      <Box size={[0.08, 0.36, 0.04]} position={[0, DESK + 0.2, -1.22]} color="#2a2a2a" />
      <group position={[0, cy, R - 1.08]}>
        <mesh castShadow>
          <cylinderGeometry args={[R + 0.012, R + 0.012, 0.355, 48, 1, true, Math.PI - (theta + 0.04) / 2, theta + 0.04]} />
          <meshStandardMaterial color={BLACK} side={DoubleSide} roughness={0.4} />
        </mesh>
        <mesh>
          <cylinderGeometry args={[R, R, 0.33, 48, 1, true, Math.PI - theta / 2, theta]} />
          <meshBasicMaterial map={texture} side={DoubleSide} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function UpperMonitor({ texture }) {
  return (
    <group position={[0.45, 0, -1.23]}>
      <Cyl args={[0.018, 0.018, 0.85, 12]} position={[0, DESK + 0.425, -0.04]} color="#2a2a2a" />
      <group position={[0, 1.6, 0]} rotation-x={0.08}>
        <Box size={[0.64, 0.39, 0.03]} color={BLACK} roughness={0.4} />
        <Screen size={[0.61, 0.36]} texture={texture} position={[0, 0, 0.016]} />
        {/* monitor light bar */}
        <Box size={[0.5, 0.022, 0.03]} position={[0, 0.215, 0.01]} color="#111" />
        <Box size={[0.48, 0.004, 0.02]} position={[0, 0.203, 0.012]} color="#fff" emissive="#fff4e0" emissiveIntensity={2} />
      </group>
    </group>
  );
}

function VerticalMonitor({ texture }) {
  return (
    <group position={[-0.43, DESK, -1.08]} rotation-y={0.35}>
      <Box size={[0.18, 0.015, 0.14]} position={[0, 0.008, 0]} color="#2a2a2a" />
      <Box size={[0.04, 0.12, 0.03]} position={[0, 0.07, -0.02]} color="#2a2a2a" />
      <group position={[0, 0.32, 0]}>
        <Box size={[0.225, 0.39, 0.025]} color={BLACK} roughness={0.4} />
        <Screen size={[0.205, 0.37]} texture={texture} position={[0, 0, 0.013]} />
      </group>
    </group>
  );
}

function StudioMonitor({ position, rotation, standHeight }) {
  return (
    <group position={position} rotation-y={rotation}>
      {/* iso stand */}
      <Cyl args={[0.05, 0.07, standHeight, 4]} position={[0, standHeight / 2, 0]} color="#1e1e1e" />
      <group position={[0, standHeight + 0.135, 0]}>
        <Box size={[0.17, 0.27, 0.21]} color="#e9e9e7" roughness={0.6} />
        <Cyl args={[0.058, 0.058, 0.012, 28]} position={[0, -0.045, 0.106]} rotation-x={Math.PI / 2} color="#bdbdbb" />
        <Cyl args={[0.034, 0.034, 0.014, 24]} position={[0, -0.045, 0.108]} rotation-x={Math.PI / 2} color="#2b2b2b" />
        <Cyl args={[0.022, 0.022, 0.012, 20]} position={[0, 0.08, 0.106]} rotation-x={Math.PI / 2} color="#cfcfcd" />
      </group>
    </group>
  );
}

function MidiKeyboard() {
  const whiteCount = 36;
  const keyW = 0.85 / whiteCount;
  const keys = [];
  for (let i = 0; i < whiteCount; i++) {
    keys.push(
      <Box key={`w${i}`} size={[keyW * 0.92, 0.012, 0.11]} position={[-0.425 + keyW * (i + 0.5), 0.032, 0.035]} color="#fafafa" roughness={0.4} />
    );
    if ([0, 1, 3, 4, 5].includes(i % 7) && i < whiteCount - 1) {
      keys.push(
        <Box key={`b${i}`} size={[keyW * 0.55, 0.014, 0.065]} position={[-0.425 + keyW * (i + 1), 0.043, 0.012]} color="#151515" roughness={0.4} />
      );
    }
  }
  return (
    <group position={[0.45, DESK, -0.99]}>
      {/* riser shelf */}
      <Box size={[1.02, 0.02, 0.26]} position={[0, 0.115, 0]} />
      {[-0.49, 0.49].map((x) => (
        <Box key={x} size={[0.02, 0.105, 0.24]} position={[x, 0.0525, 0]} />
      ))}
      <group position={[0, 0.125, 0]}>
        <Box size={[0.95, 0.045, 0.21]} position={[0, 0.0225, 0]} color="#dcdcdc" roughness={0.5} />
        {keys}
      </group>
    </group>
  );
}

function DeskGear() {
  return (
    <group>
      {/* keyboard + wrist rest */}
      <Box size={[0.33, 0.025, 0.12]} position={[0.22, DESK + 0.017, -0.76]} color="#565656" />
      <Box size={[0.32, 0.008, 0.105]} position={[0.22, DESK + 0.033, -0.765]} color="#9a9a9a" />
      <Box size={[0.33, 0.018, 0.07]} position={[0.22, DESK + 0.013, -0.66]} color={BLACK} />
      {/* mouse pad + mouse */}
      <Box size={[0.42, 0.004, 0.32]} position={[0.74, DESK + 0.006, -0.74]} color="#141414" roughness={0.9} />
      <mesh position={[0.74, DESK + 0.025, -0.72]} scale={[0.035, 0.022, 0.06]} castShadow>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color={BLACK} roughness={0.4} />
      </mesh>
      {/* audio interface */}
      <group position={[-0.08, DESK, -0.86]} rotation-y={0.2}>
        <Box size={[0.17, 0.045, 0.11]} position={[0, 0.0225, 0]} color="#2a2a2a" roughness={0.4} />
        <Cyl args={[0.022, 0.022, 0.015, 20]} position={[0, 0.052, 0]} color="#111" />
        <Box size={[0.04, 0.004, 0.004]} position={[-0.055, 0.046, 0.056]} color="#3cf" emissive="#3cf" />
      </group>
      {/* tablet on a stand */}
      <group position={[1.27, DESK, -0.83]} rotation-y={-0.5}>
        <Box size={[0.08, 0.015, 0.08]} position={[0, 0.008, 0]} color="#2a2a2a" />
        <Box size={[0.2, 0.28, 0.01]} position={[0, 0.15, 0]} rotation-x={-0.2} color={BLACK} roughness={0.3} />
      </group>
      {/* Rode boom arm + mic */}
      <Box size={[0.05, 0.08, 0.06]} position={[1.38, DESK + 0.02, -0.7]} color={BLACK} />
      <Segment from={[1.38, DESK, -0.7]} to={[1.38, DESK + 0.2, -0.7]} radius={0.02} />
      <Segment from={[1.38, DESK + 0.2, -0.7]} to={[1.17, 1.62, -0.95]} radius={0.02} />
      <Segment from={[1.17, 1.62, -0.95]} to={[0.86, 1.44, -0.98]} radius={0.017} />
      <Segment from={[0.86, 1.44, -0.98]} to={[0.62, 1.42, -0.88]} radius={0.032} color="#222" />
      <Cyl args={[0.034, 0.034, 0.05, 16]} position={[0.6, 1.42, -0.87]} rotation-z={Math.PI / 2} rotation-y={0.4} color="#3a3a3a" />
      {/* thermos + small figurine box on top of the PC side */}
      <Cyl args={[0.035, 0.035, 0.2, 18]} position={[-0.7, DESK + 0.1, -0.3]} color="#2b2b2b" />
    </group>
  );
}

function GamingPC() {
  const fans = useRef([]);
  const tmp = useMemo(() => new Color(), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    fans.current.forEach((mat, i) => {
      if (!mat) return;
      tmp.setHSL((t * 0.06 + i * 0.08) % 1, 0.7, 0.62);
      mat.emissive.copy(tmp);
      mat.emissiveIntensity = 2.6 + Math.sin(t * 2 + i) * 0.8;
    });
  });

  const fanPositions = [
    // bottom row, blowing up
    { p: [-0.09, 0.03, 0.02], r: [-Math.PI / 2, 0, 0] },
    { p: [0.0, 0.03, 0.02], r: [-Math.PI / 2, 0, 0] },
    { p: [0.09, 0.03, 0.02], r: [-Math.PI / 2, 0, 0] },
    // side column (left inner wall)
    { p: [-0.13, 0.15, -0.1], r: [0, Math.PI / 2, 0] },
    { p: [-0.13, 0.26, -0.1], r: [0, Math.PI / 2, 0] },
    { p: [-0.13, 0.37, -0.1], r: [0, Math.PI / 2, 0] },
  ];

  return (
    <group position={[-0.95, DESK, -0.62]} rotation-y={0.55}>
      <group position={[0, 0.0, 0]}>
        {/* shell: floor, roof, back and left panels */}
        <Box size={[0.32, 0.02, 0.44]} position={[0, 0.01, 0]} color={BLACK} />
        <Box size={[0.32, 0.02, 0.44]} position={[0, 0.48, 0]} color={BLACK} />
        <Box size={[0.32, 0.47, 0.02]} position={[0, 0.245, -0.21]} color="#141414" />
        <Box size={[0.02, 0.47, 0.44]} position={[-0.15, 0.245, 0]} color="#141414" />
        {/* corner pillar where the two glass panels meet */}
        <Box size={[0.015, 0.47, 0.015]} position={[0.153, 0.245, 0.213]} color={BLACK} />
        {/* glass */}
        <mesh position={[0, 0.245, 0.215]}>
          <planeGeometry args={[0.3, 0.45]} />
          <meshStandardMaterial color="#b9c6d8" transparent opacity={0.12} roughness={0.05} side={DoubleSide} />
        </mesh>
        <mesh position={[0.155, 0.245, 0]} rotation-y={Math.PI / 2}>
          <planeGeometry args={[0.42, 0.45]} />
          <meshStandardMaterial color="#b9c6d8" transparent opacity={0.12} roughness={0.05} side={DoubleSide} />
        </mesh>
        {/* motherboard, GPU, RAM, AIO pump */}
        <Box size={[0.22, 0.3, 0.01]} position={[0.02, 0.29, -0.195]} color="#202020" />
        <Box size={[0.2, 0.04, 0.12]} position={[0.03, 0.16, -0.12]} color="#d9d9d9" />
        <Box size={[0.012, 0.09, 0.012]} position={[0.07, 0.36, -0.185]} color="#ff7ad9" emissive="#ff4fcf" emissiveIntensity={2.5} />
        <Box size={[0.012, 0.09, 0.012]} position={[0.09, 0.36, -0.185]} color="#ff7ad9" emissive="#ff4fcf" emissiveIntensity={2.5} />
        <mesh position={[-0.02, 0.34, -0.18]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.03, 0.007, 10, 28]} />
          <meshStandardMaterial color="#fff" emissive="#e6ffd9" emissiveIntensity={2} />
        </mesh>
        {/* white light strips along the top */}
        {[-0.06, 0.04].map((z) => (
          <Box key={z} size={[0.24, 0.006, 0.012]} position={[0, 0.462, z]} color="#fff" emissive="#ffffff" emissiveIntensity={2} />
        ))}
        {fanPositions.map((f, i) => (
          <group key={i} position={f.p} rotation={f.r}>
            <mesh>
              <torusGeometry args={[0.044, 0.01, 10, 32]} />
              <meshStandardMaterial ref={(m) => (fans.current[i] = m)} color="#ffffff" emissive="#a98bff" emissiveIntensity={1.6} />
            </mesh>
            <mesh>
              <circleGeometry args={[0.034, 24]} />
              <meshStandardMaterial color="#e8e8e8" side={DoubleSide} />
            </mesh>
          </group>
        ))}
        {/* little figurine display box on top */}
        <Box size={[0.26, 0.12, 0.2]} position={[0, 0.55, -0.05]} color="#202020" roughness={0.3} />
      </group>
      <pointLight position={[0, 0.25, 0.3]} color="#b68cff" intensity={1.2} distance={1.4} decay={2} />
    </group>
  );
}

function Nanoleaf({ palette, onCycle }) {
  const s = 0.21; // side length
  const h = (s * Math.sqrt(3)) / 2;
  const r = s / Math.sqrt(3);
  const rows = ["..XXXXXXX.XXX", ".XXXXXXXXXXXX", "XXXX.XXXXXXX.", "..XX....XX..."];

  const tiles = [];
  rows.forEach((row, j) => {
    [...row].forEach((c, i) => {
      if (c !== "X") return;
      const up = (i + j) % 2 === 0;
      tiles.push({
        key: `${i}-${j}`,
        x: (i * s) / 2,
        y: -j * h + (up ? h / 3 : (2 * h) / 3) - h,
        rot: up ? Math.PI / 2 : -Math.PI / 2,
      });
    });
  });

  const setCursor = (v) => (document.body.style.cursor = v);

  return (
    <group
      position={[-0.18, 2.12, -1.307]}
      onClick={(e) => {
        e.stopPropagation();
        onCycle();
      }}
      onPointerOver={() => setCursor("pointer")}
      onPointerOut={() => setCursor("auto")}
    >
      {tiles.map((t) => (
        <group key={t.key} position={[t.x, t.y, 0]} rotation-z={t.rot}>
          <mesh>
            <circleGeometry args={[r * 0.97, 3]} />
            <meshStandardMaterial color="#f4f4f4" />
          </mesh>
          <mesh position-z={0.006}>
            <circleGeometry args={[r * 0.84, 3]} />
            <meshStandardMaterial color={palette.color} emissive={palette.color} emissiveIntensity={0.75} />
          </mesh>
        </group>
      ))}
      {/* the little hexagon connector in the middle */}
      <mesh position={[s * 3, -h * 1.33, 0.01]}>
        <circleGeometry args={[0.035, 6]} />
        <meshStandardMaterial color="#2a2a2a" />
      </mesh>
      <pointLight position={[0.65, -0.3, 0.35]} color={palette.light} intensity={0.7} distance={2.2} decay={2} />
    </group>
  );
}

/* ---------- scene ---------- */

export default function WorkPlaceScene() {
  const textures = useScreenTextures();
  const [paletteIndex, setPaletteIndex] = useState(0);
  const { size } = useThree();

  // Pull the camera back on narrow / portrait screens so the whole room fits
  const cameraTarget = useMemo(() => {
    const aspect = size.width / size.height;
    const pullBack = Math.max(1, DESKTOP_ASPECT / aspect);
    return CAMERA_TARGET.clone().multiplyScalar(Math.min(pullBack, 2.4));
  }, [size.width, size.height]);

  useFrame((state) => {
    state.camera.position.lerp(cameraTarget, 0.05);
    state.camera.lookAt(0, -0.1, 0);
  });

  return (
    <>
      <Environment preset="city" />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[3, 6, 4]}
        intensity={1.3}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
      />

      <PresentationControls
        global
        rotation={[0.05, 0, 0]}
        polar={[-0.3, 0.2]}
        azimuth={[-0.7, 0.7]}
        config={{ mass: 2, tension: 300 }}
        snap={{ mass: 4, tension: 300 }}
      >
        <group position={[0.1, -1.3, 0]} rotation-y={-0.85} scale={0.95}>
          <RoomShell />
          <Desk />
          <Bookshelf />
          <UltrawideMonitor texture={textures.ultrawide} />
          <UpperMonitor texture={textures.daw} />
          <VerticalMonitor texture={textures.vertical} />
          <StudioMonitor position={[-0.22, DESK, -1.02]} rotation={0.3} standHeight={0.08} />
          <StudioMonitor position={[1.12, DESK, -1.0]} rotation={-0.3} standHeight={0.14} />
          <MidiKeyboard />
          <DeskGear />
          <GamingPC />
          <Nanoleaf
            palette={NANOLEAF_PALETTES[paletteIndex]}
            onCycle={() => setPaletteIndex((i) => (i + 1) % NANOLEAF_PALETTES.length)}
          />
          <Chair position={[0.05, 0, -0.12]} rotation-y={0.35} />
        </group>
      </PresentationControls>

      <Text
        font="./bangers-v20-latin-regular.woff"
        fontSize={0.42}
        position={[0, 1.75, -1]}
        rotation-y={-0.38}
        color="#000"
        letterSpacing={0.05}
      >
        My WorkPlace
      </Text>
      <Text
        font="./bangers-v20-latin-regular.woff"
        fontSize={0.1}
        position={[0, 1.42, -1]}
        rotation-y={-0.38}
        color="#000"
        letterSpacing={0.05}
      >
        Drag to look around · Click the light panels
      </Text>
    </>
  );
}

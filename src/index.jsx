import "./style.css";
import ReactDOM from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useRef, useState } from "react";
import Experience from "./Experience.jsx";
import RoomScene from "./room/BakedRoom.jsx";
import RoomOverlay from "./room/RoomOverlay.jsx";
import Shadow from "./Components/Shadow.jsx";
import { setRoomState, useRoomState } from "./room/roomStore.js";

const root = ReactDOM.createRoot(document.querySelector("#root"));

const FADE_MS = 650;

// The room is the home page. Clicking the MacBook in the room flies the camera
// into its screen, fades, and opens the MacBook scene; "Back to my room" returns.
function App() {
  const [mode, setMode] = useState("room"); // "room" | "macbook"
  const [fading, setFading] = useState(false);
  const [macZoomed, setMacZoomed] = useState(false);
  const busy = useRef(false);
  const { ready } = useRoomState();

  // Load the MacBook scene in the background once the room is up, so the jump is instant
  useEffect(() => {
    if (!ready) return;
    useGLTF.preload("/models/macbook/model.gltf");
    useGLTF.preload("/models/cybertruck/model.gltf");
  }, [ready]);

  const switchTo = (next) => {
    if (busy.current) return;
    busy.current = true;
    setFading(true);
    setTimeout(() => {
      setMode(next);
      setMacZoomed(false);
      document.documentElement.dataset.mode = next;
      // give the new scene a frame to mount before fading back in
      setTimeout(() => {
        setFading(false);
        busy.current = false;
      }, 120);
    }, FADE_MS);
  };

  useEffect(() => {
    document.documentElement.dataset.mode = "room";
  }, []);

  return (
    <>
      {mode === "room" && <RoomOverlay />}
      {mode === "macbook" && !macZoomed && (
        <button
          className="back-to-room"
          onClick={() => {
            setRoomState({ focus: null });
            switchTo("room");
          }}
        >
          ← Back to my room
        </button>
      )}
      <div className={`scene-fade ${fading ? "scene-fade--on" : ""}`} />
      <Canvas
        className="r3f"
        gl={{ alpha: true, antialias: true }}
        dpr={[1, 2]}
        camera={{ fov: 45, near: 0.1, far: 2000, position: [-3, 1.5, 4] }}
        shadows={mode === "macbook"}
      >
        <Suspense fallback={null}>
          {mode === "room" ? (
            <RoomScene onEnterMacbook={() => switchTo("macbook")} />
          ) : (
            <>
              {/* Experience's onToggleNav reports whether its chrome may show (false when zoomed into the screen) */}
              <Experience onToggleNav={(visible) => setMacZoomed(!visible)} />
              <Shadow opacity={0.7} position={[0, -1.4, 0]} scale={12} blur={3} far={6} />
            </>
          )}
        </Suspense>
      </Canvas>
    </>
  );
}

root.render(<App />);

import "./style.css";
import ReactDOM from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import Experience from "./Experience.jsx";
import { Suspense, useState } from "react";
import { LoadingScreen } from "./LoadingScreen.jsx";

const root = ReactDOM.createRoot(document.querySelector("#root"));

function App() {
  const [loading, setLoading] = useState(true);
  const [started, setStarted] = useState(false);

  const handleStart = () => {
    setStarted(true);
  };

  return (
    <>
      {!started && (
        <LoadingScreen
          started={started}
          onStarted={handleStart}
          loading={loading}
        />
      )}
      {started && (
        <Canvas
          className="r3f"
          camera={{
            fov: 45,
            near: 0.1,
            far: 2000,
            position: [-3, 1.5, 4],
          }}
        >
          <Suspense fallback={null}>
            <Experience setLoading={setLoading} />
          </Suspense>
        </Canvas>
      )}
    </>
  );
}

root.render(<App />);

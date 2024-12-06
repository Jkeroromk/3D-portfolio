import "./style.css";
import ReactDOM from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import Experience from "./Experience.jsx";
import WorkPlaceScene from "./Workplace.jsx";
import { Suspense, useState, useRef, useEffect } from "react";
import { LoadingScreen } from "./LoadingScreen.jsx";
import NavBar from "./Nav.jsx";
import { gsap } from "gsap";

const root = ReactDOM.createRoot(document.querySelector("#root"));

function App() {
  const [started, setStarted] = useState(false);
  const [view, setView] = useState("default"); // "default" -> "transition-out" -> "workplace"
  
  const handleStart = () => setStarted(true);

  const experienceRef = useRef();
  const workplaceRef = useRef();

  useEffect(() => {
    if (view === "transition-out" && experienceRef.current) {
      // Spin the Experience group
      gsap.to(experienceRef.current.rotation, {
        y: experienceRef.current.rotation.y + Math.PI * 4, // 2 full spins
        duration: 2,
        ease: "power2.inOut",
      });
      // Fade out by scaling down
      gsap.to(experienceRef.current.scale, {
        x: 0,
        y: 0,
        z: 0,
        duration: 2,
        ease: "power2.inOut",
        onComplete: () => setView("workplace"),
      });
    }

    if (view === "workplace") {
      requestAnimationFrame(() => {
        if (workplaceRef.current) {
          // Initial scale and rotation setup
          workplaceRef.current.scale.set(0, 0, 0);
          workplaceRef.current.rotation.set(0, 0, 0);
          
          // Spin and fade in the WorkplaceScene
          gsap.to(workplaceRef.current.rotation, {
            y: workplaceRef.current.rotation.y + Math.PI * 4, // 2 full spins
            duration: 2,
            ease: "power2.inOut",
          });
          gsap.to(workplaceRef.current.scale, {
            x: 1,
            y: 1,
            z: 1,
            duration: 2,
            ease: "power2.inOut",
            onComplete: () => setView("workplace-ready"),
          });
        }
      });
    }
  }, [view]);

  const handleViewChange = (newView) => {
    if (newView === "workplace") {
      setView("transition-out");
    } else {
      setView(newView);
    }
  };

  return (
    <>
      {!started && <LoadingScreen started={started} onStarted={handleStart} />}
      {started && <NavBar started={started} onSelectView={handleViewChange} />}
      <Canvas
        className="r3f"
        camera={{ fov: 45, near: 0.1, far: 2000, position: [-3, 1.5, 4] }}
      >
        <Suspense fallback={null}>
          {(view === "default" || view === "transition-out") && (
            <group ref={experienceRef}>
              <Experience started={started} />
            </group>
          )}
          {(view === "workplace" || view === "workplace-ready") && (
            <group ref={workplaceRef}>
              <WorkPlaceScene />
            </group>
          )}
        </Suspense>
      </Canvas>
    </>
  );
}

root.render(<App />);

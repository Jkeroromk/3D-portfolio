import "./style.css";
import ReactDOM from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import Experience from "./Experience.jsx";
import WorkPlaceScene from "./Workplace.jsx";
import { Suspense, useState, useRef } from "react";
import { LoadingScreen } from "./LoadingScreen.jsx";
import NavBar from "./Nav.jsx";
import { gsap } from "gsap";

const root = ReactDOM.createRoot(document.querySelector("#root"));

function App() {
  const [started, setStarted] = useState(false);
  const [view, setView] = useState("default");
  const [currentContent, setCurrentContent] = useState(<Experience />);
  const objectRef = useRef(); 

  const handleStart = () => setStarted(true);

  const handleViewChange = (newView) => {
    
    if (view === newView) {
      return;
    }

    if (view !== "transition") {
      setView("transition");

      
      gsap.to(objectRef.current.scale, {
        x: 0,
        y: 0,
        z: 0,
        duration: 1.5,
        ease: "power2.inOut",
      });
      gsap.to(objectRef.current.rotation, {
        y: objectRef.current.rotation.y + Math.PI * 2, 
        duration: 1.5,
        ease: "power2.inOut",
      });
      gsap.to(objectRef.current.material, {
        opacity: 0,
        duration: 1.5,
        ease: "power2.inOut",
        onComplete: () => {
          
          setCurrentContent(
            newView === "workplace" ? <WorkPlaceScene /> : <Experience />
          );

          gsap.fromTo(
            objectRef.current.scale,
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 1, z: 1, duration: 1.5, ease: "power2.inOut" }
          );
          gsap.fromTo(
            objectRef.current.rotation,
            { y: objectRef.current.rotation.y },
            { y: objectRef.current.rotation.y + Math.PI * 2, duration: 1.5, ease: "power2.inOut" }
          );
          gsap.to(objectRef.current.material, {
            opacity: 1,
            duration: 1.5,
            ease: "power2.inOut",
            onComplete: () => setView(newView),
          });
        },
      });
    }
  };

  return (
    <>
      {!started && <LoadingScreen started={started} onStarted={handleStart} />}
      {started && <NavBar started={started} onSelectView={handleViewChange} />}
      <Canvas
        className="r3f"
        style={{ opacity: 1 }}
        camera={{ fov: 45, near: 0.1, far: 2000, position: [-3, 1.5, 4] }}
      >
        <Suspense fallback={null}>
          <group ref={objectRef}>{currentContent}</group>
        </Suspense>
      </Canvas>
    </>
  );
}

root.render(<App />);

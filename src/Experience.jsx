import {
  Environment,
  Float,
  PresentationControls,
  Html,
  Text,
} from "@react-three/drei";
import { useGLTF } from "@react-three/drei";
import { useRef, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector3 } from "three";

// Safari detection utility function
function isSafari() {
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome/.test(ua);
}

export default function Experience({ started, onToggleNav }) {
  // Load 3D models
  const computer = useGLTF(
    "https://vazxmixjsiawhamofees.supabase.co/storage/v1/object/public/models/macbook/model.gltf"
  );
  const sportcar = useGLTF(
    "https://vazxmixjsiawhamofees.supabase.co/storage/v1/object/public/models/cybertruck/model.gltf"
  );

  // State management
  const [toggled, setToggled] = useState(false);
  const [deviceType, setDeviceType] = useState("desktop");
  const [opacity, setOpacity] = useState(0);
  const [isMounted, setIsMounted] = useState(false);
  const [isSafariUser, setIsSafariUser] = useState(false);

  // Refs
  const initialCameraPosition = useRef(new Vector3(-2, 3, 5));
  const targetPosition = useRef(initialCameraPosition.current.clone());
  const textRef = useRef();

  // Device-specific positions
  const cameraPositions = {
    mobile: new Vector3(-2.5, 2, 9.6),
    tablet: new Vector3(-3, 3, 6),
    desktop: new Vector3(-2, 3, 5),
  };

  const zoomPositions = {
    mobile: new Vector3(0.5, 1, 5),
    tablet: new Vector3(0.3, -0.35, 3),
    desktop: new Vector3(0.3, -0.2, 2.8),
  };

  // Mount effect with cleanup
  useEffect(() => {
    setIsMounted(true);
    setIsSafariUser(isSafari());

    const cleanup = () => {
      setIsMounted(false);
      setOpacity(0);
    };

    return cleanup;
  }, []);

  useEffect(() => {
    if (textRef.current) {
      textRef.current.position.set(0, 1.6, -1.8);
    }
  }, []);

  // Handle device type and resize
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width <= 768) {
        setDeviceType("mobile");
      } else if (width <= 1200) {
        setDeviceType("tablet");
      } else {
        setDeviceType("desktop");
      }
      initialCameraPosition.current = cameraPositions[deviceType];
      targetPosition.current = initialCameraPosition.current.clone();
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [deviceType]);

  // Fade in effect
  useEffect(() => {
    if (!isMounted) return;

    let objectAnimationFrame;

    const fadeInObject = () => {
      setOpacity((prev) => {
        if (prev < 1) {
          objectAnimationFrame = requestAnimationFrame(fadeInObject);
          return Math.min(prev + 0.008, 1);
        }
        return prev;
      });
    };

    const objectDelayTimer = setTimeout(() => {
      fadeInObject();
    }, 1300);

    return () => {
      cancelAnimationFrame(objectAnimationFrame);
      clearTimeout(objectDelayTimer);
    };
  }, [isMounted]);

  // HTML position based on device type and Safari check
  const getHtmlPosition = () => {
    if (isSafariUser) {
      return [-0.015, 0.7, -1.4];
    }

    return [
      deviceType === "mobile" ? -0.015 : deviceType === "tablet" ? -0.005 : 0,
      deviceType === "mobile" ? 0.38 : 0.35,
      -1.4,
    ];
  };

  // Camera animation
  useFrame((state) => {
    const currentPosition = state.camera.position;
    const zoomedPosition = zoomPositions[deviceType];
    const defaultPosition = initialCameraPosition.current;

    targetPosition.current.copy(toggled ? zoomedPosition : defaultPosition);
    currentPosition.lerp(targetPosition.current, 0.05);
    state.camera.lookAt(0, 0, 0);
  });

  // Handle zoom toggle
  const handleToggleZoom = () => {
    setToggled(!toggled);
    onToggleNav && onToggleNav(toggled); // Nav should be hidden when toggled is true (zoomed in)
  };

  return (
    <>
      <Environment preset="city" />
      <color args={["#c8c8c8"]} attach="background" />

      {/* Main Scene Content */}
      <PresentationControls
        global
        rotation={[0.13, 0.1, 0]}
        polar={[-0.4, 0.1]}
        azimuth={[-0.75, 0.75]}
        config={{ mass: 2, tension: 300 }}
        snap={{ mass: 4, tension: 300 }}
      >
        <Float rotationIntensity={0.2}>
          <group
            position={
              deviceType === "mobile"
                ? [-0.25, 0, 0]
                : deviceType === "tablet"
                ? [0, 0, 0]
                : [0, 0, 0]
            }
          >
            {/* Computer Model */}
            <primitive
              object={computer.scene}
              position-y={-1.2}
              onPointerDown={handleToggleZoom}
              castShadow
              style={{ opacity }}
            />

            {/* Car Model */}
            <primitive
              object={sportcar.scene}
              scale={0.3}
              position-y={-0.8}
              position-x={2}
              position-z={0}
              castShadow
              style={{ opacity }}
            />

            {/* Iframe Content */}
            <Html
              transform
              zIndexRange={[0, 0]}
              wrapperClass="htmlScreen"
              distanceFactor={1.17}
              position={getHtmlPosition()}
              rotation-x={-0.256}
              style={{ opacity }}
            >
              <iframe src="https://jkeroro.com" />
            </Html>

            {/* Text Elements */}
            <Text
              font="./bangers-v20-latin-regular.woff"
              fontSize={0.5}
              position={[2, 0.55, 0.3]}
              rotation-y={-1.25}
              color={"#000"}
              textAlign="center"
              letterSpacing={0.05}
              style={{ opacity }}
            >
              Zexin{"\r"}Zou
            </Text>

            <Text
              ref={textRef}
              font="./bangers-v20-latin-regular.woff"
              fontSize={0.1}
              letterSpacing={0.05}
              color={"#000"}
              textAlign="center"
            >
              Toggle the Keyboard to Zoom in and out
              {"\r"}
              Scroll the Computer to View More ⬇️
            </Text>
          </group>
        </Float>
      </PresentationControls>
    </>
  );
}

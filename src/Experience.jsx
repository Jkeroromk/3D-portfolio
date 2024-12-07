import {
  Environment,
  Float,
  PresentationControls,
  ContactShadows,
  Html,
  Text,
} from "@react-three/drei";
import { useGLTF } from "@react-three/drei";
import { useRef, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector3 } from "three";
import { gsap } from "gsap";

export default function Experience(started) {
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
  const [isInteracted, setIsInteracted] = useState(false);
  const [shadowOpacity, setShadowOpacity] = useState(0);

  // Refs
  const initialCameraPosition = useRef(new Vector3(-2, 3, 5));
  const targetPosition = useRef(initialCameraPosition.current.clone());
  const textRef = useRef();
  const cleanupRef = useRef(null);

  // Device-specific positions
  const cameraPositions = {
    mobile: new Vector3(-2.5, 2, 9.6),
    tablet: new Vector3(-3, 3, 6),
    desktop: new Vector3(-2, 3, 5)
  };

  const zoomPositions = {
    mobile: new Vector3(0.5, 1, 5),
    tablet: new Vector3(0.3, -0.35, 3),
    desktop: new Vector3(0.3, -0.4, 2.3)
  };

  // Mount effect with cleanup
  useEffect(() => {
    setIsMounted(true);
    
    if (cleanupRef.current) {
      cleanupRef.current();
    }

    const cleanup = () => {
      setIsMounted(false);
      setOpacity(0);
      setIsInteracted(false);
    };

    cleanupRef.current = cleanup;
    return cleanup;
  }, []);

  // Click handler for the entire scene
  useEffect(() => {
    const handleClick = () => {
      setIsInteracted(true);
    };

    window.addEventListener('click', handleClick);
    window.addEventListener('touchstart', handleClick);

    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('touchstart', handleClick);
    };
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

    let animationFrame;
    const fadeIn = () => {
      setOpacity((prev) => {
        if (prev < 1) {
          animationFrame = requestAnimationFrame(fadeIn);
          return Math.min(prev + 0.01, 1);
        }
        return prev;
      });
    };

    const timer = setTimeout(() => {
      fadeIn();
    }, 100);

    return () => {
      cancelAnimationFrame(animationFrame);
      clearTimeout(timer);
    };
  }, [isMounted]);

  // Text animation
  useEffect(() => {
    if (textRef.current) {
      textRef.current.position.set(0, 0, -1.8);
      gsap.to(textRef.current.position, {
        y: 1.5,
        duration: 1,
        ease: "power2.out",
      });
    }
  }, []);

  // Camera animation
  useFrame((state) => {
    const currentPosition = state.camera.position;
    const zoomedPosition = zoomPositions[deviceType];
    const defaultPosition = initialCameraPosition.current;
    
    targetPosition.current.copy(toggled ? zoomedPosition : defaultPosition);
    currentPosition.lerp(targetPosition.current, 0.05);
    state.camera.lookAt(0, 0, 0);
  });

  // HTML position based on device type
  const getHtmlPosition = () => [
    deviceType === "mobile" ? -0.015 : deviceType === "tablet" ? -0.005 : 0,
    deviceType === "mobile" ? 0.38 : 0.35,
    -1.4
  ];

  return (
    <>
      <Environment preset="city" />
      <color args={["#c8c8c8"]} attach="background" />

      {/* Static Shadows */}
      {isMounted && isInteracted && (
        <group position={[0, 0, 0]} rotation={[0, 0, 0]}>
          <ContactShadows
            position={[0, -1.4, 0]}
            opacity={0.4}
            scale={10}
            blur={2}
            far={4}
            resolution={256}
            color="#000000"
            frames={1}
            rotation={[Math.PI / 2, 0, 0]}
          />
        </group>
      )}

      {/* Main Scene Content */}
      <PresentationControls
        global
        rotation={[0.13, 0.1, 0]}
        polar={[-0.4, 0.2]}
        azimuth={[-1, 0.75]}
        config={{ mass: 2, tension: 300 }}
        snap={{ mass: 4, tension: 300 }}
      >
        <Float rotationIntensity={0.2}>
          {/* Computer Model */}
          <primitive
            object={computer.scene}
            position-y={-1.2}
            onPointerDown={() => {
              setToggled(!toggled);
              setIsInteracted(true);
            }}
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
            zIndexRange={started ? [0, 0] : [-100, -100]}
            wrapperClass="htmlScreen"
            distanceFactor={1.17}
            position={getHtmlPosition()}
            rotation-x={-0.256}
            style={{ opacity }}
          >
            <iframe src="https://jkeroromk.github.io/Advance-portfolio/" />
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
          >
            Toggle the Keyboard to Zoom in and out
          </Text>
        </Float>
      </PresentationControls>
    </>
  );
}

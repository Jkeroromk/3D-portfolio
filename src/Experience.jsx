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
  const computer = useGLTF(
    "https://vazxmixjsiawhamofees.supabase.co/storage/v1/object/public/models/macbook/model.gltf"
  );
  const sportcar = useGLTF(
    "https://vazxmixjsiawhamofees.supabase.co/storage/v1/object/public/models/cybertruck/model.gltf"
  );

  const [toggled, setToggled] = useState(false);
  const [deviceType, setDeviceType] = useState("desktop");
  const [opacity, setOpacity] = useState(0);
  const initialCameraPosition = useRef(new Vector3(-2, 3, 5));
  const targetPosition = useRef(initialCameraPosition.current.clone());
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const textRef = useRef();

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width <= 768) {
        setDeviceType("mobile");
        initialCameraPosition.current = new Vector3(-2.5, 2, 9.6);
      } else if (width <= 1200) {
        setDeviceType("tablet");
        initialCameraPosition.current = new Vector3(-3, 3, 6);
      } else {
        setDeviceType("desktop");
        initialCameraPosition.current = new Vector3(-2, 3, 5);
      }
      targetPosition.current = initialCameraPosition.current.clone();
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
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
    fadeIn();
    return () => cancelAnimationFrame(animationFrame);
  }, []);

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

  useFrame((state) => {
    const currentPosition = state.camera.position;
    const zoomPositions = {
      mobile: new Vector3(0.5, 1, 4.7),
      tablet: new Vector3(0.3, -0.35, 2),
      desktop: new Vector3(0.3, -0.4, 1.6),
    };
    const zoomedPosition = zoomPositions[deviceType];
    const defaultPosition = initialCameraPosition.current;
    const shouldZoom = toggled;
    targetPosition.current.copy(shouldZoom ? zoomedPosition : defaultPosition);
    currentPosition.lerp(targetPosition.current, 0.05);
    state.camera.lookAt(0, 0, 0);
  });

  const handleInteraction = () => {
    setToggled(!toggled);
  };

  return (
    <>
      <Environment preset="city" />
      <color args={["#c8c8c8"]} attach="background" />
      <PresentationControls
        global
        rotation={[0.13, 0.1, 0]}
        polar={[-0.4, 0.2]}
        azimuth={[-1, 0.75]}
        config={{ mass: 2, tension: 300 }}
        snap={{ mass: 4, tension: 300 }}
      >
        <Float rotationIntensity={0.2}>
          <primitive
            object={computer.scene}
            position-y={-1.2}
            onPointerDown={handleInteraction}
            style={{ opacity }}
          />
          <primitive
            object={sportcar.scene}
            scale={0.3}
            position-y={-0.8}
            position-x={2}
            position-z={0}
            style={{ opacity }}
          />
          <Html
            transform
            zIndexRange={started ? [0, 0] : [-100, -100]}
            wrapperClass="htmlScreen"
            distanceFactor={1.17}
            position={[
              deviceType === "mobile"
                ? isSafari
                  ? -0.01
                  : -0.015
                : deviceType === "tablet"
                ? isSafari
                  ? -0.01
                  : -0.005
                : 0,
              deviceType === "mobile"
                ? isSafari
                  ? 0.525
                  : 0.38
                : deviceType === "tablet"
                ? 0.35
                : 0.35,
              -1.4,
            ]}
            rotation-x={-0.256}
            style={{ opacity }}
          >
            <iframe src="https://jkeroromk.github.io/Advance-portfolio/" />
          </Html>
          <rectAreaLight
            width={2.5}
            height={1.65}
            intensity={65}
            color={"#000"}
            rotation={[-0.1, Math.PI, 0]}
            position={[0.5, 0.55, -1.15]}
          />
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
            Zexin{`\r`}Zou
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
      <ContactShadows
        position-y={-1.4}
        opacity={opacity * 0.4}
        scale={5}
        blur={2.4}
      />
    </>
  );
}

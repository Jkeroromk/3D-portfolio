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

export default function WorkPlaceScene(){
    return (
      <PresentationControls>
      <mesh>
        <boxGeometry args={[1,1,1]} />
        <meshStandardMaterial color="orange" transparent={true} opacity={1}  />
        <Text
         font="./bangers-v20-latin-regular.woff"
         fontSize={0.5}
         position={[0, 1.55, 0.3]}
         color={"#000"}
         textAlign="center"
         letterSpacing={0.05}
         >
          To be Working on 
        </Text>
      </mesh>
      </PresentationControls>
    );
  }
  

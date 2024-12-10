import React from "react";
import { Html } from "@react-three/drei";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowCircleUp } from "@fortawesome/free-solid-svg-icons";
import './style.css'

const AnimatedIcon = ({ position = [0, 0, 0], size = "3x", color = "#ff4500" }) => {
  return (
    <Html transform position={position} zIndexRange={[-1, 1]}>
      <FontAwesomeIcon
        icon={faArrowCircleUp}
        size={size}
        className="animatedIcon"
        style={{ color }}
      />
    </Html>
  );
};

export default AnimatedIcon;

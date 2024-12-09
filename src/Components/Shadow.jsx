import React, { forwardRef } from "react";
import { ContactShadows } from "@react-three/drei";

const Shadow = forwardRef(({ opacity, position, scale, blur, far }, ref) => {
  return (
    <ContactShadows
      ref={ref}
      opacity={0.6}
      scale={10}
      blur={2}
      position={position}
      far={5}
    />
  );
});

export default Shadow;

import { Environment, Float, PresentationControls, ContactShadows, Html, Text } from '@react-three/drei'
import { useGLTF } from '@react-three/drei'
import { useRef, useState, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'

export default function Experience() {
    const computer = useGLTF('https://vazxmixjsiawhamofees.supabase.co/storage/v1/object/public/models/macbook/model.gltf')
    const sportcar = useGLTF('https://vazxmixjsiawhamofees.supabase.co/storage/v1/object/public/models/cybertruck/model.gltf')

    const [hovered, setHovered] = useState(false)
    const initialCameraPosition = useRef(new Vector3(-2, 3, 5)) 
    const targetPosition = useRef(initialCameraPosition.current.clone()) 

    
    useEffect(() => {
        initialCameraPosition.current = targetPosition.current.clone()
    }, [])

    useFrame((state) => {
        const currentPosition = state.camera.position
        const zoomedPosition = new Vector3(0, 0, 3) 

        
        targetPosition.current.copy(hovered ? zoomedPosition : initialCameraPosition.current)

       
        currentPosition.lerp(targetPosition.current, 0.01) 

        
        state.camera.lookAt(0, 0, 0)
    })

    return (
        <>
            <Environment preset="city" />
            <color args={['#c8c8c8']} attach="background" />

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
                        onPointerOver={() => setHovered(true)}
                        onPointerOut={() => setHovered(false)}
                    />
                    <primitive
                        object={sportcar.scene}
                        scale={0.3}
                        position-y={-0.8}
                        position-x={2}
                        position-z={0}
                    />
                    <Html
                        transform
                        wrapperClass="htmlScreen"
                        distanceFactor={1.17}
                        position={[0, 0.35, -1.4]}
                        rotation-x={-0.256}
                    >
                        <iframe src="https://jkeroromk.github.io/Advance-portfolio/"></iframe>
                    </Html>
                    <rectAreaLight
                        width={2.5}
                        height={1.65}
                        intensity={65}
                        color={'#000'}
                        rotation={[-0.1, Math.PI, 0]}
                        position={[0.5, 0.55, -1.15]}
                    />
                    <Text
                        font="./bangers-v20-latin-regular.woff"
                        fontSize={0.5}
                        position={[2, 0.55, 0.3]}
                        rotation-y={-1.25}
                        color={'#000'}
                        children={'Zexin\rZou'}
                        textAlign="center"
                        letterSpacing={0.05}
                    ></Text>
                </Float>
            </PresentationControls>
            <ContactShadows position-y={-1.4} opacity={0.4} scale={5} blur={2.4} />
        </>
    )
}

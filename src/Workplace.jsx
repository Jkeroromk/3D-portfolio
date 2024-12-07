export default function WorkPlaceScene(){
    return (
      <mesh>
        <boxGeometry args={[1,1,1]} />
        <meshStandardMaterial color="orange" transparent={true} opacity={1}  />
      </mesh>
    );
  }
  
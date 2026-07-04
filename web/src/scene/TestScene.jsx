import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

function useGradientTexture() {
  return useMemo(() => {
    const width = 256
    const data = new Uint8Array(width * 4)
    for (let i = 0; i < width; i++) {
      const v = Math.floor((i / (width - 1)) * 255)
      data[i * 4 + 0] = v
      data[i * 4 + 1] = v
      data[i * 4 + 2] = v
      data[i * 4 + 3] = 255
    }
    const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat)
    tex.needsUpdate = true
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }, [])
}

export default function TestScene({ band }) {
  const knotRef = useRef()
  const pendulumRef = useRef()
  const bulbRef = useRef()
  const gradientTex = useGradientTexture()

  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    if (knotRef.current) {
      knotRef.current.rotation.x = t * 0.15
      knotRef.current.rotation.y = t * 0.2
    }
    if (pendulumRef.current) {
      const swing = Math.sin(t * 0.6) * 1.1
      pendulumRef.current.position.x = swing
      pendulumRef.current.position.y = 1.6 - Math.abs(swing) * 0.15
    }
  })

  const isUv = band === 'uv'
  const isIr = band === 'ir'
  const isVisible = band === 'visible'

  const roughnessSteps = [0, 0.25, 0.5, 0.75, 1]

  return (
    <>
      <OrbitControls makeDefault enableDamping />

      {/* lighting */}
      <ambientLight intensity={isIr ? 0.05 : 0.25} color={isIr ? '#000000' : '#404050'} />
      <directionalLight
        position={[5, 8, 3]}
        intensity={isIr ? 0.1 : 1.4}
        color={isIr ? '#220000' : '#ffddaa'}
        castShadow
      />
      <pointLight
        ref={bulbRef}
        position={[-2, 1.8, -1.5]}
        intensity={isIr ? 4 : 0.8}
        distance={8}
        color={isIr ? '#ff5500' : '#ffe0b0'}
      />
      {/* visible bulb mesh, glows hot in IR */}
      <mesh position={[-2, 1.8, -1.5]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial
          color={isIr ? '#ff2200' : '#ffffff'}
          emissive={isIr ? '#ff5500' : '#332200'}
          emissiveIntensity={isIr ? 6 : 0.5}
        />
      </mesh>

      {/* room: floor + walls */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[14, 14]} />
        <meshStandardMaterial
          color={isIr ? '#050505' : '#b8b8b8'}
          roughness={0.9}
          emissive={isIr ? '#0a0000' : '#000000'}
        />
      </mesh>
      <mesh position={[0, 3.5, -5]} receiveShadow>
        <planeGeometry args={[14, 7]} />
        <meshStandardMaterial color={isIr ? '#020202' : '#c4c4c4'} roughness={0.95} />
      </mesh>
      <mesh position={[-6, 3.5, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[14, 7]} />
        <meshStandardMaterial color={isIr ? '#020202' : '#cccccc'} roughness={0.95} />
      </mesh>
      <mesh position={[6, 3.5, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[14, 7]} />
        <meshStandardMaterial color={isIr ? '#020202' : '#b0b0b0'} roughness={0.95} />
      </mesh>

      {/* hidden UV markings — invisible under visible band, glow under UV */}
      <mesh position={[0, 2.2, -4.95]} rotation={[0, 0, 0]}>
        <ringGeometry args={[0.5, 0.7, 32]} />
        <meshStandardMaterial
          color={isVisible ? '#c4c4c4' : '#7000ff'}
          emissive={isUv ? '#aa33ff' : '#000000'}
          emissiveIntensity={isUv ? 3 : 0}
          transparent
          opacity={isUv ? 1 : 0}
        />
      </mesh>
      <mesh position={[2.5, 0.01, -2]} rotation={[-Math.PI / 2, 0, 0.4]}>
        <planeGeometry args={[1.2, 0.3]} />
        <meshStandardMaterial
          color={isVisible ? '#b8b8b8' : '#7000ff'}
          emissive={isUv ? '#bb55ff' : '#000000'}
          emissiveIntensity={isUv ? 2.5 : 0}
          transparent
          opacity={isUv ? 1 : 0}
        />
      </mesh>
      <mesh position={[-3, 1.4, -5.9]}>
        <torusGeometry args={[0.4, 0.06, 8, 24]} />
        <meshStandardMaterial
          color={isVisible ? '#c4c4c4' : '#7000ff'}
          emissive={isUv ? '#cc66ff' : '#000000'}
          emissiveIntensity={isUv ? 3 : 0}
          transparent
          opacity={isUv ? 1 : 0}
        />
      </mesh>

      {/* torus knot centrepiece, slowly rotating */}
      <mesh ref={knotRef} position={[0, 1.4, 0]} castShadow receiveShadow>
        <torusKnotGeometry args={[0.7, 0.22, 128, 32]} />
        <meshStandardMaterial
          color={isIr ? '#111111' : '#909090'}
          roughness={0.5}
          metalness={0.1}
        />
      </mesh>

      {/* roughness sweep spheres */}
      {roughnessSteps.map((r, i) => (
        <mesh key={i} position={[-4 + i * 1.2, 0.4, 2.5]} castShadow>
          <sphereGeometry args={[0.35, 32, 32]} />
          <meshStandardMaterial
            color={isIr ? '#151515' : '#a0a0a0'}
            roughness={r}
            metalness={0.2}
          />
        </mesh>
      ))}

      {/* hard silhouettes: tall box + cone */}
      <mesh position={[3.5, 1.2, 1]} castShadow>
        <boxGeometry args={[0.8, 2.4, 0.8]} />
        <meshStandardMaterial color={isIr ? '#0d0d0d' : '#8a8a8a'} roughness={0.7} />
      </mesh>
      <mesh position={[3.5, 0.6, -1.2]} castShadow>
        <coneGeometry args={[0.6, 1.2, 32]} />
        <meshStandardMaterial color={isIr ? '#0d0d0d' : '#7a7a7a'} roughness={0.7} />
      </mesh>

      {/* gradient strip: DataTexture luminance ramp — dither acid test */}
      <mesh position={[-2.5, 1, 3.8]} rotation={[0, Math.PI / 8, 0]}>
        <planeGeometry args={[3, 1]} />
        <meshBasicMaterial map={gradientTex} toneMapped={false} />
      </mesh>

      {/* moving pendulum sphere — hot in IR */}
      <group position={[0, 0, -1]}>
        <mesh ref={pendulumRef} position={[0, 1.6, 0]} castShadow>
          <sphereGeometry args={[0.25, 24, 24]} />
          <meshStandardMaterial
            color={isIr ? '#ff3300' : '#c0c0c0'}
            emissive={isIr ? '#ff4400' : '#000000'}
            emissiveIntensity={isIr ? 5 : 0}
            roughness={0.4}
          />
        </mesh>
      </group>
    </>
  )
}

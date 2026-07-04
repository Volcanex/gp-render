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

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

function useHueTexture() {
  return useMemo(() => {
    const width = 256
    const data = new Uint8Array(width * 4)
    for (let i = 0; i < width; i++) {
      const hue = (i / (width - 1)) * 360
      const [r, g, b] = hslToRgb(hue, 1, 0.55)
      data[i * 4 + 0] = Math.floor(r * 255)
      data[i * 4 + 1] = Math.floor(g * 255)
      data[i * 4 + 2] = Math.floor(b * 255)
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

// roughly Macbeth-chart-like: saturated primaries/secondaries, skin tones, greys
const CHECKER_COLORS = [
  '#c4402c', '#e8a13a', '#d9c23a', '#5a9e4a', '#2f7d6e', '#3a6fb5',
  '#7a4fa8', '#c74f9e', '#e0917a', '#c9a06a', '#8a6a4a', '#5a4a3a',
  '#ffffff', '#c8c8c8', '#8f8f8f', '#585858', '#282828', '#000000',
  '#ff3b30', '#34c759', '#007aff', '#ffcc00', '#af52de', '#00c7be',
]

export default function TestScene({ band }) {
  const knotRef = useRef()
  const pendulumRef = useRef()
  const bulbRef = useRef()
  const gradientTex = useGradientTexture()
  const hueTex = useHueTexture()

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
  const sphereHues = ['#e0342a', '#e89a1c', '#4caf50', '#1e88e5', '#8e24aa']

  return (
    <>
      <OrbitControls makeDefault enableDamping />

      {/* lighting */}
      <ambientLight intensity={isIr ? 0.05 : 0.15} color={isIr ? '#000000' : '#202030'} />
      <directionalLight
        position={[5, 8, 3]}
        intensity={isIr ? 0.1 : 2.2}
        color={isIr ? '#220000' : '#ffddaa'}
        castShadow
      />
      <pointLight
        ref={bulbRef}
        position={[-2, 1.8, -1.5]}
        intensity={isIr ? 4 : 0.9}
        distance={8}
        color={isIr ? '#ff5500' : '#ff9040'}
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
          color={isIr ? '#111111' : '#008a7a'}
          roughness={0.5}
          metalness={0.1}
        />
      </mesh>

      {/* roughness sweep spheres — 5 hues, roughness 0→1 */}
      {roughnessSteps.map((r, i) => (
        <mesh key={i} position={[-4 + i * 1.2, 0.4, 2.5]} castShadow>
          <sphereGeometry args={[0.35, 32, 32]} />
          <meshStandardMaterial
            color={isIr ? '#151515' : sphereHues[i]}
            roughness={r}
            metalness={0.2}
          />
        </mesh>
      ))}

      {/* hard silhouettes: tall box + cone */}
      <mesh position={[3.5, 1.2, 1]} castShadow>
        <boxGeometry args={[0.8, 2.4, 0.8]} />
        <meshStandardMaterial color={isIr ? '#0d0d0d' : '#d9622e'} roughness={0.7} />
      </mesh>
      <mesh position={[3.5, 0.6, -1.2]} castShadow>
        <coneGeometry args={[0.6, 1.2, 32]} />
        <meshStandardMaterial color={isIr ? '#0d0d0d' : '#7a2ec9'} roughness={0.7} />
      </mesh>

      {/* gradient strip: DataTexture luminance ramp — dither acid test */}
      <mesh position={[-2.5, 1, 3.8]} rotation={[0, Math.PI / 8, 0]}>
        <planeGeometry args={[3, 1]} />
        <meshBasicMaterial map={gradientTex} toneMapped={false} color={isIr ? '#151515' : '#ffffff'} />
      </mesh>

      {/* hue strip: full-saturation hue circle sweep — colour dither/quantisation acid test */}
      <mesh position={[-2.5, 2.1, 3.8]} rotation={[0, Math.PI / 8, 0]}>
        <planeGeometry args={[3, 0.6]} />
        <meshBasicMaterial map={hueTex} toneMapped={false} color={isIr ? '#151515' : '#ffffff'} />
      </mesh>

      {/* colour checker: 6x4 Macbeth-like grid mounted on the left wall */}
      <group position={[-5.9, 2, -1.2]} rotation={[0, Math.PI / 2, 0]}>
        {CHECKER_COLORS.map((c, i) => {
          const col = i % 6
          const row = Math.floor(i / 6)
          return (
            <mesh key={c + i} position={[col * 0.42 - 1.05, -row * 0.42 + 0.63, 0]}>
              <planeGeometry args={[0.38, 0.38]} />
              <meshStandardMaterial color={isIr ? '#0a0a0a' : c} roughness={0.4} />
            </mesh>
          )
        })}
      </group>

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

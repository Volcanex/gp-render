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

const NEAR_BLACK = '#020202'

export default function TestScene({ bands }) {
  const {
    visible = true, uv = false, ir = false,
    uvColor = '#aa33ff', irColor = '#ff5500',
  } = bands || {}

  const knotRef = useRef()
  const pendulumRef = useRef()
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

  const roughnessSteps = [0, 0.25, 0.5, 0.75, 1]
  const sphereHues = ['#e0342a', '#e89a1c', '#4caf50', '#1e88e5', '#8e24aa']

  // visible-band albedo: normal colour when the sensor sees visible light,
  // near-black when it doesn't (the only light left is whatever's emissive)
  const vis = (hex) => (visible ? hex : NEAR_BLACK)

  // heat glow shared by every IR-emitting object: brighter = hotter
  const heat = (intensity) => ({
    emissive: ir ? irColor : '#000000',
    emissiveIntensity: ir ? intensity : 0,
  })

  // hidden marking: invisible (blended into its background) unless uv is on,
  // in which case it glows in uvColor regardless of the other bands
  const marking = (bgHex) => ({
    color: uv ? uvColor : bgHex,
    emissive: uv ? uvColor : '#000000',
    emissiveIntensity: uv ? 3 : 0,
    transparent: true,
    opacity: uv ? 1 : 0,
  })

  return (
    <>
      <OrbitControls makeDefault enableDamping />

      {/* lighting — only the visible band illuminates the scene */}
      <ambientLight intensity={visible ? 0.15 : 0} color="#202030" />
      <directionalLight
        position={[5, 8, 3]}
        intensity={visible ? 2.2 : 0}
        color="#ffddaa"
        castShadow
      />
      <pointLight position={[-2, 1.8, -1.5]} intensity={visible ? 0.9 : 0} distance={8} color="#ff9040" />

      {/* bulb mesh: lit normally in visible, hottest IR source */}
      <mesh position={[-2, 1.8, -1.5]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color={vis('#ffffff')} {...heat(6)} />
      </mesh>

      {/* room: floor + walls — cold, never glow in IR */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[14, 14]} />
        <meshStandardMaterial color={vis('#b8b8b8')} roughness={0.9} />
      </mesh>
      <mesh position={[0, 3.5, -5]} receiveShadow>
        <planeGeometry args={[14, 7]} />
        <meshStandardMaterial color={vis('#c4c4c4')} roughness={0.95} />
      </mesh>
      <mesh position={[-6, 3.5, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[14, 7]} />
        <meshStandardMaterial color={vis('#cccccc')} roughness={0.95} />
      </mesh>
      <mesh position={[6, 3.5, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[14, 7]} />
        <meshStandardMaterial color={vis('#b0b0b0')} roughness={0.95} />
      </mesh>

      {/* hidden UV markings — glow in uvColor whenever uv is on */}
      <mesh position={[0, 2.2, -4.95]} rotation={[0, 0, 0]}>
        <ringGeometry args={[0.5, 0.7, 32]} />
        <meshStandardMaterial {...marking(vis('#c4c4c4'))} />
      </mesh>
      <mesh position={[2.5, 0.01, -2]} rotation={[-Math.PI / 2, 0, 0.4]}>
        <planeGeometry args={[1.2, 0.3]} />
        <meshStandardMaterial {...marking(vis('#b8b8b8'))} />
      </mesh>
      <mesh position={[-3, 1.4, -5.9]}>
        <torusGeometry args={[0.4, 0.06, 8, 24]} />
        <meshStandardMaterial {...marking(vis('#c4c4c4'))} />
      </mesh>

      {/* torus knot centrepiece, slowly rotating — mild IR warmth */}
      <mesh ref={knotRef} position={[0, 1.4, 0]} castShadow receiveShadow>
        <torusKnotGeometry args={[0.7, 0.22, 128, 32]} />
        <meshStandardMaterial color={vis('#008a7a')} roughness={0.5} metalness={0.1} {...heat(1.2)} />
      </mesh>

      {/* roughness sweep spheres — 5 hues, roughness 0→1, cold in IR */}
      {roughnessSteps.map((r, i) => (
        <mesh key={i} position={[-4 + i * 1.2, 0.4, 2.5]} castShadow>
          <sphereGeometry args={[0.35, 32, 32]} />
          <meshStandardMaterial color={vis(sphereHues[i])} roughness={r} metalness={0.2} />
        </mesh>
      ))}

      {/* hard silhouettes: tall box + cone, cold in IR */}
      <mesh position={[3.5, 1.2, 1]} castShadow>
        <boxGeometry args={[0.8, 2.4, 0.8]} />
        <meshStandardMaterial color={vis('#d9622e')} roughness={0.7} />
      </mesh>
      <mesh position={[3.5, 0.6, -1.2]} castShadow>
        <coneGeometry args={[0.6, 1.2, 32]} />
        <meshStandardMaterial color={vis('#7a2ec9')} roughness={0.7} />
      </mesh>

      {/* gradient strip: DataTexture luminance ramp — dither acid test */}
      <mesh position={[-2.5, 1, 3.8]} rotation={[0, Math.PI / 8, 0]}>
        <planeGeometry args={[3, 1]} />
        <meshBasicMaterial map={gradientTex} toneMapped={false} color={vis('#ffffff')} />
      </mesh>

      {/* hue strip: full-saturation hue circle sweep — colour dither/quantisation acid test */}
      <mesh position={[-2.5, 2.1, 3.8]} rotation={[0, Math.PI / 8, 0]}>
        <planeGeometry args={[3, 0.6]} />
        <meshBasicMaterial map={hueTex} toneMapped={false} color={vis('#ffffff')} />
      </mesh>

      {/* colour checker: 6x4 Macbeth-like grid mounted on the left wall */}
      <group position={[-5.9, 2, -1.2]} rotation={[0, Math.PI / 2, 0]}>
        {CHECKER_COLORS.map((c, i) => {
          const col = i % 6
          const row = Math.floor(i / 6)
          return (
            <mesh key={c + i} position={[col * 0.42 - 1.05, -row * 0.42 + 0.63, 0]}>
              <planeGeometry args={[0.38, 0.38]} />
              <meshStandardMaterial color={vis(c)} roughness={0.4} />
            </mesh>
          )
        })}
      </group>

      {/* moving pendulum sphere — hot IR source */}
      <group position={[0, 0, -1]}>
        <mesh ref={pendulumRef} position={[0, 1.6, 0]} castShadow>
          <sphereGeometry args={[0.25, 24, 24]} />
          <meshStandardMaterial color={vis('#c0c0c0')} roughness={0.4} {...heat(5)} />
        </mesh>
      </group>
    </>
  )
}

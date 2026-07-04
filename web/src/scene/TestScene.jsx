import { useMemo, useRef, useLayoutEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { makeTexture } from './textures.js'

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

function useSurfaceTextures() {
  return useMemo(() => {
    const floor = makeTexture('grid', { seed: 1, size: 256, colorA: '#9a9a9a', colorB: '#707070' })
    floor.repeat.set(23, 23)

    const wallBrick = makeTexture('brick', { seed: 2, size: 256, colorA: '#8a5642', colorB: '#5c3a2c' })
    wallBrick.repeat.set(4, 2)

    const wallPlates = makeTexture('plates', { seed: 3, size: 256, colorA: '#b0b0b0', colorB: '#888888' })
    wallPlates.repeat.set(4, 2)

    const boxRust = makeTexture('rust', { seed: 4, size: 256, colorA: '#8a4a22', colorB: '#4a2410' })
    boxRust.repeat.set(2, 2)

    const coneWood = makeTexture('wood', { seed: 5, size: 256, colorA: '#8a5a2a', colorB: '#5a3a18' })
    coneWood.repeat.set(1, 2)

    const knotMarble = makeTexture('marble', { seed: 6, size: 256, colorA: '#e8e8e0', colorB: '#b0b0a8' })
    knotMarble.repeat.set(2, 1)

    const sphereNoise = makeTexture('noise', { seed: 7, size: 256, colorA: '#cfcfcf', colorB: '#8f8f8f' })
    sphereNoise.repeat.set(2, 1)

    return { floor, wallBrick, wallPlates, boxRust, coneWood, knotMarble, sphereNoise }
  }, [])
}

// deterministic PRNG so the litter field is identical every load
function mulberry32(seed) {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// keep the calibration corner (checker, strips, spheres, knot, box, cone, nook walls) clear
function inCalibrationZone(x, z) {
  return x > -8 && x < 6 && z > -8 && z < 6
}

// crates: clustered + scattered boxes across the field, split by texture so
// each group can still be a single instanced draw call
function makeCrateField(seed, count, radius) {
  const rand = mulberry32(seed)
  const clusterCount = 5
  const clusters = Array.from({ length: clusterCount }, () => {
    const a = rand() * Math.PI * 2
    const r = radius * (0.3 + rand() * 0.7)
    return [Math.cos(a) * r, Math.sin(a) * r]
  })
  const items = []
  let tries = 0
  while (items.length < count && tries < count * 40) {
    tries++
    let x, z
    if (rand() < 0.65) {
      const c = clusters[Math.floor(rand() * clusterCount)]
      x = c[0] + (rand() - 0.5) * 9
      z = c[1] + (rand() - 0.5) * 9
    } else {
      const a = rand() * Math.PI * 2
      const r = radius * (0.2 + rand() * 0.8)
      x = Math.cos(a) * r
      z = Math.sin(a) * r
    }
    if (inCalibrationZone(x, z)) continue
    const sx = 0.6 + rand() * 1.6
    const sy = 0.6 + rand() * 1.8
    const sz = 0.6 + rand() * 1.6
    const rotY = rand() * Math.PI * 2
    const texGroup = Math.floor(rand() * 3)
    items.push({ position: [x, sy / 2, z], rotation: [0, rotY, 0], scale: [sx, sy, sz], texGroup })
  }
  return items
}

// pillars/columns, some knocked over
function makePillarField(seed, count, radius) {
  const rand = mulberry32(seed)
  const items = []
  let tries = 0
  while (items.length < count && tries < count * 40) {
    tries++
    const a = rand() * Math.PI * 2
    const r = radius * (0.25 + rand() * 0.75)
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (inCalibrationZone(x, z)) continue
    const height = 2 + rand() * 4
    const rotY = rand() * Math.PI * 2
    const toppled = rand() < 0.25
    items.push(
      toppled
        ? { position: [x, 0.5, z], rotation: [0, rotY, Math.PI / 2], scale: [1, height, 1] }
        : { position: [x, height / 2, z], rotation: [0, rotY, 0], scale: [1, height, 1] },
    )
  }
  return items
}

// dotted UV trail from the calibration corner out to a far landmark
function makeTrailMarkers(start, end, count, seed) {
  const rand = mulberry32(seed)
  const items = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    const wiggle = Math.sin(t * Math.PI * 2.4) * 2.5
    const x = start[0] + (end[0] - start[0]) * t + wiggle + (rand() - 0.5) * 0.6
    const z = start[1] + (end[1] - start[1]) * t - wiggle * 0.4 + (rand() - 0.5) * 0.6
    items.push({ position: [x, 0.03, z], rotation: [-Math.PI / 2, 0, 0], scale: [1, 1, 1] })
  }
  return items
}

// generic static instanced field: builds instance matrices once from `transforms`
function InstancedField({ transforms, geometry, material }) {
  const ref = useRef()
  useLayoutEffect(() => {
    if (!ref.current) return
    const dummy = new THREE.Object3D()
    transforms.forEach((t, i) => {
      dummy.position.set(...t.position)
      dummy.rotation.set(...t.rotation)
      dummy.scale.set(...t.scale)
      dummy.updateMatrix()
      ref.current.setMatrixAt(i, dummy.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
  }, [transforms])
  if (transforms.length === 0) return null
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, transforms.length]} castShadow receiveShadow>
      {geometry}
      {material}
    </instancedMesh>
  )
}

const TOWER_POS = [24, 0, -16]
const SPHERE_PLINTH_POS = [-24, 0, 18]
const ARCHWAY_POS = [0, 0, -30]
const PIPE_RUN_Z = 8
const TRAIL_START = [-2, 3.6]
const CREATURE_CENTERS = [
  [12, 0.3, 10],
  [-16, 0.3, -10],
  [6, 0.3, -20],
]
const VENT_POSITIONS = [
  [10, 0.3, -8],
  [-14, 0.3, 12],
  [16, 0.3, 14],
]
const GRAFFITI_SPOTS = [
  { position: [10, 1.2, -6], rotY: 0.3 },
  { position: [-13, 1.6, 9], rotY: -0.5 },
  { position: [18, 1.0, -13], rotY: 1.1 },
  { position: [-8, 1.3, -14], rotY: -1.4 },
]

const SUN_NIGHT = new THREE.Color('#3a2a55')
const SUN_LOW = new THREE.Color('#ff7a30')
const SUN_NOON = new THREE.Color('#fff4e0')

// hemisphere fill: sky above / ground bounce below, both keyed off dusk as the
// pivot between "day" (elevation >= 0) and "night" (elevation < 0)
const SKY_NOON = new THREE.Color('#bcd6ff')
const SKY_DUSK = new THREE.Color('#ffcfa0')
const SKY_NIGHT = new THREE.Color('#0e1330')
const GROUND_DAY = new THREE.Color('#4a463c')
const GROUND_DUSK = new THREE.Color('#3a2c24')
const GROUND_NIGHT = new THREE.Color('#05060d')

export default function TestScene({ bands, textures = true, timeOfDay = 14 }) {
  const {
    visible = true, uv = false, ir = false,
    uvColor = '#aa33ff', irColor = '#ff5500',
  } = bands || {}

  // sun elevation -1 (below horizon) .. 1 (zenith), azimuth sweeps east→west over the day
  const sunElevation = Math.sin(((timeOfDay - 6) / 12) * Math.PI)
  const sunAzimuth = (timeOfDay / 24) * Math.PI * 2 - Math.PI / 2
  const sunR = 25
  const sunPos = [
    Math.cos(sunAzimuth) * sunR,
    Math.max(1, sunElevation * sunR + 6),
    Math.sin(sunAzimuth) * sunR,
  ]
  const dayFactor = Math.max(0, Math.min(1, sunElevation)) // 0 at/below horizon, 1 at noon
  const nightDepth = Math.max(0, Math.min(1, -sunElevation)) // 0 at/above horizon, 1 at midnight
  const sunColor = (dayFactor < 0.5 ? SUN_NIGHT.clone().lerp(SUN_LOW, dayFactor * 2) : SUN_LOW.clone().lerp(SUN_NOON, (dayFactor - 0.5) * 2))
  // hemisphere fill pivots at dusk (elevation 0): warm ~0.2 there, brightens to
  // ~0.45 sky-blue at noon, dims to ~0.08 blue at midnight — never pitch black
  const ambientIntensity = sunElevation >= 0 ? 0.2 + dayFactor * 0.25 : 0.2 - nightDepth * 0.12
  const skyColor = sunElevation >= 0 ? SKY_DUSK.clone().lerp(SKY_NOON, dayFactor) : SKY_DUSK.clone().lerp(SKY_NIGHT, nightDepth)
  const groundColor = sunElevation >= 0 ? GROUND_DUSK.clone().lerp(GROUND_DAY, dayFactor) : GROUND_DUSK.clone().lerp(GROUND_NIGHT, nightDepth)
  const nightBoost = 1 + (1 - dayFactor) * 0.6

  const knotRef = useRef()
  const pendulumRef = useRef()
  const creatureRefs = useRef([])
  const gradientTex = useGradientTexture()
  const hueTex = useHueTexture()
  const maps = useSurfaceTextures()

  const crates = useMemo(() => makeCrateField(101, 40, 35), [])
  const crateGroups = useMemo(
    () => [0, 1, 2].map((g) => crates.filter((c) => c.texGroup === g)),
    [crates],
  )
  const pillars = useMemo(() => makePillarField(202, 15, 35), [])
  const trailMarkers = useMemo(
    () => makeTrailMarkers(TRAIL_START, [TOWER_POS[0], TOWER_POS[2]], 14, 303),
    [],
  )
  const towerBoxes = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => ({
        position: [TOWER_POS[0] + (i % 2) * 0.15, 0.7 + i * 1.4, TOWER_POS[2] + (i % 2) * -0.1],
        rotation: [0, i * 0.2, 0],
        scale: [1.4, 1.4, 1.4],
      })),
    [],
  )
  const pipeSegments = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => ({
        position: [-28 + i * 8, 0.3, PIPE_RUN_Z + (i % 2 === 0 ? 0.4 : -0.4)],
        rotation: [0, 0, Math.PI / 2],
        scale: [1, 8, 1],
      })),
    [],
  )

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
    creatureRefs.current.forEach((el, i) => {
      if (!el) return
      const [cx, cy, cz] = CREATURE_CENTERS[i]
      el.position.set(cx + Math.sin(t * 0.25 + i * 2) * 3, cy, cz + Math.cos(t * 0.2 + i * 2) * 3)
    })
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

  // buried: invisible unless ir is on, then glows faintly in irColor — for
  // things that are only "seen" as heat, not as physical geometry
  const buried = (bgHex, intensity) => ({
    color: ir ? irColor : bgHex,
    emissive: ir ? irColor : '#000000',
    emissiveIntensity: ir ? intensity : 0,
    transparent: true,
    opacity: ir ? 1 : 0,
  })

  return (
    <>
      {/* lighting — only the visible band illuminates the scene; sun swings
          across the sky with timeOfDay, hemisphere fill keeps shadow sides
          readable outdoors, point lights carry the night */}
      <hemisphereLight color={skyColor} groundColor={groundColor} intensity={visible ? ambientIntensity : 0} />
      <directionalLight
        position={sunPos}
        intensity={visible ? dayFactor * 2.4 : 0}
        color={sunColor}
        castShadow
      />
      <pointLight position={[-2, 1.8, -1.5]} intensity={visible ? 0.9 * nightBoost : 0} distance={8} color="#ff9040" />
      {/* far-out fill so the edges of the litter field aren't pitch black */}
      <pointLight position={[22, 6, -18]} intensity={visible ? 0.5 * nightBoost : 0} distance={40} color="#88aacc" />

      {/* bulb mesh: lit normally in visible, hottest IR source */}
      <mesh position={[-2, 1.8, -1.5]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color={vis('#ffffff')} {...heat(6)} />
      </mesh>

      {/* floor — the whole 80x80 field */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial
          color={textures ? vis('#ffffff') : vis('#b8b8b8')}
          map={textures ? maps.floor : null}
          roughness={0.9}
        />
      </mesh>

      {/* calibration nook — same room as before, now one fragment among ruins */}
      <mesh position={[0, 3.5, -5]} receiveShadow>
        <planeGeometry args={[14, 7]} />
        <meshStandardMaterial
          color={textures ? vis('#ffffff') : vis('#c4c4c4')}
          map={textures ? maps.wallBrick : null}
          roughness={0.95}
        />
      </mesh>
      <mesh position={[-6, 3.5, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[14, 7]} />
        <meshStandardMaterial
          color={textures ? vis('#ffffff') : vis('#cccccc')}
          map={textures ? maps.wallPlates : null}
          roughness={0.95}
        />
      </mesh>
      {/* dither reference wall — always plain, never textured */}
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
        <meshStandardMaterial
          color={vis('#008a7a')}
          map={textures ? maps.knotMarble : null}
          roughness={0.5}
          metalness={0.1}
          {...heat(1.2)}
        />
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
        <meshStandardMaterial
          color={textures ? vis('#ffffff') : vis('#d9622e')}
          map={textures ? maps.boxRust : null}
          roughness={0.7}
        />
      </mesh>
      <mesh position={[3.5, 0.6, -1.2]} castShadow>
        <coneGeometry args={[0.6, 1.2, 32]} />
        <meshStandardMaterial
          color={textures ? vis('#ffffff') : vis('#7a2ec9')}
          map={textures ? maps.coneWood : null}
          roughness={0.7}
        />
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

      {/* ============ litter field ============ */}

      {/* crates: ~40 boxes split by texture into 3 instanced draw calls */}
      <InstancedField
        transforms={crateGroups[0]}
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={
          <meshStandardMaterial
            color={textures ? vis('#ffffff') : vis('#8a4a22')}
            map={textures ? maps.boxRust : null}
            roughness={0.85}
          />
        }
      />
      <InstancedField
        transforms={crateGroups[1]}
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={
          <meshStandardMaterial
            color={textures ? vis('#ffffff') : vis('#8a5a2a')}
            map={textures ? maps.coneWood : null}
            roughness={0.85}
          />
        }
      />
      <InstancedField
        transforms={crateGroups[2]}
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={
          <meshStandardMaterial
            color={textures ? vis('#ffffff') : vis('#b0b0b0')}
            map={textures ? maps.wallPlates : null}
            roughness={0.85}
          />
        }
      />

      {/* pillars/columns, some toppled */}
      <InstancedField
        transforms={pillars}
        geometry={<cylinderGeometry args={[0.5, 0.5, 1, 8]} />}
        material={
          <meshStandardMaterial
            color={textures ? vis('#ffffff') : vis('#a8a8a0')}
            map={textures ? maps.wallPlates : null}
            roughness={0.9}
          />
        }
      />

      {/* landmark: tower of stacked boxes */}
      <InstancedField
        transforms={towerBoxes}
        geometry={<boxGeometry args={[1, 1, 1]} />}
        material={
          <meshStandardMaterial
            color={textures ? vis('#ffffff') : vis('#8a4a22')}
            map={textures ? maps.boxRust : null}
            roughness={0.8}
          />
        }
      />

      {/* landmark: large sphere on a plinth */}
      <mesh position={[SPHERE_PLINTH_POS[0], 0.6, SPHERE_PLINTH_POS[2]]} castShadow receiveShadow>
        <cylinderGeometry args={[1.2, 1.4, 1.2, 24]} />
        <meshStandardMaterial
          color={textures ? vis('#ffffff') : vis('#b0b0b0')}
          map={textures ? maps.wallPlates : null}
          roughness={0.9}
        />
      </mesh>
      <mesh position={[SPHERE_PLINTH_POS[0], 2.5, SPHERE_PLINTH_POS[2]]} castShadow receiveShadow>
        <sphereGeometry args={[1.3, 32, 32]} />
        <meshStandardMaterial
          color={textures ? vis('#ffffff') : vis('#909090')}
          map={textures ? maps.sphereNoise : null}
          roughness={0.6}
        />
      </mesh>

      {/* landmark: archway */}
      <mesh position={[ARCHWAY_POS[0] - 2.2, 2.5, ARCHWAY_POS[2]]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 5, 0.9]} />
        <meshStandardMaterial
          color={textures ? vis('#ffffff') : vis('#8a5642')}
          map={textures ? maps.wallBrick : null}
          roughness={0.9}
        />
      </mesh>
      <mesh position={[ARCHWAY_POS[0] + 2.2, 2.5, ARCHWAY_POS[2]]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 5, 0.9]} />
        <meshStandardMaterial
          color={textures ? vis('#ffffff') : vis('#8a5642')}
          map={textures ? maps.wallBrick : null}
          roughness={0.9}
        />
      </mesh>
      <mesh position={[ARCHWAY_POS[0], 5.3, ARCHWAY_POS[2]]} castShadow receiveShadow>
        <boxGeometry args={[5.8, 0.9, 0.9]} />
        <meshStandardMaterial
          color={textures ? vis('#ffffff') : vis('#8a5642')}
          map={textures ? maps.wallBrick : null}
          roughness={0.9}
        />
      </mesh>

      {/* landmark: pipe run crossing the ground */}
      <InstancedField
        transforms={pipeSegments}
        geometry={<cylinderGeometry args={[0.3, 0.3, 1, 12]} />}
        material={
          <meshStandardMaterial
            color={textures ? vis('#ffffff') : vis('#8a4a22')}
            map={textures ? maps.boxRust : null}
            roughness={0.6}
            metalness={0.3}
          />
        }
      />

      {/* ============ more IR: warm machines, buried pipe, hot creatures ============ */}

      {VENT_POSITIONS.map((p, i) => (
        <mesh key={i} position={p} castShadow>
          <boxGeometry args={[0.6, 0.6, 0.6]} />
          <meshStandardMaterial color={vis('#3a3a3a')} roughness={0.6} {...heat(4)} />
        </mesh>
      ))}

      {/* buried warm pipe line — invisible until ir reveals its heat trace */}
      <mesh position={[0, 0.02, PIPE_RUN_Z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[56, 1]} />
        <meshStandardMaterial {...buried(vis('#101010'), 1.8)} />
      </mesh>

      {CREATURE_CENTERS.map((c, i) => (
        <mesh key={i} ref={(el) => (creatureRefs.current[i] = el)} position={c} castShadow>
          <sphereGeometry args={[0.22, 16, 16]} />
          <meshStandardMaterial color={vis('#331100')} roughness={0.5} {...heat(4.5)} />
        </mesh>
      ))}

      {/* ============ more UV: graffiti, dotted trail, ground symbol ============ */}

      {GRAFFITI_SPOTS.map((g, i) => (
        <mesh key={i} position={g.position} rotation={[0, g.rotY, 0]}>
          <planeGeometry args={[0.7, 0.7]} />
          <meshStandardMaterial {...marking(vis('#8a8a8a'))} />
        </mesh>
      ))}

      <InstancedField
        transforms={trailMarkers}
        geometry={<circleGeometry args={[0.15, 16]} />}
        material={<meshStandardMaterial {...marking(vis('#8a8a8a'))} />}
      />

      <mesh position={[16, 0.02, 20]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.2, 1.6, 48]} />
        <meshStandardMaterial {...marking(vis('#707070'))} />
      </mesh>
    </>
  )
}

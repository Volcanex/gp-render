import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MeshReflectorMaterial } from '@react-three/drei'
import * as THREE from 'three'
import { makeTexture } from './textures.js'

// ============ seeded value noise (module-level, no PRNG object threading) ============

function hash2(x, y, seed) {
  const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453
  return h - Math.floor(h)
}

function hash3(x, y, z, seed) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.9 + seed * 269.5) * 43758.5453
  return h - Math.floor(h)
}

function smooth(t) {
  return t * t * (3 - 2 * t)
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function valueNoise2D(x, y, seed) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const sx = smooth(x - x0)
  const sy = smooth(y - y0)
  const n00 = hash2(x0, y0, seed)
  const n10 = hash2(x0 + 1, y0, seed)
  const n01 = hash2(x0, y0 + 1, seed)
  const n11 = hash2(x0 + 1, y0 + 1, seed)
  const nx0 = n00 + (n10 - n00) * sx
  const nx1 = n01 + (n11 - n01) * sx
  return nx0 + (nx1 - nx0) * sy
}

function fbm2(x, y, seed, octaves = 3) {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let total = 0
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise2D(x * freq, y * freq, seed + o * 17) * amp
    total += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / total
}

function valueNoise3D(x, y, z, seed) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const z0 = Math.floor(z)
  const sx = smooth(x - x0)
  const sy = smooth(y - y0)
  const sz = smooth(z - z0)
  const c000 = hash3(x0, y0, z0, seed)
  const c100 = hash3(x0 + 1, y0, z0, seed)
  const c010 = hash3(x0, y0 + 1, z0, seed)
  const c110 = hash3(x0 + 1, y0 + 1, z0, seed)
  const c001 = hash3(x0, y0, z0 + 1, seed)
  const c101 = hash3(x0 + 1, y0, z0 + 1, seed)
  const c011 = hash3(x0, y0 + 1, z0 + 1, seed)
  const c111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed)
  const c00 = c000 + (c100 - c000) * sx
  const c10 = c010 + (c110 - c010) * sx
  const c01 = c001 + (c101 - c001) * sx
  const c11 = c011 + (c111 - c011) * sx
  const c0 = c00 + (c10 - c00) * sy
  const c1 = c01 + (c11 - c01) * sy
  return c0 + (c1 - c0) * sz
}

function fbm3(x, y, z, seed, octaves = 3) {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let total = 0
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise3D(x * freq, y * freq, z * freq, seed + o * 13) * amp
    total += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / total
}

// ============ terrain + lake shape (module-level, pure — shared by displacement, rock scatter and pole path) ============

const LAKE_CENTER = [-15, 0]
const LAKE_RADIUS = 25
const LAKE_Y = -2
const TERRAIN_SEED = 7
const TERRAIN_AMPLITUDE = 2.5

// 0 outside the lake, 1 in its flat core, smooth falloff across the shoreline band
function lakeFactor(x, z) {
  const dx = x - LAKE_CENTER[0]
  const dz = z - LAKE_CENTER[1]
  const dist = Math.sqrt(dx * dx + dz * dz)
  const t = clamp01((LAKE_RADIUS - dist) / (LAKE_RADIUS * 0.4))
  return smooth(t)
}

// camera spawns here (walk mode, eye height 1.7) looking toward the lake — keep it flat
// so the first frame isn't a rock face, with a smooth falloff back into the noise
const SPAWN_CENTER = [4, 5]
const SPAWN_RADIUS = 8

function plateauFactor(x, z) {
  const dx = x - SPAWN_CENTER[0]
  const dz = z - SPAWN_CENTER[1]
  const dist = Math.sqrt(dx * dx + dz * dz)
  const t = clamp01((SPAWN_RADIUS - dist) / (SPAWN_RADIUS * 0.6))
  return smooth(t)
}

function terrainHeight(x, z) {
  const n = fbm2(x * 0.05, z * 0.05, TERRAIN_SEED, 3)
  const h = (n - 0.5) * 2 * TERRAIN_AMPLITUDE
  const lf = lakeFactor(x, z)
  const base = h * (1 - lf) + LAKE_Y * lf
  const pf = plateauFactor(x, z)
  return base * (1 - pf)
}

// ============ pole path — single source, also exported for the volumetric fog pass ============

const POLE_COUNT = 9
const POLE_SPACING = 9
const LIGHT_COLORS = ['#cfe8ff']

function buildPolePlan() {
  const items = []
  for (let i = 0; i < POLE_COUNT; i++) {
    const dist = i * POLE_SPACING
    const curve = Math.sin(i * 0.5) * 4
    const x = 6 + dist * 0.28 + curve
    const z = -14 + dist * 0.85
    const y = terrainHeight(x, z)
    items.push({
      base: [x, y, z],
      lampPosition: [x, y + 5, z],
      color: LIGHT_COLORS[i % LIGHT_COLORS.length],
    })
  }
  return items
}

const POLES = buildPolePlan()

export const RENDER_LAMPS = POLES.map((p) => ({ position: p.lampPosition, color: p.color }))

// ============ rock field ============

function mulberry32(seed) {
  let a = seed >>> 0
  return function rand() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildRockField(seed, count) {
  const rand = mulberry32(seed)
  const items = []
  let tries = 0
  while (items.length < count && tries < count * 60) {
    tries++
    const a = rand() * Math.PI * 2
    const r = 6 + rand() * 50
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    const lf = lakeFactor(x, z)
    if (lf > 0.85) continue // too deep in the lake
    if (plateauFactor(x, z) > 0.05) continue // keep the spawn sightline clear
    const shoreline = lf > 0.3 && lf <= 0.85
    const scale = 0.5 + rand() * 3.5
    const groundY = terrainHeight(x, z)
    const y = shoreline ? groundY - scale * (0.15 + rand() * 0.3) : groundY + scale * 0.12
    items.push({
      position: [x, y, z],
      rotation: [rand() * Math.PI, rand() * Math.PI, rand() * Math.PI],
      scale,
      variant: Math.floor(rand() * 4),
      hueJitter: rand(),
      warm: false,
    })
  }
  // mark a fixed handful as geothermal-warm so the count stays stable across runs
  ;[2, 9, 16].forEach((i) => {
    if (items[i]) items[i].warm = true
  })
  return items
}

function buildRockGeometry(seed) {
  const geo = new THREE.IcosahedronGeometry(1, 2)
  const pos = geo.attributes.position
  const v = new THREE.Vector3()
  const dir = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    dir.copy(v).normalize()
    const n = fbm3(dir.x * 2.2, dir.y * 2.2, dir.z * 2.2, seed, 3)
    const displace = (n - 0.5) * 2 * 0.35
    v.multiplyScalar(1 + displace)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  return geo
}

function buildTerrainGeometry() {
  const geo = new THREE.PlaneGeometry(120, 120, 128, 128)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    pos.setY(i, terrainHeight(x, z))
  }
  geo.computeVertexNormals()
  return geo
}

function jitterColor(hex, amount, t) {
  const c = new THREE.Color(hex)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  c.setHSL(hsl.h, hsl.s, clamp01(hsl.l + (t - 0.5) * amount))
  return c
}

// generic instanced field for the identical pole shafts (one draw call for all nine)
function InstancedPoles({ transforms, geometry, material }) {
  const ref = useRef()
  useEffect(() => {
    if (!ref.current) return
    const dummy = new THREE.Object3D()
    transforms.forEach((t, i) => {
      dummy.position.set(...t.position)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      ref.current.setMatrixAt(i, dummy.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
  }, [transforms])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, transforms.length]} castShadow={false} receiveShadow>
      {geometry}
      {material}
    </instancedMesh>
  )
}

const NEAR_BLACK = '#020202'
const FOG_NIGHT = new THREE.Color('#0a0502')
const FOG_DAY = new THREE.Color('#3a2210')

export default function RenderScene({ bands, timeOfDay = 14, torch = false }) {
  // walkable ground: CameraRig samples this so walk mode follows the terrain
  useEffect(() => {
    window.__groundFn = terrainHeight
    return () => { if (window.__groundFn === terrainHeight) window.__groundFn = null }
  }, [])
  const {
    visible = true, uv = false, ir = false,
    uvColor = '#aa33ff', irColor = '#ff5500',
    uvGain = 1, irGain = 1,
  } = bands || {}

  const { scene, camera } = useThree()

  const sunElevation = Math.sin(((timeOfDay - 6) / 12) * Math.PI)
  const dayMix = clamp01((sunElevation + 1) / 2)
  const dayFactor = Math.max(0, Math.min(1, sunElevation))

  // Render barely sees its sun through the haze — weak directional light, but the haze
  // scatters it everywhere, so shadow faces still get a warm orange fill, never true black
  const sunIntensity = visible ? 0.15 + dayFactor * 0.35 : 0
  // night floors drop hard — the pole lights and torch should be the only meaningful
  // light after dark, while daytime peaks stay where they were (0.57 hemi, 0.16 ambient)
  const hemiIntensity = visible ? 0.03 + dayFactor * 0.54 : 0
  const ambientIntensity = visible ? 0.02 + dayFactor * 0.14 : 0

  useEffect(() => {
    const prevFog = scene.fog
    const prevBackground = scene.background
    const hazeColor = FOG_NIGHT.clone().lerp(FOG_DAY, dayMix)
    scene.fog = new THREE.FogExp2(hazeColor, 0.005)
    scene.background = hazeColor.clone()
    return () => {
      scene.fog = prevFog
      scene.background = prevBackground
    }
  }, [scene, dayMix])

  const rockTex = useMemo(() => {
    const tex = makeTexture('rock', { seed: 11, colorA: '#8a4222', colorB: '#3d1d0d', scale: 1 })
    tex.repeat.set(8, 8)
    return tex
  }, [])
  const chalkTex = useMemo(() => {
    const tex = makeTexture('chalk', { seed: 21, colorA: '#e8e2d6', colorB: '#b8b0a0', scale: 1 })
    tex.repeat.set(1, 3)
    return tex
  }, [])

  const terrainGeometry = useMemo(() => buildTerrainGeometry(), [])
  useEffect(() => () => terrainGeometry.dispose(), [terrainGeometry])

  const rockGeometries = useMemo(() => [0, 1, 2, 3].map((v) => buildRockGeometry(500 + v * 31)), [])
  useEffect(() => () => rockGeometries.forEach((g) => g.dispose()), [rockGeometries])

  const rocks = useMemo(() => buildRockField(303, 25), [])
  const bigRock = useMemo(() => rocks.reduce((a, b) => (b.scale > a.scale ? b : a), rocks[0]), [rocks])

  const torchRef = useRef()
  const torchTargetRef = useRef()
  const torchDir = useMemo(() => new THREE.Vector3(), [])
  const buoyRef = useRef()

  useEffect(() => {
    if (torchRef.current && torchTargetRef.current) torchRef.current.target = torchTargetRef.current
  }, [])

  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    if (buoyRef.current) {
      buoyRef.current.position.set(
        LAKE_CENTER[0] + Math.sin(t * 0.15) * 8,
        -0.42 + Math.sin(t * 0.6) * 0.05,
        LAKE_CENTER[1] + Math.cos(t * 0.12) * 6,
      )
    }
    if (torch && torchRef.current && torchTargetRef.current) {
      torchRef.current.position.copy(camera.position)
      camera.getWorldDirection(torchDir)
      torchTargetRef.current.position.copy(camera.position).addScaledVector(torchDir, 10)
    }
  })

  const vis = (hex) => (visible ? hex : NEAR_BLACK)

  const heat = (intensity) => ({
    emissive: ir ? irColor : '#000000',
    emissiveIntensity: ir ? intensity * irGain : 0,
  })

  const marking = (bgHex) => ({
    color: uv ? uvColor : bgHex,
    emissive: uv ? uvColor : '#000000',
    emissiveIntensity: uv ? 3 * uvGain : 0,
    transparent: true,
    opacity: uv ? 1 : 0,
  })

  // lamp heads double as heat sources: ir overrides straight to irColor, otherwise a warm glow in their own colour
  const lampProps = (color) => {
    if (ir) return { color: NEAR_BLACK, emissive: irColor, emissiveIntensity: 3 * irGain }
    return { color: vis(color), emissive: visible ? color : '#000000', emissiveIntensity: visible ? 1.8 : 0 }
  }

  const polesTransforms = useMemo(
    () => POLES.map((p) => ({ position: [p.base[0], p.base[1] + 2.5, p.base[2]] })),
    [],
  )

  return (
    <>
      <hemisphereLight color="#8899aa" groundColor="#4a2410" intensity={hemiIntensity} />
      <ambientLight color="#3a1c0c" intensity={ambientIntensity} />
      <directionalLight
        position={[30, 20, 10]}
        intensity={sunIntensity}
        color="#ffc89a"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-near={1}
        shadow-camera-far={150}
        shadow-bias={-0.0005}
      />
      <spotLight
        ref={torchRef}
        angle={0.5}
        penumbra={0.4}
        distance={30}
        intensity={visible && torch ? 3 : 0}
        color="#fff0d0"
        castShadow={false}
      />
      <object3D ref={torchTargetRef} />

      {/* terrain */}
      <mesh geometry={terrainGeometry} receiveShadow castShadow>
        <meshStandardMaterial color={vis('#ffffff')} map={rockTex} roughness={0.95} />
      </mesh>

      {/* methane lake — the money shot: coloured pole lights mirrored in near-black liquid */}
      <mesh
        position={[LAKE_CENTER[0], -0.5, LAKE_CENTER[1]]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[60, 50]} />
        <MeshReflectorMaterial
          color={vis('#04070a')}
          metalness={0.3}
          roughness={0.25}
          mirror={0.6}
          blur={[200, 60]}
          resolution={256}
          mixBlur={0.8}
          mixStrength={1.5}
          depthScale={0.4}
        />
      </mesh>

      {/* drifting reference buoy for temporal calibration */}
      <mesh ref={buoyRef} position={[LAKE_CENTER[0], -0.42, LAKE_CENTER[1]]}>
        <sphereGeometry args={[0.18, 12, 12]} />
        <meshStandardMaterial color={vis('#40e0ff')} emissive={visible ? '#20a0c0' : '#000000'} emissiveIntensity={visible ? 0.8 : 0} />
      </mesh>

      {/* rocks — individual meshes reusing 4 displaced geometry variants */}
      {rocks.map((r, i) => {
        const jitteredColor = jitterColor('#a9601f', 0.18, r.hueJitter)
        return (
          <mesh
            key={i}
            geometry={rockGeometries[r.variant]}
            position={r.position}
            rotation={r.rotation}
            scale={r.scale}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial
              color={vis(`#${jitteredColor.getHexString()}`)}
              map={rockTex}
              roughness={0.9}
              {...(r.warm ? heat(0.5) : {})}
            />
          </mesh>
        )
      })}

      {/* UV symbol on the largest boulder's face */}
      <mesh
        position={[
          bigRock.position[0] + bigRock.scale * 0.7,
          bigRock.position[1] + bigRock.scale * 0.2,
          bigRock.position[2],
        ]}
        rotation={[0, Math.PI / 2, 0]}
      >
        <ringGeometry args={[0.25, 0.4, 24]} />
        <meshStandardMaterial {...marking(vis('#8a4222'))} />
      </mesh>

      {/* light poles marching into the fog */}
      <InstancedPoles
        transforms={polesTransforms}
        geometry={<cylinderGeometry args={[0.12, 0.12, 5, 10]} />}
        material={<meshStandardMaterial color={vis('#ffffff')} map={chalkTex} roughness={0.85} />}
      />

      {POLES.map((p, i) => (
        <group key={i}>
          <mesh position={p.lampPosition}>
            <sphereGeometry args={[0.15, 12, 12]} />
            <meshStandardMaterial {...lampProps(p.color)} />
          </mesh>
          <pointLight position={p.lampPosition} color={p.color} intensity={visible ? 2.5 : 0} distance={18} />
          <mesh position={[p.lampPosition[0], p.lampPosition[1] - 0.6, p.lampPosition[2]]}>
            <coneGeometry args={[0.9, 1.2, 16, 1, true]} />
            <meshBasicMaterial
              color={p.color}
              transparent
              opacity={visible ? 0.06 : 0}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          {(i === 0 || i === 4) && (
            <mesh position={[p.base[0], p.base[1] + 0.02, p.base[2]]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.5, 0.7, 32]} />
              <meshStandardMaterial {...marking(vis('#c4c4c4'))} />
            </mesh>
          )}
        </group>
      ))}
    </>
  )
}

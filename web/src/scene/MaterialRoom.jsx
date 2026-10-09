import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { MaterialBaker } from '../materials/MaterialBaker.js'

// ============ wall layout ============

const COLS = 8
const ROWS = 4
const PITCH = 2.3
const PANEL_SIZE = 2
const WALL_Z = -6
const BOTTOM_Y = 1.2

const WALL_WIDTH = (COLS - 1) * PITCH
const WALL_HEIGHT = (ROWS - 1) * PITCH

function panelPosition(slot) {
  const col = slot % COLS
  const row = Math.floor(slot / COLS)
  return [col * PITCH - WALL_WIDTH / 2, BOTTOM_Y + row * PITCH, WALL_Z]
}

// single wall panel: maps are baked once in the parent cache and shared
// with any junk-field object wearing the same slot's material
function Panel({ slot, maps, active, registerMesh }) {
  const position = useMemo(() => panelPosition(slot), [slot])

  const meshRef = useRef()
  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.userData.slot = slot
      registerMesh(slot, meshRef.current)
    }
    return () => registerMesh(slot, null)
  }, [slot, registerMesh])

  return (
    <group position={position}>
      {active && (
        <mesh position={[0, 0, -0.03]}>
          <planeGeometry args={[PANEL_SIZE + 0.2, PANEL_SIZE + 0.2]} />
          <meshStandardMaterial color="#4a90d9" emissive="#4a90d9" emissiveIntensity={1.2} />
        </mesh>
      )}
      <mesh ref={meshRef} castShadow receiveShadow>
        {maps ? (
          <>
            {/* subdivided so the height map actually displaces geometry, not just shades it */}
            <planeGeometry args={[PANEL_SIZE, PANEL_SIZE, 96, 96]} />
            <meshStandardMaterial
              key="baked"
              color="#ffffff"
              map={maps.albedo}
              roughnessMap={maps.roughness}
              roughness={1.0}
              normalMap={maps.normal}
              displacementMap={maps.height ?? null}
              displacementScale={0.12}
              displacementBias={-0.06}
            />
          </>
        ) : (
          <>
            <planeGeometry args={[PANEL_SIZE, PANEL_SIZE]} />
            <meshStandardMaterial key="placeholder" color="#20242a" roughness={0.9} />
          </>
        )}
      </mesh>
    </group>
  )
}

// ============ junk field ============
// scattered primitives in front of the wall, each wearing one of the 32
// baked wall materials so textures can be judged on curved geometry too

const JUNK_COUNT = 18
const JUNK_GEOMS = ['box', 'sphere', 'torus', 'torusKnot', 'cylinder', 'cone', 'icosahedron', 'capsule']
// fraction of `scale` that rests the geometry's lowest point on y=0
const JUNK_REST_FRACTION = {
  box: 0.5, sphere: 0.6, torus: 0.65, torusKnot: 0.55,
  cylinder: 0.5, cone: 0.5, icosahedron: 0.6, capsule: 0.65,
}
// clear spawn corridor (x:[0,4], z:[0,5]) plus a 2m margin: junk avoids it
const CORRIDOR_X = [-2, 6]
const CORRIDOR_Z = [-2, 7]

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

function inCorridor(x, z) {
  return x > CORRIDOR_X[0] && x < CORRIDOR_X[1] && z > CORRIDOR_Z[0] && z < CORRIDOR_Z[1]
}

function buildJunkField(wallSeed, count) {
  const rand = mulberry32(wallSeed)
  const items = []
  let tries = 0
  while (items.length < count && tries < count * 60) {
    tries++
    const x = -9 + rand() * 18
    const z = -4 + rand() * 7
    if (inCorridor(x, z)) continue
    const geomType = JUNK_GEOMS[Math.floor(rand() * JUNK_GEOMS.length)]
    const scale = 0.4 + rand() * 1.0
    const y = scale * JUNK_REST_FRACTION[geomType]
    const rotation = [rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2]
    const matSlot = Math.floor(rand() * 32)
    items.push({ position: [x, y, z], rotation, scale, geomType, matSlot })
  }
  return items
}

function junkGeometry(geomType) {
  switch (geomType) {
    case 'box': return <boxGeometry args={[1, 1, 1]} />
    case 'sphere': return <sphereGeometry args={[0.6, 24, 24]} />
    case 'torus': return <torusGeometry args={[0.5, 0.2, 16, 32]} />
    case 'torusKnot': return <torusKnotGeometry args={[0.4, 0.15, 64, 16]} />
    case 'cylinder': return <cylinderGeometry args={[0.5, 0.5, 1, 16]} />
    case 'cone': return <coneGeometry args={[0.6, 1, 16]} />
    case 'icosahedron': return <icosahedronGeometry args={[0.6, 1]} />
    case 'capsule': return <capsuleGeometry args={[0.4, 0.6, 8, 16]} />
    default: return <boxGeometry args={[1, 1, 1]} />
  }
}

function JunkItem({ item, maps, registerMesh, index }) {
  const meshRef = useRef()
  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.userData.slot = item.matSlot
      registerMesh(index, meshRef.current)
    }
    return () => registerMesh(index, null)
  }, [index, item.matSlot, registerMesh])

  return (
    <mesh
      ref={meshRef}
      position={item.position}
      rotation={item.rotation}
      scale={item.scale}
      castShadow
      receiveShadow
    >
      {junkGeometry(item.geomType)}
      {maps ? (
        <meshStandardMaterial
          key="baked"
          color="#ffffff"
          map={maps.albedo}
          roughnessMap={maps.roughness}
          roughness={1.0}
          normalMap={maps.normal}
        />
      ) : (
        <meshStandardMaterial key="placeholder" color="#888888" roughness={1.0} />
      )}
    </mesh>
  )
}

const SUN_NIGHT = new THREE.Color('#3a2a55')
const SUN_LOW = new THREE.Color('#ff7a30')
const SUN_NOON = new THREE.Color('#fff4e0')
const SKY_NOON = new THREE.Color('#bcd6ff')
const SKY_DUSK = new THREE.Color('#ffcfa0')
const SKY_NIGHT = new THREE.Color('#0e1330')
const GROUND_DAY = new THREE.Color('#4a463c')
const GROUND_DUSK = new THREE.Color('#3a2c24')
const GROUND_NIGHT = new THREE.Color('#05060d')

export default function MaterialRoom({ timeOfDay = 14, torch = false, specs = [], activeSlot = -1, wallSeed = 1 }) {
  const { gl, camera } = useThree()

  // walk mode ground convention: the gallery floor is flat
  useEffect(() => {
    const flatGround = () => 0
    window.__groundFn = flatGround
    return () => { if (window.__groundFn === flatGround) window.__groundFn = null }
  }, [])

  const baker = useMemo(() => new MaterialBaker(gl), [gl])
  useEffect(() => () => baker.dispose?.(), [baker])

  // Shared bake cache, keyed by wall slot: Panel and junk-field objects
  // both read from here so a material is only ever baked once per spec.
  // Baking is staggered at one slot per frame (see useFrame below) so a
  // full 32-slot reroll never blocks the main thread in a single commit.
  const [baked, setBaked] = useState({})
  const bakedRef = useRef(baked)
  useEffect(() => { bakedRef.current = baked }, [baked])
  const specsRef = useRef(specs)
  useEffect(() => { specsRef.current = specs }, [specs])
  const prevSpecsRef = useRef(new Array(32).fill(undefined))
  // insertion-ordered queue of slots awaiting a bake: Set preserves order
  const pendingRef = useRef(new Set())

  // invalidate only the slots whose spec identity actually changed: a
  // single live-edited panel re-queues in isolation, a reroll (all 32
  // spec references replaced) re-queues the whole wall
  useEffect(() => {
    const prevSpecs = prevSpecsRef.current
    const changedSlots = []
    for (let i = 0; i < 32; i++) {
      if (specs[i] !== prevSpecs[i]) changedSlots.push(i)
    }
    prevSpecsRef.current = specs.slice()
    if (changedSlots.length === 0) return
    changedSlots.forEach((i) => pendingRef.current.add(i))
    setBaked((prev) => {
      const next = { ...prev }
      changedSlots.forEach((i) => {
        if (next[i]) next[i].dispose()
        delete next[i]
      })
      return next
    })
  }, [specs])

  useFrame(() => {
    const pending = pendingRef.current
    if (pending.size === 0) return
    const slot = pending.values().next().value
    pending.delete(slot)
    const spec = specsRef.current[slot]
    if (!spec) return
    const maps = baker.bake(spec, 384)
    setBaked((prev) => ({ ...prev, [slot]: maps }))
  })

  // dispose every baked map on unmount, including anything still pending
  useEffect(() => () => {
    Object.values(bakedRef.current).forEach((m) => m && m.dispose())
  }, [])

  const junkField = useMemo(() => buildJunkField(wallSeed, JUNK_COUNT), [wallSeed])

  // sun elevation -1 (below horizon) .. 1 (zenith), same curve as TestScene
  const sunElevation = Math.sin(((timeOfDay - 6) / 12) * Math.PI)
  const sunAzimuth = (timeOfDay / 24) * Math.PI * 2 - Math.PI / 2
  const sunR = 25
  const sunPos = [
    Math.cos(sunAzimuth) * sunR,
    Math.max(1, sunElevation * sunR + 6),
    Math.sin(sunAzimuth) * sunR,
  ]
  const dayFactor = Math.max(0, Math.min(1, sunElevation))
  const nightDepth = Math.max(0, Math.min(1, -sunElevation))
  const sunColor = dayFactor < 0.5
    ? SUN_NIGHT.clone().lerp(SUN_LOW, dayFactor * 2)
    : SUN_LOW.clone().lerp(SUN_NOON, (dayFactor - 0.5) * 2)
  const ambientIntensity = sunElevation >= 0 ? 0.2 + dayFactor * 0.25 : 0.2 - nightDepth * 0.12
  const skyColor = sunElevation >= 0 ? SKY_DUSK.clone().lerp(SKY_NOON, dayFactor) : SKY_DUSK.clone().lerp(SKY_NIGHT, nightDepth)
  const groundColor = sunElevation >= 0 ? GROUND_DUSK.clone().lerp(GROUND_DAY, dayFactor) : GROUND_DUSK.clone().lerp(GROUND_NIGHT, nightDepth)

  const torchRef = useRef()
  const torchTargetRef = useRef()
  const torchDir = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    if (torchRef.current && torchTargetRef.current) torchRef.current.target = torchTargetRef.current
  }, [])

  useFrame(() => {
    if (torch && torchRef.current && torchTargetRef.current) {
      torchRef.current.position.copy(camera.position)
      camera.getWorldDirection(torchDir)
      torchTargetRef.current.position.copy(camera.position).addScaledVector(torchDir, 10)
    }
  })

  // pickable mesh registries for KeyE raycasting: panels and junk-field
  // objects both register into their own slot so either can be picked
  const panelMeshes = useRef([])
  const registerPanelMesh = useMemo(
    () => (slot, mesh) => { panelMeshes.current[slot] = mesh },
    [],
  )
  const junkMeshes = useRef([])
  const registerJunkMesh = useMemo(
    () => (index, mesh) => { junkMeshes.current[index] = mesh },
    [],
  )

  useEffect(() => {
    function onKeyDown(e) {
      if (e.code !== 'KeyE' || e.repeat) return
      const target = e.target
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)
      const targets = panelMeshes.current.filter(Boolean).concat(junkMeshes.current.filter(Boolean))
      const hits = raycaster.intersectObjects(targets, false)
      if (hits.length > 0) {
        const slot = hits[0].object.userData.slot
        window.dispatchEvent(new CustomEvent('render:mat-pick', { detail: { slot } }))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [camera])

  return (
    <>
      <hemisphereLight color={skyColor} groundColor={groundColor} intensity={ambientIntensity} />
      <ambientLight color="#ffffff" intensity={0.05} />
      <directionalLight
        position={sunPos}
        intensity={dayFactor * 2.4}
        color={sunColor}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-bias={-0.0005}
      />
      {/* warm point lights so the wall reads at night without the sun */}
      <pointLight position={[-8, 4, -2]} intensity={1.2} distance={18} decay={1.2} color="#ffd9a0" />
      <pointLight position={[8, 4, -2]} intensity={1.2} distance={18} decay={1.2} color="#ffd9a0" />
      {/* handheld torch: parented to the camera via position copy each frame */}
      <spotLight
        ref={torchRef}
        angle={0.5}
        penumbra={0.4}
        distance={30}
        intensity={torch ? 3 : 0}
        color="#fff0d0"
        castShadow={false}
      />
      <object3D ref={torchTargetRef} />

      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[44, 16]} />
        <meshStandardMaterial color="#707070" roughness={0.9} />
      </mesh>

      {/* backdrop behind the panel wall */}
      <mesh position={[0, BOTTOM_Y + WALL_HEIGHT / 2, WALL_Z - 0.4]} receiveShadow>
        <planeGeometry args={[WALL_WIDTH + 4, WALL_HEIGHT + 6]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.95} />
      </mesh>

      {/* side walls */}
      <mesh position={[-WALL_WIDTH / 2 - 2, BOTTOM_Y + WALL_HEIGHT / 2, WALL_Z + 6]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[12, WALL_HEIGHT + 6]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.95} />
      </mesh>
      <mesh position={[WALL_WIDTH / 2 + 2, BOTTOM_Y + WALL_HEIGHT / 2, WALL_Z + 6]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[12, WALL_HEIGHT + 6]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.95} />
      </mesh>

      {/* material panel wall */}
      {Array.from({ length: COLS * ROWS }, (_, slot) => (
        <Panel
          key={slot}
          slot={slot}
          maps={baked[slot]}
          active={activeSlot === slot}
          registerMesh={registerPanelMesh}
        />
      ))}

      {/* junk field: curved geometry wearing the same baked materials */}
      {junkField.map((item, i) => (
        <JunkItem
          key={i}
          index={i}
          item={item}
          maps={baked[item.matSlot]}
          registerMesh={registerJunkMesh}
        />
      ))}
    </>
  )
}

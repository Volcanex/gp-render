import { useEffect, useMemo, useRef } from 'react'
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

// single baked panel — bakes on spec change, disposes the previous maps
function Panel({ slot, spec, baker, active, registerMesh }) {
  const position = useMemo(() => panelPosition(slot), [slot])
  const maps = useMemo(() => (spec ? baker.bake(spec, 512) : null), [baker, spec])

  useEffect(() => {
    return () => {
      if (maps) maps.dispose()
    }
  }, [maps])

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
        <planeGeometry args={[PANEL_SIZE, PANEL_SIZE]} />
        {maps ? (
          <meshStandardMaterial
            color="#ffffff"
            map={maps.albedo}
            roughnessMap={maps.roughness}
            roughness={1.0}
            normalMap={maps.normal}
          />
        ) : (
          <meshStandardMaterial color="#888888" roughness={1.0} />
        )}
      </mesh>
    </group>
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

export default function MaterialRoom({ timeOfDay = 14, torch = false, specs = [], activeSlot = -1 }) {
  const { gl, camera } = useThree()

  // walk mode ground convention — the gallery floor is flat
  useEffect(() => {
    const flatGround = () => 0
    window.__groundFn = flatGround
    return () => { if (window.__groundFn === flatGround) window.__groundFn = null }
  }, [])

  const baker = useMemo(() => new MaterialBaker(gl), [gl])
  useEffect(() => () => baker.dispose?.(), [baker])

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

  // panel mesh registry for KeyE picking
  const panelMeshes = useRef([])
  const registerMesh = useMemo(
    () => (slot, mesh) => { panelMeshes.current[slot] = mesh },
    [],
  )

  useEffect(() => {
    function onKeyDown(e) {
      if (e.code !== 'KeyE' || e.repeat) return
      const target = e.target
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera)
      const hits = raycaster.intersectObjects(panelMeshes.current.filter(Boolean), false)
      if (hits.length > 0) {
        const slot = hits[0].object.userData.slot
        window.dispatchEvent(new CustomEvent('titan:mat-pick', { detail: { slot } }))
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
      <pointLight position={[-8, 4, -2]} intensity={8} distance={18} color="#ffd9a0" />
      <pointLight position={[8, 4, -2]} intensity={8} distance={18} color="#ffd9a0" />
      {/* handheld torch — parented to the camera via position copy each frame */}
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
          spec={specs[slot]}
          baker={baker}
          active={activeSlot === slot}
          registerMesh={registerMesh}
        />
      ))}
    </>
  )
}

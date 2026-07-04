import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, PointerLockControls } from '@react-three/drei'
import * as THREE from 'three'
import { setFocalLength } from '../ui/Controls.jsx'

const FLY_SPEED = 6
const FLY_SHIFT_MULT = 4

const WALK_SPEED = 4
const WALK_RUN_MULT = 1.8
const GRAVITY = -18
const JUMP_VELOCITY = 7
const EYE_HEIGHT = 1.7

const WORLD_UP = new THREE.Vector3(0, 1, 0)

const FLY_KEY_TO_ACTION = {
  KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right',
  KeyQ: 'down', KeyE: 'up', ShiftLeft: 'boost', ShiftRight: 'boost',
}

const WALK_ZOOM_RATE = 0.9

const WALK_KEY_TO_ACTION = {
  KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right',
  KeyQ: 'zoomOut', KeyE: 'zoomIn', ShiftLeft: 'boost', ShiftRight: 'boost', Space: 'jump',
}

function useFocalLength(focalLength) {
  const { camera } = useThree()
  useEffect(() => {
    camera.fov = 2 * Math.atan(12 / focalLength) * (180 / Math.PI)
    camera.updateProjectionMatrix()
  }, [camera, focalLength])
}

function useKeyState(mapping) {
  const keys = useRef({})
  useEffect(() => {
    const onKeyDown = (e) => {
      const action = mapping[e.code]
      if (action) {
        keys.current[action] = true
        if (action === 'jump') e.preventDefault()
      }
    }
    const onKeyUp = (e) => {
      const action = mapping[e.code]
      if (action) keys.current[action] = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      keys.current = {}
    }
  }, [mapping])
  return keys
}

function useExitPointerLockOnUnmount() {
  useEffect(() => {
    return () => {
      if (document.pointerLockElement) document.exitPointerLock()
    }
  }, [])
}

function FlyControls() {
  const { camera } = useThree()
  const keys = useKeyState(FLY_KEY_TO_ACTION)
  useExitPointerLockOnUnmount()

  useFrame((_, delta) => {
    const k = keys.current
    const speed = FLY_SPEED * (k.boost ? FLY_SHIFT_MULT : 1) * delta
    if (k.forward) camera.translateZ(-speed)
    if (k.back) camera.translateZ(speed)
    if (k.left) camera.translateX(-speed)
    if (k.right) camera.translateX(speed)
    if (k.up) camera.position.y += speed
    if (k.down) camera.position.y -= speed
  })

  return <PointerLockControls makeDefault selector="canvas" />
}

function WalkControls({ focalLength }) {
  const { camera } = useThree()
  const keys = useKeyState(WALK_KEY_TO_ACTION)
  useExitPointerLockOnUnmount()

  const vy = useRef(0)
  const grounded = useRef(true)
  const forward = useRef(new THREE.Vector3())
  const right = useRef(new THREE.Vector3())
  const move = useRef(new THREE.Vector3())
  // float accumulator: setFocalLength rounds to integer mm, so deriving each
  // frame's zoom from the rounded prop stalls slow zooms at low mm values.
  // Re-seed only when the prop diverges (slider/preset change from outside).
  const zoomMm = useRef(focalLength)

  useFrame((_, delta) => {
    const k = keys.current

    if (Math.abs(focalLength - zoomMm.current) > 1) zoomMm.current = focalLength

    // horizontal-only look direction: flatten to the XZ plane before
    // deriving forward/right so looking up/down doesn't change speed
    camera.getWorldDirection(forward.current)
    forward.current.y = 0
    if (forward.current.lengthSq() > 0) forward.current.normalize()
    right.current.crossVectors(forward.current, WORLD_UP).normalize()

    move.current.set(0, 0, 0)
    if (k.forward) move.current.add(forward.current)
    if (k.back) move.current.sub(forward.current)
    if (k.right) move.current.add(right.current)
    if (k.left) move.current.sub(right.current)
    if (move.current.lengthSq() > 0) move.current.normalize()

    const speed = WALK_SPEED * (k.boost ? WALK_RUN_MULT : 1) * delta
    camera.position.x += move.current.x * speed
    camera.position.z += move.current.z * speed

    if (k.jump && grounded.current) {
      vy.current = JUMP_VELOCITY
      grounded.current = false
    }

    vy.current += GRAVITY * delta
    camera.position.y += vy.current * delta

    // scenes with uneven terrain publish a ground sampler; flat 0 otherwise
    const groundY = (window.__groundFn ? window.__groundFn(camera.position.x, camera.position.z) : 0) + EYE_HEIGHT
    if (camera.position.y <= groundY) {
      camera.position.y = groundY
      vy.current = 0
      grounded.current = true
    }

    // Q/E twist the lens barrel: exponential rate so 20mm and 100mm zoom
    // at the same perceptual speed. The prop flows back through leva and
    // is applied by useFocalLength above.
    if (k.zoomIn || k.zoomOut) {
      zoomMm.current *= Math.exp((k.zoomIn ? 1 : -1) * WALK_ZOOM_RATE * delta)
      setFocalLength(zoomMm.current)
    }
  })

  return <PointerLockControls makeDefault selector="canvas" />
}

export default function CameraRig({ mode, focalLength, sceneId }) {
  useFocalLength(focalLength)
  const { camera } = useThree()

  // reset to the spawn point whenever the scene changes — carrying a walked
  // position into a different scene's terrain can leave the camera
  // underground (black frame, rays starting inside geometry)
  useEffect(() => {
    camera.position.set(4, 2.5, 5)
    if (mode !== 'orbit') camera.lookAt(0, 1, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId])

  if (mode === 'fly') return <FlyControls />
  if (mode === 'walk') return <WalkControls focalLength={focalLength} />
  return <OrbitControls makeDefault enableDamping />
}

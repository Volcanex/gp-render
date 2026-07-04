import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, PointerLockControls } from '@react-three/drei'

const BASE_SPEED = 6
const SHIFT_MULT = 4

const KEY_TO_ACTION = {
  KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right',
  KeyQ: 'down', KeyE: 'up', ShiftLeft: 'boost', ShiftRight: 'boost',
}

function useFocalLength(focalLength) {
  const { camera } = useThree()
  useEffect(() => {
    camera.fov = 2 * Math.atan(12 / focalLength) * (180 / Math.PI)
    camera.updateProjectionMatrix()
  }, [camera, focalLength])
}

function FlyControls() {
  const { camera } = useThree()
  const keys = useRef({})

  useEffect(() => {
    const onKeyDown = (e) => {
      const action = KEY_TO_ACTION[e.code]
      if (action) keys.current[action] = true
    }
    const onKeyUp = (e) => {
      const action = KEY_TO_ACTION[e.code]
      if (action) keys.current[action] = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      keys.current = {}
    }
  }, [])

  useEffect(() => {
    return () => {
      if (document.pointerLockElement) document.exitPointerLock()
    }
  }, [])

  useFrame((_, delta) => {
    const k = keys.current
    const speed = BASE_SPEED * (k.boost ? SHIFT_MULT : 1) * delta
    if (k.forward) camera.translateZ(-speed)
    if (k.back) camera.translateZ(speed)
    if (k.left) camera.translateX(-speed)
    if (k.right) camera.translateX(speed)
    if (k.up) camera.position.y += speed
    if (k.down) camera.position.y -= speed
  })

  return <PointerLockControls makeDefault selector="canvas" />
}

export default function CameraRig({ mode, focalLength }) {
  useFocalLength(focalLength)

  if (mode === 'fly') return <FlyControls />
  return <OrbitControls makeDefault enableDamping />
}

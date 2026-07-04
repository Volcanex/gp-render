// Integrator: composes the post chain in order
//   SensorEffect (exposure + ISO grain, pre-quantise)
//   VisionEffect (pixelate + quantise + dither + palette ramp)
//   EdgeOutlineEffect (depth-sobel outline composited over the dithered output)
// pmndrs postprocessing merges all three into a single fullscreen pass.
// Also owns the Pope dither-pinning math: on 'rotation' pinning the dither
// offset tracks camera yaw/pitch so the pattern sticks to the scene while
// panning (offset = screenSize * rotation / fov).
import { useEffect, useMemo } from 'react'
import { useFrame, useThree, useLoader } from '@react-three/fiber'
import { EffectComposer } from '@react-three/postprocessing'
import * as THREE from 'three'
import { DepthOfFieldEffect } from 'postprocessing'
import { SensorEffect } from './SensorEffect.js'
import { VisionEffect } from './VisionEffect.js'
import { EdgeOutlineEffect } from './EdgeOutlineEffect.js'
import { getRampTexture } from './ramps.js'

const euler = new THREE.Euler()

export default function VisionPipeline({ params, clutTexture }) {
  const { camera, size } = useThree()

  const noise = useLoader(THREE.TextureLoader, '/textures/bluenoise128.png')
  useMemo(() => {
    noise.wrapS = noise.wrapT = THREE.RepeatWrapping
    noise.minFilter = noise.magFilter = THREE.NearestFilter
    noise.generateMipmaps = false
    noise.needsUpdate = true
  }, [noise])

  const sensor = useMemo(() => new SensorEffect(), [])
  const vision = useMemo(() => new VisionEffect({ noiseTexture: noise }), [noise])
  const outline = useMemo(() => new EdgeOutlineEffect(), [])
  // DOF runs on the clean render, before the sensor/dither stylisation
  const dof = useMemo(
    () => (params.dof ? new DepthOfFieldEffect(camera, { focusDistance: params.focusDistance, focalLength: 0.05, bokehScale: 1 }) : null),
    [params.dof, camera],
  )

  const ramp = getRampTexture(params.palette)
  useEffect(() => {
    sensor.setParams(params)
    vision.setParams(params)
    vision.setRamp(ramp)
    vision.setClut(clutTexture)
    outline.setParams(params)
    if (dof) {
      dof.bokehScale = 10 / params.fNumber
      dof.cocMaterial.uniforms.focusDistance.value = params.focusDistance
    }
  }, [params, ramp, sensor, vision, outline, dof, clutTexture])

  useFrame(() => {
    if (params.pinning === 'rotation') {
      euler.setFromQuaternion(camera.quaternion, 'YXZ')
      const vfov = THREE.MathUtils.degToRad(camera.fov)
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect)
      vision.ditherOffset.set(
        (-euler.y / hfov) * size.width,
        (-euler.x / vfov) * size.height,
      )
    } else {
      vision.ditherOffset.set(0, 0)
    }
  })

  return (
    <EffectComposer depthBuffer multisampling={0}>
      {dof ? <primitive object={dof} /> : null}
      <primitive object={sensor} />
      <primitive object={vision} />
      <primitive object={outline} />
    </EffectComposer>
  )
}

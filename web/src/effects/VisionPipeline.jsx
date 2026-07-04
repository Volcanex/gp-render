// Integrator: composes the post chain in order
//   SensorEffect (exposure + ISO grain, pre-quantise)
//   VisionEffect (pixelate + quantise + dither + palette ramp)
//   EdgeOutlineEffect (depth-sobel outline composited over the dithered output)
// pmndrs postprocessing merges all three into a single fullscreen pass.
// Also owns the Pope dither-pinning math: on 'rotation' pinning the dither
// offset tracks camera yaw/pitch so the pattern sticks to the scene while
// panning (offset = screenSize * rotation / fov).
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree, useLoader } from '@react-three/fiber'
import { EffectComposer } from '@react-three/postprocessing'
import * as THREE from 'three'
import { DepthOfFieldEffect, DepthPickingPass } from 'postprocessing'
import { SensorEffect } from './SensorEffect.js'
import { VisionEffect } from './VisionEffect.js'
import { EdgeOutlineEffect } from './EdgeOutlineEffect.js'
import { SharpenEffect } from './SharpenEffect.js'
import { ErrorDiffusionPass } from './ErrorDiffusionPass.js'
import { AutofocusController } from './autofocus.js'
import { attachPassTimers, markFrame } from '../perf/passTimers.js'
import { getRampTexture } from './ramps.js'

const euler = new THREE.Euler()
const pickVec = new THREE.Vector3()

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
  const sharpen = useMemo(() => new SharpenEffect(), [])
  // DOF runs on the clean render, before the sensor/dither stylisation
  // focusDistance/focusRange are in world units in this postprocessing version
  const dof = useMemo(
    () => (params.dof ? new DepthOfFieldEffect(camera, { focusDistance: params.focusDistance, focusRange: 2, bokehScale: 1 }) : null),
    [params.dof, camera],
  )

  // Autofocus: a depth-picking pass measures the true distance under the
  // screen-centre crosshair; the AF controller turns it into the applied
  // focus with per-sensor dynamics (instant / lazy / hunting).
  const picker = useMemo(() => (params.dof ? new DepthPickingPass() : null), [params.dof])
  const af = useMemo(() => new AutofocusController(), [])
  const measured = useRef(null)
  const reading = useRef(false)
  const pickCooldown = useRef(0)
  const composerRef = useRef(null)
  useEffect(() => { af.setMode(params.afMode) }, [af, params.afMode])
  useEffect(() => { af.setManual(params.focusDistance) }, [af, params.focusDistance])
  // debug hook: watch AF state from the console (window.__titanAF.current)
  useEffect(() => { window.__titanAF = af }, [af])

  // True error diffusion (floyd/atkinson) is a serial CPU pass, not a shader —
  // it replaces VisionEffect in the chain when selected.
  const errorDiffusion = params.ditherMode === 'floyd' || params.ditherMode === 'atkinson'
  const edPass = useMemo(() => new ErrorDiffusionPass(), [])
  useEffect(() => () => edPass.dispose(), [edPass])

  const ramp = getRampTexture(params.palette)
  useEffect(() => {
    sensor.setParams(params)
    vision.setParams(params)
    vision.setRamp(ramp)
    vision.setClut(clutTexture)
    outline.setParams(params)
    sharpen.setParams(params)
    if (errorDiffusion) {
      edPass.setParams(params)
      const d = ramp.image.data
      edPass.setRamp(Array.from({ length: 256 }, (_, i) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]))
      edPass.setClut(clutTexture.image.data)
    }
    // max blur scales with aperture and lens length, like real glass
    if (dof) dof.bokehScale = THREE.MathUtils.clamp((params.focalLength / 50) * (10 / params.fNumber), 0.5, 14)
  }, [params, ramp, sensor, vision, outline, dof, clutTexture, errorDiffusion, edPass])

  // (re)wrap pass render methods with timers whenever the chain changes
  useEffect(() => {
    if (composerRef.current) attachPassTimers(composerRef.current)
  })

  useFrame((state, delta) => {
    markFrame()
    if (dof) {
      // sample crosshair depth — throttled: the readback forces a GPU sync,
      // so doing it every frame costs real frame time
      pickCooldown.current -= delta
      if (picker && params.afMode !== 'manual' && !reading.current && pickCooldown.current <= 0) {
        pickCooldown.current = 0.12
        reading.current = true
        // the pass costs real frame time every frame it renders, so it stays
        // disabled except for the frames a read is actually in flight
        picker.enabled = true
        pickVec.set(0, 0, 0)
        picker.readDepth(pickVec).then((d) => {
          pickVec.set(0, 0, d * 2 - 1)
          if (1 - pickVec.z > 1e-7) {
            pickVec.unproject(camera)
            measured.current = camera.position.distanceTo(pickVec)
          } else {
            // sky/far-plane: rack to infinity like a real lens, don't hold
            measured.current = 60
          }
          reading.current = false
          picker.enabled = false
        }).catch(() => { reading.current = false; picker.enabled = false })
      }
      af.update(delta, measured.current)
      dof.cocMaterial.focusDistance = af.current
      // Thin-lens-ish falloff: the CoC shader saturates to full blur at
      // focusRange, so focusRange must span most of the scene for blur to
      // build gradually with distance instead of reading as a uniform blur
      // with one sharp band. Depth of field ~ d^2 * N / f_mm^2.
      const range = 110 * af.current * af.current * params.fNumber / (params.focalLength * params.focalLength)
      dof.cocMaterial.focusRange = THREE.MathUtils.clamp(range, 1.5, 200)
    }
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
    <EffectComposer ref={composerRef} depthBuffer multisampling={0}>
      {picker ? <primitive object={picker} /> : null}
      {dof ? <primitive object={dof} /> : null}
      <primitive object={sensor} />
      {errorDiffusion ? <primitive object={edPass} /> : <primitive object={vision} />}
      <primitive object={outline} />
      <primitive object={sharpen} />
    </EffectComposer>
  )
}

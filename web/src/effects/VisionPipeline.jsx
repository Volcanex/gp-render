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
import { BloomEffect, ChromaticAberrationEffect, DepthOfFieldEffect, DepthPickingPass, SMAAEffect, VignetteEffect } from 'postprocessing'
import { SensorEffect } from './SensorEffect.js'
import { VisionEffect } from './VisionEffect.js'
import { EdgeOutlineEffect } from './EdgeOutlineEffect.js'
import { TAAUPass, RCASEffect } from '../taau/index.js'
import { RollingShutterEffect } from './RollingShutterEffect.js'
import { MotionBlurEffect } from './MotionBlurEffect.js'
import { ErrorDiffusionPass } from './ErrorDiffusionPass.js'
import { AutofocusController } from './autofocus.js'
import { MeteringPass, AutoExposureController } from './metering.js'
import { VolumetricFogEffect } from './VolumetricFogEffect.js'
import { TITAN_LAMPS } from '../scene/TitanScene.jsx'
import { attachPassTimers, markFrame, initGpuTimers } from '../perf/passTimers.js'
import { getRampTexture } from './ramps.js'

const euler = new THREE.Euler()
const pickVec = new THREE.Vector3()

export default function VisionPipeline({ params, clutTexture }) {
  const { camera, size, scene, gl } = useThree()

  useEffect(() => { initGpuTimers(gl) }, [gl])

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
  const sharpen = useMemo(() => new RCASEffect(), [])

  // TAAU is THE upscaler: jittered low-res render + temporal reconstruction
  // to output resolution. It replaces the composer's RenderPass (disabled
  // below); renderScale is the internal ratio (0.5 -> 2x upscale, 1 = TAA).
  const taau = useMemo(
    () => new TAAUPass(scene, camera, { ratioX: 1 / (params.renderScaleX || 0.5), ratioY: 1 / (params.renderScaleY || 0.5) }),
    [scene, camera],
  )
  useEffect(() => () => { taau.dispose() }, [taau])
  useEffect(() => {
    taau.setRatio(1 / (params.renderScaleX || 0.5), 1 / (params.renderScaleY || 0.5))
  }, [taau, params.renderScaleX, params.renderScaleY])
  useEffect(() => {
    // re-enabling after an A/B toggle must not blend against stale history
    if (params.taauEnabled) taau.historyValid = false
  }, [taau, params.taauEnabled])

  // optional extra SMAA on top of the temporal resolve (residual geo edges)
  const smaa = useMemo(() => (params.aa ? new SMAAEffect() : null), [params.aa])
  useEffect(() => () => { if (smaa) smaa.dispose?.() }, [smaa])
  useEffect(() => {
    if (!taau) return
    taau.configure({
      blendBase: params.taauBlend,
      varianceGamma: params.taauGamma,
      kernelSharpness: params.taauKernel,
      lumaRejection: params.taauLumaReject,
      historyFilter: params.taauFilter,
      debugView: params.taauDebug,
    })
  }, [taau, params.taauBlend, params.taauGamma, params.taauKernel, params.taauLumaReject, params.taauFilter, params.taauDebug])
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

  // Auto exposure / auto white balance: a tiny metering pass samples the
  // pre-sensor image; the AE controller lags a correction toward mid-grey.
  const meter = useMemo(() => new MeteringPass(), [])
  useEffect(() => () => meter.dispose(), [meter])
  const ae = useMemo(() => new AutoExposureController(), [])
  useEffect(() => { ae.setMode(params.exposureMode) }, [ae, params.exposureMode])
  useEffect(() => { ae.setBias(params.aeBias) }, [ae, params.aeBias])
  const meterCooldown = useRef(0)
  const autoWb = useRef(null)
  const effScratch = useRef({})
  useEffect(() => { af.setMode(params.afMode) }, [af, params.afMode])
  useEffect(() => { af.setManual(params.focusDistance) }, [af, params.focusDistance])
  // debug hook: watch AF state from the console (window.__titanAF.current)
  useEffect(() => { window.__titanAF = af }, [af])

  // Volumetric fog: depth-marched haze with lamp inscatter, Titan scene only
  const volFog = useMemo(() => {
    if (params.scene !== 'titan') return null
    const fx = new VolumetricFogEffect()
    fx.setLights(TITAN_LAMPS)
    fx.setParams({ density: 0.011, fogColor: '#2a1608', enabled: true, fogBase: -0.5, fogHeight: 4.5 })
    return fx
  }, [params.scene])
  useEffect(() => () => { if (volFog) volFog.dispose?.() }, [volFog])
  useEffect(() => {
    if (volFog) volFog.setParams({ density: params.fogDensity, fogHeight: params.fogHeight })
  }, [volFog, params.fogDensity, params.fogHeight])


  // Rolling shutter (geometric readout skew, no blur) and optional camera
  // motion blur — both created only while their amount is non-zero
  const rollFx = useMemo(
    () => (params.rollingShutter > 0 ? new RollingShutterEffect() : null),
    [params.rollingShutter > 0],
  )
  useEffect(() => () => { if (rollFx) rollFx.dispose?.() }, [rollFx])
  const blurFx = useMemo(
    () => (params.motionBlur > 0 ? new MotionBlurEffect() : null),
    [params.motionBlur > 0],
  )
  useEffect(() => () => { if (blurFx) blurFx.dispose?.() }, [blurFx])
  const prevYawPitch = useRef([0, 0])
  const currVP = useRef(new THREE.Matrix4())
  const prevVP = useRef(new THREE.Matrix4())
  const currInvVP = useRef(new THREE.Matrix4())

  // Lens character: bloom/CA/vignette apply to the clean image before the
  // sensor stylisation, like real glass ahead of the sensor. Each exists in
  // the chain only while its amount is non-zero.
  const bloom = useMemo(
    () => (params.bloom > 0 ? new BloomEffect({ intensity: 1, luminanceThreshold: 0.7, luminanceSmoothing: 0.2, mipmapBlur: true }) : null),
    [params.bloom > 0],
  )
  useEffect(() => () => { if (bloom) bloom.dispose() }, [bloom])
  const chromAb = useMemo(
    () => (params.chromAb > 0 ? new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.001, 0.001), radialModulation: true, modulationOffset: 0.15 }) : null),
    [params.chromAb > 0],
  )
  useEffect(() => () => { if (chromAb) chromAb.dispose() }, [chromAb])
  const vignetteFx = useMemo(
    () => (params.vignette > 0 ? new VignetteEffect({ offset: 0.3, darkness: 0.5 }) : null),
    [params.vignette > 0],
  )
  useEffect(() => () => { if (vignetteFx) vignetteFx.dispose() }, [vignetteFx])
  useEffect(() => {
    if (bloom) bloom.intensity = params.bloom * 2
    if (chromAb) chromAb.offset.set(params.chromAb * 0.004, params.chromAb * 0.004)
    if (vignetteFx) vignetteFx.darkness = params.vignette
  }, [params, bloom, chromAb, vignetteFx])

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
    if (rollFx) rollFx.setParams(params)
    if (blurFx) blurFx.setParams(params)
    if (errorDiffusion) {
      edPass.setParams(params)
      const d = ramp.image.data
      edPass.setRamp(Array.from({ length: 256 }, (_, i) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]))
      edPass.setClut(clutTexture.image.data)
    }
    // max blur scales with aperture and lens length, like real glass
    if (dof) dof.bokehScale = THREE.MathUtils.clamp((params.focalLength / 50) * (10 / params.fNumber), 0.5, 14)
  }, [params, ramp, sensor, vision, outline, dof, clutTexture, errorDiffusion, edPass])

  // (re)wrap pass render methods with timers whenever the chain changes;
  // also gate the composer's built-in RenderPass: TAAUPass does the scene
  // draw itself (jittered, low res) when active
  useEffect(() => {
    const composer = composerRef.current
    if (!composer) return
    // TAAUPass owns the scene draw; when toggled off for A/B the composer's
    // RenderPass takes back over at output resolution
    const taauEnabled = params.taauEnabled ?? true
    if (composer.passes[0]) composer.passes[0].enabled = !taauEnabled
    taau.enabled = taauEnabled
    attachPassTimers(composer)
  })

  useFrame((state, delta) => {
    markFrame()
    if (volFog) {
      volFog.updateCamera(camera)
      volFog.setTime(state.clock.elapsedTime)
    }

    // camera angular velocity in uv units/frame (rolling shutter) and
    // view-projection pair (motion blur) — both camera-only, like TAAU
    if (rollFx || blurFx) {
      euler.setFromQuaternion(camera.quaternion, 'YXZ')
      const vfov = THREE.MathUtils.degToRad(camera.fov)
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect)
      if (rollFx) {
        const [py, pp] = prevYawPitch.current
        rollFx.setVelocity(-(euler.y - py) / hfov, (euler.x - pp) / vfov)
      }
      prevYawPitch.current = [euler.y, euler.x]
      if (blurFx) {
        currVP.current.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        currInvVP.current.copy(currVP.current).invert()
        blurFx.updateCamera(currInvVP.current, prevVP.current)
        prevVP.current.copy(currVP.current)
      }
    }
    const metering = params.exposureMode !== 'manual' || params.wbAuto
    if (metering) {
      meterCooldown.current -= delta
      if (meterCooldown.current <= 0) {
        meterCooldown.current = 0.15
        meter.requestSample()
      }
      const s = meter.lastSample
      ae.update(delta, s ? s.luma : null)
      if (params.wbAuto && s) {
        const avg = (s.r + s.g + s.b) / 3
        const target = [s.r, s.g, s.b].map(c => Math.min(2, Math.max(0.5, avg / Math.max(c, 1e-3))))
        const cur = autoWb.current || [1, 1, 1]
        autoWb.current = cur.map((c, i) => c + (target[i] - c) * Math.min(1, delta * 2))
      }
    } else {
      ae.update(delta, null)
    }
    // effective exposure: priority modes float exactly one variable toward
    // the meter, sliders stay the base values (reused object — a fresh
    // spread every frame feeds the GC and causes jank)
    const eff = Object.assign(effScratch.current, params)
    if (params.exposureMode === 'auto-ev') eff.ev = params.ev + ae.stops
    else if (params.exposureMode === 'auto-iso') eff.iso = ae.autoIso(params.iso)
    else if (params.exposureMode === 'auto-shutter') {
      // one stop = halved shutter denominator (longer exposure)
      eff.shutter = THREE.MathUtils.clamp((params.shutter || 60) / Math.pow(2, ae.stops), 8, 2000)
    } else if (params.exposureMode === 'auto-aperture') {
      // one stop = sqrt(2) on the f-number; DOF follows via eff.fNumber
      eff.fNumber = THREE.MathUtils.clamp((params.fNumber || 4) / Math.pow(Math.SQRT2, ae.stops), 1.4, 16)
    }
    sensor.setParams(eff)
    sensor.setAutoWb(params.wbAuto ? autoWb.current : null)
    vision.setParams(eff)
    // viewfinder readout state (CameraHud polls this); shutter is display
    // fiction derived from effective EV until motion blur is simulated
    window.__titanCamera = {
      iso: Math.round(eff.iso),
      fNumber: Math.round(eff.fNumber * 10) / 10,
      shutter: Math.round(eff.shutter || 60),
      focalLength: Math.round(params.focalLength),
      ev: eff.ev,
      aeStops: ae.stops,
      focus: dof ? af.current : null,
      exposureMode: params.exposureMode,
      taauFrom: (params.taauEnabled ?? true) ? [taau.renderWidth, taau.renderHeight] : null,
      taauTo: [taau.outputWidth, taau.outputHeight],
    }
    if (dof) {
      // sample crosshair depth — throttled: the readback forces a GPU sync,
      // so doing it every frame costs real frame time
      pickCooldown.current -= delta
      if (picker && params.afMode !== 'manual' && !reading.current && pickCooldown.current <= 0) {
        pickCooldown.current = 0.2
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
      // aperture may be AE-driven (auto-aperture priority): DOF follows eff
      dof.bokehScale = THREE.MathUtils.clamp((params.focalLength / 50) * (10 / eff.fNumber), 0.5, 14)
      dof.cocMaterial.focusDistance = af.current
      // Thin-lens-ish falloff: the CoC shader saturates to full blur at
      // focusRange, so focusRange must span most of the scene for blur to
      // build gradually with distance instead of reading as a uniform blur
      // with one sharp band. Depth of field ~ d^2 * N / f_mm^2.
      const range = 110 * af.current * af.current * eff.fNumber / (params.focalLength * params.focalLength)
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
      <primitive object={taau} />
      {picker ? <primitive object={picker} /> : null}
      {dof ? <primitive object={dof} /> : null}
      {volFog ? <primitive object={volFog} /> : null}
      {rollFx ? <primitive object={rollFx} /> : null}
      {blurFx ? <primitive object={blurFx} /> : null}
      {bloom ? <primitive object={bloom} /> : null}
      {chromAb ? <primitive object={chromAb} /> : null}
      {vignetteFx ? <primitive object={vignetteFx} /> : null}
      {smaa ? <primitive object={smaa} /> : null}
      <primitive object={meter} />
      <primitive object={sensor} />
      {errorDiffusion ? <primitive object={edPass} /> : <primitive object={vision} />}
      <primitive object={outline} />
      <primitive object={sharpen} />
    </EffectComposer>
  )
}

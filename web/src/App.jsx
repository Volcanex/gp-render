import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import TestScene from './scene/TestScene.jsx'
import RaymarchScene from './scene/RaymarchScene.jsx'
import TitanScene from './scene/TitanScene.jsx'
import MaterialRoom from './scene/MaterialRoom.jsx'
import CameraRig from './scene/CameraRig.jsx'
import VisionPipeline from './effects/VisionPipeline.jsx'
import PaletteEditor from './palette/PaletteEditor.jsx'
import { useSensorParams, useMaterialLab } from './ui/Controls.jsx'
import { randomWall, specFromLab, labFromSpec, saveUserMaterial, loadUserMaterials } from './materials/specs.js'
import PerfHud from './perf/PerfHud.jsx'
import CameraHud from './perf/CameraHud.jsx'
import { identity332, makeClutTexture } from './palette/clut.js'
import { applyClutPreset } from './palette/clutPresets.js'

// sky colour for the geometry scene tracks the sun; raymarch draws its own sky
function skyColor(t) {
  const day = Math.max(0, Math.sin(((t - 6) / 12) * Math.PI))
  const dusk = Math.max(0, 1 - Math.abs(day - 0.15) * 6)
  // night floor must be near-zero: a real night sky is orders of magnitude
  // darker than lit objects, so even +6 stops of auto-ISO keeps it dark
  const r = 0.0015 + day * 0.34 + dusk * 0.45
  const g = 0.002 + day * 0.47 + dusk * 0.2
  const b = 0.004 + day * 0.67 + dusk * 0.12
  return [r, g, b]
}

// saved user materials pin to the wall's first slots after every reroll
function buildWall(seed) {
  const wall = randomWall(32, seed)
  const saved = loadUserMaterials()
  for (let i = 0; i < Math.min(saved.length, 8); i++) wall[i] = saved[i]
  return wall
}

export default function App() {
  const params = useSensorParams()
  const [lab, setLab] = useMaterialLab()
  const [wallSeed, setWallSeed] = useState(1)
  const [specs, setSpecs] = useState(() => buildWall(1))
  const [activeSlot, setActiveSlot] = useState(-1)
  // a pick loads the panel's spec into the editor; suppress the echo where
  // the editor effect would immediately rewrite (and rebake) the same slot
  const suppressLab = useRef(false)
  useEffect(() => {
    const onReroll = () => {
      const next = wallSeed + 1
      setWallSeed(next)
      setSpecs(buildWall(next))
      setActiveSlot(-1)
    }
    const onSave = () => {
      setSpecs((prev) => {
        if (activeSlot < 0) return prev
        saveUserMaterial(prev[activeSlot])
        return prev
      })
    }
    const onPick = (e) => {
      const slot = e.detail.slot
      setActiveSlot(slot)
      suppressLab.current = true
      setSpecs((prev) => {
        setLab(labFromSpec(prev[slot]))
        return prev
      })
    }
    window.addEventListener('titan:mat-reroll', onReroll)
    window.addEventListener('titan:mat-save', onSave)
    window.addEventListener('titan:mat-pick', onPick)
    return () => {
      window.removeEventListener('titan:mat-reroll', onReroll)
      window.removeEventListener('titan:mat-save', onSave)
      window.removeEventListener('titan:mat-pick', onPick)
    }
  }, [wallSeed, activeSlot, setLab])
  // live editing: lab changes rewrite (and rebake) the active panel
  useEffect(() => {
    if (activeSlot < 0) return
    if (suppressLab.current) { suppressLab.current = false; return }
    setSpecs((prev) => {
      const next = prev.slice()
      next[activeSlot] = specFromLab(lab, prev[activeSlot])
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(lab)])
  // headlamp, toggled with L (kept out of leva so it feels like equipment)
  const [torch, setTorch] = useState(false)
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'KeyL' && !e.repeat && e.target.tagName !== 'INPUT') setTorch(t => !t)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // One CLUT for the session: PaletteEditor mutates the array in place and
  // flags the texture; no React state churn on per-swatch edits.
  const clutData = useMemo(() => identity332(), [])
  const clutTexture = useMemo(() => makeClutTexture(clutData), [clutData])
  // Selecting a CLUT preset loads it into the table; manual palette-editor
  // edits then apply on top until the next preset change.
  const [clutVersion, setClutVersion] = useState(0)
  useEffect(() => {
    applyClutPreset(params.clutPreset, clutData)
    clutTexture.needsUpdate = true
    setClutVersion(v => v + 1)
  }, [params.clutPreset, clutData, clutTexture])
  return (
    <>
      <Canvas
        shadows
        gl={{ powerPreference: 'high-performance', antialias: false, stencil: false, depth: false }}
        camera={{ position: [4, 2.5, 5], fov: 60 }}
        dpr={params.outputScale || 1}
      >
        {params.scene !== 'titan' ? (
        <color attach="background" args={params.scene === 'raymarch' ? ['#000000'] : skyColor(params.timeOfDay)} />
      ) : null}
        {params.scene === 'materials' ? (
          <MaterialRoom timeOfDay={params.timeOfDay} torch={torch} specs={specs} activeSlot={activeSlot} />
        ) : null}
        <CameraRig mode={params.moveMode} focalLength={params.focalLength} sceneId={params.scene} />
        <Suspense fallback={null}>
          {params.scene === 'raymarch' ? (
            <RaymarchScene timeOfDay={params.timeOfDay} torch={torch} bands={{
              visible: params.seeVisible, uv: params.seeUv, ir: params.seeIr,
              uvColor: params.uvColor, irColor: params.irColor,
              uvGain: params.uvGain, irGain: params.irGain,
            }} />
          ) : params.scene === 'titan' ? (
            <TitanScene timeOfDay={params.timeOfDay} torch={torch} bands={{
              visible: params.seeVisible, uv: params.seeUv, ir: params.seeIr,
              uvColor: params.uvColor, irColor: params.irColor,
              uvGain: params.uvGain, irGain: params.irGain,
            }} />
          ) : params.scene === 'materials' ? null : (
            <TestScene textures={params.textures} timeOfDay={params.timeOfDay} torch={torch} bands={{
              visible: params.seeVisible, uv: params.seeUv, ir: params.seeIr,
              uvColor: params.uvColor, irColor: params.irColor,
              uvGain: params.uvGain, irGain: params.irGain,
            }} />
          )}
        </Suspense>
        <VisionPipeline params={params} clutTexture={clutTexture} />
      </Canvas>
      <div className="crosshair" />
      <CameraHud />
      {params.perf ? <PerfHud /> : null}
      <PaletteEditor clutData={clutData} clutTexture={clutTexture} version={clutVersion} />
    </>
  )
}

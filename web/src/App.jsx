import { Suspense, useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import TestScene from './scene/TestScene.jsx'
import RaymarchScene from './scene/RaymarchScene.jsx'
import CameraRig from './scene/CameraRig.jsx'
import VisionPipeline from './effects/VisionPipeline.jsx'
import PaletteEditor from './palette/PaletteEditor.jsx'
import { useSensorParams } from './ui/Controls.jsx'
import { identity332, makeClutTexture } from './palette/clut.js'
import { applyClutPreset } from './palette/clutPresets.js'

export default function App() {
  const params = useSensorParams()
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
        gl={{ powerPreference: 'high-performance', antialias: false, stencil: false, depth: false }}
        camera={{ position: [4, 2.5, 5], fov: 60 }}
        dpr={1}
      >
        <color attach="background" args={['#000000']} />
        <CameraRig mode={params.moveMode} focalLength={params.focalLength} />
        <Suspense fallback={null}>
          {params.scene === 'raymarch'
            ? <RaymarchScene />
            : <TestScene textures={params.textures} bands={{
                visible: params.seeVisible, uv: params.seeUv, ir: params.seeIr,
                uvColor: params.uvColor, irColor: params.irColor,
              }} />}
        </Suspense>
        <VisionPipeline params={params} clutTexture={clutTexture} />
      </Canvas>
      <PaletteEditor clutData={clutData} clutTexture={clutTexture} version={clutVersion} />
    </>
  )
}

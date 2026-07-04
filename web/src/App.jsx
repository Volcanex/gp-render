import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import TestScene from './scene/TestScene.jsx'
import RaymarchScene from './scene/RaymarchScene.jsx'
import VisionPipeline from './effects/VisionPipeline.jsx'
import PaletteEditor from './palette/PaletteEditor.jsx'
import { useSensorParams } from './ui/Controls.jsx'
import { identity332, makeClutTexture } from './palette/clut.js'

export default function App() {
  const params = useSensorParams()
  // One CLUT for the session: PaletteEditor mutates the array in place and
  // flags the texture; no React state churn on per-swatch edits.
  const clutData = useMemo(() => identity332(), [])
  const clutTexture = useMemo(() => makeClutTexture(clutData), [clutData])
  return (
    <>
      <Canvas
        gl={{ powerPreference: 'high-performance', antialias: false, stencil: false, depth: false }}
        camera={{ position: [4, 2.5, 5], fov: 60 }}
        dpr={1}
      >
        <color attach="background" args={['#000000']} />
        <Suspense fallback={null}>
          {params.scene === 'raymarch'
            ? <RaymarchScene />
            : <TestScene bands={{
                visible: params.seeVisible, uv: params.seeUv, ir: params.seeIr,
                uvColor: params.uvColor, irColor: params.irColor,
              }} />}
        </Suspense>
        <VisionPipeline params={params} clutTexture={clutTexture} />
      </Canvas>
      <PaletteEditor clutData={clutData} clutTexture={clutTexture} />
    </>
  )
}

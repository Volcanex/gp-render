import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import TestScene from './scene/TestScene.jsx'
import VisionPipeline from './effects/VisionPipeline.jsx'
import { useSensorParams } from './ui/Controls.jsx'

export default function App() {
  const params = useSensorParams()
  return (
    <Canvas
      gl={{ powerPreference: 'high-performance', antialias: false, stencil: false, depth: false }}
      camera={{ position: [4, 2.5, 5], fov: 60 }}
      dpr={1}
    >
      <color attach="background" args={['#000000']} />
      <Suspense fallback={null}>
        <TestScene band={params.band} />
      </Suspense>
      <VisionPipeline params={params} />
    </Canvas>
  )
}

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { vertexShader, fragmentShader, computeSunState, terrainHeight, createRaymarchUniforms } from './raymarch-core.js'

const camForward = new THREE.Vector3()

export default function RaymarchScene({ timeOfDay = 14, bands = {}, torch = false }) {
  // walkable ground: CameraRig samples this so walk mode follows the terrain
  useEffect(() => {
    window.__groundFn = terrainHeight
    return () => { if (window.__groundFn === terrainHeight) window.__groundFn = null }
  }, [])

  const {
    visible = true, uv = false, ir = false,
    uvColor = '#9040ff', irColor = '#ff5020', uvGain = 1, irGain = 1,
  } = bands
  const meshRef = useRef()

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const verts = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0])
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    return geo
  }, [])

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      depthTest: true,
      depthWrite: true,
      uniforms: createRaymarchUniforms(),
    })
  }, [])

  useEffect(() => {
    material.uniforms.uSeeVis.value = visible ? 1 : 0
    material.uniforms.uSeeUv.value = uv ? 1 : 0
    material.uniforms.uSeeIr.value = ir ? 1 : 0
    material.uniforms.uUvColor.value.set(uvColor)
    material.uniforms.uIrColor.value.set(irColor)
    material.uniforms.uUvGain.value = uvGain
    material.uniforms.uIrGain.value = irGain
  }, [visible, uv, ir, uvColor, irColor, uvGain, irGain, material])

  useEffect(() => {
    material.uniforms.uTorch.value = torch ? 1 : 0
  }, [torch, material])

  useEffect(() => {
    const s = computeSunState(timeOfDay)
    material.uniforms.uSunDir.value.copy(s.dir)
    material.uniforms.uSunColor.value.copy(s.sunColor)
    material.uniforms.uAmbientColor.value.copy(s.ambientColor)
    material.uniforms.uSkyHorizon.value.copy(s.skyHorizon)
    material.uniforms.uSkyZenith.value.copy(s.skyZenith)
    material.uniforms.uDayFactor.value = s.day
  }, [timeOfDay, material])

  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.onBeforeRender = (renderer, scene, camera) => {
      material.uniforms.uCamWorld.value.copy(camera.matrixWorld)
      material.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse)
      material.uniforms.uProjA.value = camera.projectionMatrix.elements[10]
      material.uniforms.uProjB.value = camera.projectionMatrix.elements[14]
      camera.getWorldDirection(camForward)
      material.uniforms.uCamForward.value.copy(camForward)
    }
  }, [material])

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.getElapsedTime()
  })

  return <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} />
}

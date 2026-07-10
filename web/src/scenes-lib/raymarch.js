// Plain Three.js (no React/R3F/Leva) wrapper around the raymarch scene, for
// the scenes.mjs contract. Mirrors the uniform plumbing in
// ../scene/RaymarchScene.jsx — keep the two in sync when the shader's
// uniforms change (both import from raymarch-core.js so the shader/JS
// terrain/sun-state code itself can't drift).
import * as THREE from 'three'
import { vertexShader, fragmentShader, computeSunState, createRaymarchUniforms } from '../scene/raymarch-core.js'

const camForward = new THREE.Vector3()

export const raymarch = {
  id: 'raymarch',
  label: 'Raymarch World',
  params: {
    timeOfDay: { kind: 'float', default: 14, min: 0, max: 24, animatable: true, label: 'Time of day' },
    orbitAngle: { kind: 'float', default: 35, min: 0, max: 360, unit: 'deg', animatable: true, label: 'Orbit' },
    camHeight: { kind: 'float', default: 2.2, min: 0.2, max: 8, animatable: true, label: 'Camera height' },
    camDistance: { kind: 'float', default: 7, min: 2, max: 20, animatable: true, label: 'Camera distance' },
    fov: { kind: 'float', default: 60, min: 30, max: 100, label: 'FOV' },
    visible: { kind: 'bool', default: true, label: 'Visible band' },
    uv: { kind: 'bool', default: false, label: 'UV band' },
    ir: { kind: 'bool', default: false, label: 'IR band' },
    uvGain: { kind: 'float', default: 1, min: 0, max: 3, label: 'UV gain' },
    irGain: { kind: 'float', default: 1, min: 0, max: 3, label: 'IR gain' },
    torch: { kind: 'bool', default: false, label: 'Torch' },
  },

  create({ canvas }) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: true })

    const geometry = new THREE.BufferGeometry()
    const verts = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0])
    geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3))

    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      depthTest: true,
      depthWrite: true,
      uniforms: createRaymarchUniforms(),
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false

    const scene = new THREE.Scene()
    scene.add(mesh)

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000)

    mesh.onBeforeRender = (r, s, cam) => {
      material.uniforms.uCamWorld.value.copy(cam.matrixWorld)
      material.uniforms.uProjInv.value.copy(cam.projectionMatrixInverse)
      material.uniforms.uProjA.value = cam.projectionMatrix.elements[10]
      material.uniforms.uProjB.value = cam.projectionMatrix.elements[14]
      cam.getWorldDirection(camForward)
      material.uniforms.uCamForward.value.copy(camForward)
    }

    let lastWidth = 0
    let lastHeight = 0

    function renderFrame(t, params, width, height) {
      if (width !== lastWidth || height !== lastHeight) {
        renderer.setSize(width, height, false)
        camera.aspect = width / height
        lastWidth = width
        lastHeight = height
      }

      const azimuth = (params.orbitAngle * Math.PI) / 180
      camera.position.set(
        Math.cos(azimuth) * params.camDistance,
        params.camHeight,
        Math.sin(azimuth) * params.camDistance,
      )
      camera.lookAt(0, 1, 0)
      camera.fov = params.fov
      camera.updateProjectionMatrix()

      material.uniforms.uTime.value = t

      const s = computeSunState(params.timeOfDay)
      material.uniforms.uSunDir.value.copy(s.dir)
      material.uniforms.uSunColor.value.copy(s.sunColor)
      material.uniforms.uAmbientColor.value.copy(s.ambientColor)
      material.uniforms.uSkyHorizon.value.copy(s.skyHorizon)
      material.uniforms.uSkyZenith.value.copy(s.skyZenith)
      material.uniforms.uDayFactor.value = s.day

      material.uniforms.uSeeVis.value = params.visible ? 1 : 0
      material.uniforms.uSeeUv.value = params.uv ? 1 : 0
      material.uniforms.uSeeIr.value = params.ir ? 1 : 0
      material.uniforms.uUvGain.value = params.uvGain
      material.uniforms.uIrGain.value = params.irGain
      material.uniforms.uTorch.value = params.torch ? 1 : 0

      renderer.render(scene, camera)
    }

    function dispose() {
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    }

    return { renderFrame, dispose }
  },
}

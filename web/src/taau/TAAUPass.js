// TAAU pass plumbing: renders the scene at a fraction of output resolution
// with sub-pixel jitter, resolves it against history into a full-res image,
// and hands that image (plus depth) to the rest of the postprocessing chain.
//
// Depth-attachment finding (read before touching the composite step):
// EffectComposer's automatic depth-texture distribution is NOT a generic
// "whatever a pass writes becomes depthTexture" mechanism. It is wired
// specifically around RenderPass's convention:
//   - RenderPass has needsSwap = false and needsDepthBlit = true, and it
//     renders into `inputBuffer` (not outputBuffer).
//   - Composer.render() does, per pass, `inputBuffer.depthTexture =
//     this.depthTexture` (an internal, non-stable DepthTexture) BEFORE
//     calling pass.render(...). Because that assignment attaches the
//     texture as the WebGLRenderTarget's real depth attachment, whatever
//     the pass draws into inputBuffer also writes real GPU depth into
//     `this.depthTexture`.
//   - Immediately after pass.render(), if `pass.needsDepthBlit`, the
//     composer blits inputBuffer's depth into a second, stable
//     DepthTexture (`depthRenderTarget`'s texture) via
//     gl.blitFramebuffer — this is the texture actually handed to
//     depth-consuming effects via `pass.setDepthTexture(stable)`, kept
//     separate so nothing samples a texture it is simultaneously
//     rendering into.
//   - outputBuffer.depthTexture is unconditionally set to null every
//     frame, so writing gl_FragDepth into outputBuffer (the naive
//     needsSwap=true convention used by most color-only passes) would
//     land in a scratch depth renderbuffer no consumer ever reads.
//
// So TAAUPass mirrors RenderPass exactly instead of the brief's assumed
// "needsSwap=true, write outputBuffer" shape: needsSwap=false,
// needsDepthBlit=true, needsDepthTexture=true, and the composite draw
// targets `this.renderToScreen ? null : inputBuffer`. That's how the
// resolved color becomes the next pass's input with zero swap bookkeeping,
// and how our low-res depth (upsampled with a nearest lookup) ends up as
// the composer's stable depthTexture for every downstream DEPTH-attribute
// effect (DOF, N8AO, the depth-sobel outline) with no integrator-side
// wiring beyond disabling the old RenderPass. This was verified by reading
// node_modules/postprocessing/build/index.js (EffectComposer.render,
// EffectComposer.createDepthTexture/blitDepthBuffer, RenderPass.render)
// rather than assumed.
//
// this.depthTexture (sceneRT.depthTexture, render-resolution) is also
// exposed directly, and this.outputDepthTexture tracks the composer's
// stable output-resolution copy once it exists, in case a future consumer
// needs to bypass the composer's own setDepthTexture wiring.
import {
  DepthTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  NearestFilter,
  NoBlending,
  OrthographicCamera,
  Scene,
  RawShaderMaterial,
  Mesh,
  Vector2,
  WebGLRenderTarget,
  GLSL3,
} from 'three'
import { Pass } from 'postprocessing'
import { JitterSequence, applyJitter, clearJitter } from './jitter.js'
import { resolveVertexShader, resolveFragmentShader } from './resolve.glsl.js'

// RawShaderMaterial, matching resolve.glsl.js's convention: it declares its
// own `in vec3 position; in vec2 uv;` attributes and its own `precision`/
// `layout(location = 0) out` — that only compiles if three skips its normal
// ShaderMaterial auto-prefix (which redeclares position/uv itself under
// GLSL3 via '#define attribute in'). Raw also means no automatic
// modelMatrix/projectionMatrix/etc. uniforms, which this fullscreen
// triangle doesn't need anyway.
const compositeVertexShader = `
in vec3 position;
in vec2 uv;

out vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const compositeFragmentShader = `
precision highp float;

uniform sampler2D tResolved;
uniform sampler2D tDepth;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

void main() {
  fragColor = texture(tResolved, vUv);
  gl_FragDepth = texture(tDepth, vUv).r;
}
`

const HISTORY_FILTER = { bilinear: 0, catmullrom: 1 }
const DEBUG_VIEW = { off: 0, confidence: 1, clip: 2, history: 3, motion: 4 }

function makeFullscreenTriangle(material) {
  const scene = new Scene()
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const mesh = new Mesh(Pass.fullscreenGeometry, material)
  mesh.frustumCulled = false
  scene.add(mesh)
  return { scene, camera }
}

export class TAAUPass extends Pass {
  // ratioX/ratioY are independent per-axis render ratios (e.g. ratioX: 2,
  // ratioY: 1 renders at half horizontal resolution, full vertical — an
  // interlace-style reconstruction). `ratio` is accepted as a shorthand
  // that sets both axes when the caller doesn't need them to differ.
  constructor(scene, camera, { ratio, ratioX = ratio ?? 2, ratioY = ratio ?? 2 } = {}) {
    super('TAAUPass', scene, camera)
    this.mainScene = scene
    this.mainCamera = camera
    this.ratioX = ratioX
    this.ratioY = ratioY

    // see file header: this mirrors RenderPass so the composer's own
    // depth-texture distribution picks up our composite-step depth write
    this.needsSwap = false
    this.needsDepthBlit = true
    this.needsDepthTexture = true

    this.jitter = new JitterSequence()

    this.outputWidth = 1
    this.outputHeight = 1
    this.renderWidth = 1
    this.renderHeight = 1

    this.historyValid = false
    this.readHistory = null
    this.writeHistory = null

    this.sceneRT = null
    this.historyA = null
    this.historyB = null

    // the composer's stable, output-res depth texture, once one of the
    // passes it holds (possibly this one) has triggered its creation
    this.outputDepthTexture = null

    this._prevViewProjection = new Matrix4()
    this._currViewProjection = new Matrix4()
    this._havePrevVP = false

    this.resolveMaterial = new RawShaderMaterial({
      name: 'TAAUResolveMaterial',
      glslVersion: GLSL3,
      uniforms: {
        tCurrent: { value: null },
        tCurrentDepth: { value: null },
        tHistory: { value: null },
        uHistoryValid: { value: 0 },
        uJitter: { value: new Vector2() },
        uRatio: { value: Math.max(ratioX, ratioY) },
        uRenderSize: { value: new Vector2() },
        uOutputSize: { value: new Vector2() },
        uCurrInvVP: { value: new Matrix4() },
        uPrevVP: { value: new Matrix4() },
        uVarianceGamma: { value: 1.5 },
        uBlendBase: { value: 0.9 },
        uDepthDisocclusion: { value: 0.01 },
        uKernelSharpness: { value: 2.9 },
        uLumaRejection: { value: 0.5 },
        uHistoryFilter: { value: 1 },
        uDebugView: { value: 0 },
      },
      vertexShader: resolveVertexShader,
      fragmentShader: resolveFragmentShader,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    })
    this.resolveTriangle = makeFullscreenTriangle(this.resolveMaterial)

    this.compositeMaterial = new RawShaderMaterial({
      name: 'TAAUCompositeMaterial',
      glslVersion: GLSL3,
      uniforms: {
        tResolved: { value: null },
        tDepth: { value: null },
      },
      vertexShader: compositeVertexShader,
      fragmentShader: compositeFragmentShader,
      depthTest: false,
      depthWrite: true,
      blending: NoBlending,
    })
    this.compositeTriangle = makeFullscreenTriangle(this.compositeMaterial)
  }

  get texture() {
    return this.readHistory ? this.readHistory.texture : null
  }

  get depthTexture() {
    return this.sceneRT ? this.sceneRT.depthTexture : null
  }

  get varianceGamma() {
    return this.resolveMaterial.uniforms.uVarianceGamma.value
  }

  set varianceGamma(v) {
    this.resolveMaterial.uniforms.uVarianceGamma.value = v
  }

  get blendBase() {
    return this.resolveMaterial.uniforms.uBlendBase.value
  }

  set blendBase(v) {
    this.resolveMaterial.uniforms.uBlendBase.value = v
  }

  get depthDisocclusion() {
    return this.resolveMaterial.uniforms.uDepthDisocclusion.value
  }

  set depthDisocclusion(v) {
    this.resolveMaterial.uniforms.uDepthDisocclusion.value = v
  }

  get renderResolution() {
    return [this.renderWidth, this.renderHeight]
  }

  // bulk tuning entry point for UI/debug panels; only sets what's defined,
  // so callers can pass a partial options object
  configure(opts = {}) {
    const u = this.resolveMaterial.uniforms
    if (opts.blendBase !== undefined) u.uBlendBase.value = opts.blendBase
    if (opts.varianceGamma !== undefined) u.uVarianceGamma.value = opts.varianceGamma
    if (opts.kernelSharpness !== undefined) u.uKernelSharpness.value = opts.kernelSharpness
    if (opts.lumaRejection !== undefined) u.uLumaRejection.value = opts.lumaRejection
    if (opts.depthDisocclusion !== undefined) u.uDepthDisocclusion.value = opts.depthDisocclusion
    if (opts.historyFilter !== undefined) {
      u.uHistoryFilter.value = HISTORY_FILTER[opts.historyFilter] ?? opts.historyFilter
    }
    if (opts.debugView !== undefined) {
      u.uDebugView.value = DEBUG_VIEW[opts.debugView] ?? opts.debugView
    }
  }

  // ratioY defaults to ratioX so existing single-ratio callers are unaffected
  setRatio(ratioX, ratioY = ratioX) {
    this.ratioX = ratioX
    this.ratioY = ratioY
    this.setSize(this.outputWidth, this.outputHeight)
  }

  // trivial alias for callers that only care about a single number; not
  // meaningful once the two axes diverge, but harmless to read
  get ratio() {
    return this.ratioX
  }

  setSize(outputWidth, outputHeight) {
    this.outputWidth = Math.max(1, outputWidth)
    this.outputHeight = Math.max(1, outputHeight)
    this.renderWidth = Math.max(1, Math.floor(this.outputWidth / this.ratioX))
    this.renderHeight = Math.max(1, Math.floor(this.outputHeight / this.ratioY))

    this._disposeTargets()

    this.sceneRT = new WebGLRenderTarget(this.renderWidth, this.renderHeight, {
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
    })
    this.sceneRT.texture.name = 'TAAU.SceneColor'
    const sceneDepth = new DepthTexture(this.renderWidth, this.renderHeight)
    sceneDepth.type = FloatType
    sceneDepth.minFilter = NearestFilter
    sceneDepth.magFilter = NearestFilter
    sceneDepth.name = 'TAAU.SceneDepth'
    this.sceneRT.depthTexture = sceneDepth

    const historyOptions = {
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
    }
    this.historyA = new WebGLRenderTarget(this.outputWidth, this.outputHeight, historyOptions)
    this.historyA.texture.name = 'TAAU.HistoryA'
    this.historyB = new WebGLRenderTarget(this.outputWidth, this.outputHeight, historyOptions)
    this.historyB.texture.name = 'TAAU.HistoryB'
    this.readHistory = this.historyA
    this.writeHistory = this.historyB

    // phase count must track the axis with the coarser (larger) ratio —
    // that's the axis needing more distinct jitter positions to fully cover
    // its output texels — so use whichever axis's actual pixel dimensions
    // produce the larger ratio (post-floor(), not just the nominal one)
    if (this.ratioX >= this.ratioY) {
      this.jitter.configure(this.renderWidth, this.outputWidth)
    } else {
      this.jitter.configure(this.renderHeight, this.outputHeight)
    }
    this.historyValid = false
    this._havePrevVP = false

    this.resolveMaterial.uniforms.uRatio.value = Math.max(this.ratioX, this.ratioY)
    this.resolveMaterial.uniforms.uRenderSize.value.set(this.renderWidth, this.renderHeight)
    this.resolveMaterial.uniforms.uOutputSize.value.set(this.outputWidth, this.outputHeight)
  }

  render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest) {
    const scene = this.scene
    const camera = this.camera

    this.jitter.next()
    applyJitter(camera, this.jitter.x, this.jitter.y, this.renderWidth, this.renderHeight)

    const prevTarget = renderer.getRenderTarget()
    const prevAutoClear = renderer.autoClear
    renderer.autoClear = true
    renderer.setRenderTarget(this.sceneRT)
    renderer.clear()
    renderer.render(scene, camera)
    renderer.autoClear = prevAutoClear
    renderer.setRenderTarget(prevTarget)

    // restore clean (unjittered) matrices before anything downstream — or
    // this pass's own resolve math — reads camera.projectionMatrix
    clearJitter(camera)

    this._currViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    if (!this._havePrevVP) {
      this._prevViewProjection.copy(this._currViewProjection)
      this._havePrevVP = true
    }

    const resolveUniforms = this.resolveMaterial.uniforms
    resolveUniforms.tCurrent.value = this.sceneRT.texture
    resolveUniforms.tCurrentDepth.value = this.sceneRT.depthTexture
    resolveUniforms.tHistory.value = this.readHistory.texture
    resolveUniforms.uHistoryValid.value = this.historyValid ? 1 : 0
    resolveUniforms.uJitter.value.set(this.jitter.x, this.jitter.y)
    resolveUniforms.uCurrInvVP.value.copy(this._currViewProjection).invert()
    resolveUniforms.uPrevVP.value.copy(this._prevViewProjection)

    renderer.setRenderTarget(this.writeHistory)
    renderer.render(this.resolveTriangle.scene, this.resolveTriangle.camera)

    this._prevViewProjection.copy(this._currViewProjection)

    const compositeUniforms = this.compositeMaterial.uniforms
    compositeUniforms.tResolved.value = this.writeHistory.texture
    compositeUniforms.tDepth.value = this.sceneRT.depthTexture

    // mirrors RenderPass's own convention exactly (see file header) so the
    // composer's stable depthTexture is populated from our depth write
    const renderTarget = this.renderToScreen ? null : inputBuffer
    renderer.setRenderTarget(renderTarget)
    renderer.render(this.compositeTriangle.scene, this.compositeTriangle.camera)

    const swap = this.readHistory
    this.readHistory = this.writeHistory
    this.writeHistory = swap
    this.historyValid = true
  }

  // called by the composer once it has (or gains) a stable depth texture;
  // stash it so the fallback API surface stays accurate for integrators
  // that want to read composer depth without going through setDepthTexture
  setDepthTexture(depthTexture, depthPacking) {
    this.outputDepthTexture = depthTexture
  }

  getDepthTexture() {
    return this.outputDepthTexture
  }

  _disposeTargets() {
    if (this.sceneRT) {
      this.sceneRT.depthTexture?.dispose()
      this.sceneRT.dispose()
      this.sceneRT = null
    }
    if (this.historyA) {
      this.historyA.dispose()
      this.historyA = null
    }
    if (this.historyB) {
      this.historyB.dispose()
      this.historyB = null
    }
  }

  dispose() {
    this._disposeTargets()
    this.resolveMaterial.dispose()
    this.compositeMaterial.dispose()
    super.dispose()
  }
}

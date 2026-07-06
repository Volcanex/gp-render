// MaterialBaker — bakes a declarative material spec (layered procedural
// noise -> height field -> albedo ramp / roughness curve / normal map) into
// three GPU textures, using one shared fullscreen-triangle shader with a
// per-map uMode uniform.
//
// Known limitation: the noise functions in noise.glsl.js are not periodic,
// so tiles seam when wrapped with RepeatWrapping. v1 consumers work around
// this by using one tile per panel (no repeated tiling within a surface).
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  GLSL3,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoBlending,
  NoColorSpace,
  OrthographicCamera,
  RawShaderMaterial,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
  UnsignedByteType,
  WebGLRenderTarget,
} from 'three'
import { noiseGLSL } from './noise.glsl.js'

const GEN_MAP = {
  value: 0,
  perlin: 1,
  worley: 2,
  worleyEdge: 3,
  fbm: 4,
  ridged: 5,
  warp: 6,
  stripes: 7,
  checker: 8,
  simplex: 9,
  billow: 10,
  marble: 11,
  wood: 12,
  cracks: 13,
  craters: 14,
  scales: 15,
  hex: 16,
  dots: 17,
  caustics: 18,
  julia: 19,
  plasma: 20,
  terrace: 21,
  swirl: 22,
  truchet: 23,
}

const BLEND_MAP = {
  add: 0,
  mul: 1,
  overlay: 2,
  screen: 3,
  mix: 4,
  max: 5,
}

const MAX_LAYERS = 8

const MODE = { albedo: 0, roughness: 1, normal: 2 }

function makeFullscreenTriangle(material) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2))
  const scene = new Scene()
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  scene.add(mesh)
  return { scene, camera, geometry }
}

const vertexShader = /* glsl */ `
in vec3 position;
in vec2 uv;

out vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const fragmentShader = /* glsl */ `
precision highp float;
precision highp int;

${noiseGLSL}

uniform int uMode;
uniform int uLayerCount;
uniform int uGen[${MAX_LAYERS}];
uniform float uScale[${MAX_LAYERS}];
uniform int uOctaves[${MAX_LAYERS}];
uniform float uLacunarity[${MAX_LAYERS}];
uniform float uGain[${MAX_LAYERS}];
uniform int uBlend[${MAX_LAYERS}];
uniform float uAmount[${MAX_LAYERS}];
uniform float uSeed[${MAX_LAYERS}];

uniform sampler2D uRampTex;
uniform float uRoughBase;
uniform float uRoughContrast;
uniform float uNormalStrength;
uniform vec2 uTexel;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

float blendOp(int op, float h, float v, float a) {
  if (op == 0) return clamp(h + v * a, 0.0, 1.0);
  if (op == 1) return clamp(h * mix(1.0, v, a), 0.0, 1.0);
  if (op == 2) {
    float ov = h < 0.5 ? 2.0 * h * v : 1.0 - 2.0 * (1.0 - h) * (1.0 - v);
    return clamp(mix(h, ov, a), 0.0, 1.0);
  }
  if (op == 3) return clamp(mix(h, 1.0 - (1.0 - h) * (1.0 - v), a), 0.0, 1.0);
  if (op == 4) return clamp(mix(h, v, a), 0.0, 1.0);
  return clamp(max(h, v * a), 0.0, 1.0);
}

float heightAt(vec2 uv) {
  float h = 0.0;
  for (int i = 0; i < ${MAX_LAYERS}; i++) {
    if (i >= uLayerCount) break;
    float v = genEval(uGen[i], uv * uScale[i], uOctaves[i], uLacunarity[i], uGain[i], uSeed[i]);
    h = blendOp(uBlend[i], h, v, uAmount[i]);
  }
  return h;
}

void main() {
  vec2 uv = vUv;

  if (uMode == 0) {
    float h = heightAt(uv);
    fragColor = vec4(texture(uRampTex, vec2(h, 0.5)).rgb, 1.0);
    return;
  }

  if (uMode == 1) {
    float h = heightAt(uv);
    float r = clamp(uRoughBase + (h - 0.5) * uRoughContrast * 2.0, 0.04, 1.0);
    fragColor = vec4(r, r, r, 1.0);
    return;
  }

  float hL = heightAt(uv - vec2(uTexel.x, 0.0));
  float hR = heightAt(uv + vec2(uTexel.x, 0.0));
  float hD = heightAt(uv - vec2(0.0, uTexel.y));
  float hU = heightAt(uv + vec2(0.0, uTexel.y));
  float dhdx = (hR - hL) / (2.0 * uTexel.x);
  float dhdy = (hU - hD) / (2.0 * uTexel.y);
  vec3 n = normalize(vec3(-dhdx * uNormalStrength, -dhdy * uNormalStrength, 1.0)) * 0.5 + 0.5;
  fragColor = vec4(n, 1.0);
}
`

function buildRampTexture(stops) {
  const width = 256
  const data = new Uint8Array(width * 4)
  const colors = stops.map(([t, hex]) => [t, new Color(hex)])

  for (let i = 0; i < width; i++) {
    const t = i / (width - 1)
    let a = colors[0]
    let b = colors[colors.length - 1]
    for (let s = 0; s < colors.length - 1; s++) {
      if (t >= colors[s][0] && t <= colors[s + 1][0]) {
        a = colors[s]
        b = colors[s + 1]
        break
      }
    }
    const span = b[0] - a[0]
    const localT = span > 0 ? (t - a[0]) / span : 0
    const r = a[1].r + (b[1].r - a[1].r) * localT
    const g = a[1].g + (b[1].g - a[1].g) * localT
    const bch = a[1].b + (b[1].b - a[1].b) * localT

    const idx = i * 4
    data[idx] = Math.round(r * 255)
    data[idx + 1] = Math.round(g * 255)
    data[idx + 2] = Math.round(bch * 255)
    data[idx + 3] = 255
  }

  const texture = new DataTexture(data, width, 1, RGBAFormat, UnsignedByteType)
  texture.needsUpdate = true
  return texture
}

function makeRenderTarget(size) {
  return new WebGLRenderTarget(size, size, {
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    wrapS: RepeatWrapping,
    wrapT: RepeatWrapping,
    generateMipmaps: true,
    type: UnsignedByteType,
  })
}

export class MaterialBaker {
  constructor(renderer) {
    this.renderer = renderer
    this.rampTexture = null

    this.material = new RawShaderMaterial({
      name: 'MaterialBakerShader',
      glslVersion: GLSL3,
      uniforms: {
        uMode: { value: 0 },
        uLayerCount: { value: 0 },
        uGen: { value: new Array(MAX_LAYERS).fill(0) },
        uScale: { value: new Array(MAX_LAYERS).fill(1) },
        uOctaves: { value: new Array(MAX_LAYERS).fill(1) },
        uLacunarity: { value: new Array(MAX_LAYERS).fill(2) },
        uGain: { value: new Array(MAX_LAYERS).fill(0.5) },
        uBlend: { value: new Array(MAX_LAYERS).fill(0) },
        uAmount: { value: new Array(MAX_LAYERS).fill(1) },
        uSeed: { value: new Array(MAX_LAYERS).fill(0) },
        uRampTex: { value: null },
        uRoughBase: { value: 0.5 },
        uRoughContrast: { value: 0.5 },
        uNormalStrength: { value: 1 },
        uTexel: { value: { x: 1 / 512, y: 1 / 512 } },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    })
    this.triangle = makeFullscreenTriangle(this.material)
  }

  bake(spec, size = 512) {
    const u = this.material.uniforms
    const layerCount = Math.min(spec.layers.length, MAX_LAYERS)
    u.uLayerCount.value = layerCount

    for (let i = 0; i < MAX_LAYERS; i++) {
      const layer = spec.layers[i]
      if (!layer) continue
      u.uGen.value[i] = GEN_MAP[layer.gen] ?? 0
      u.uScale.value[i] = layer.scale ?? 1
      u.uOctaves.value[i] = layer.octaves ?? 1
      u.uLacunarity.value[i] = layer.lacunarity ?? 2
      u.uGain.value[i] = layer.gain ?? 0.5
      u.uBlend.value[i] = BLEND_MAP[layer.blend] ?? 0
      u.uAmount.value[i] = layer.amount ?? 1
      u.uSeed.value[i] = layer.seed ?? spec.seed ?? 0
    }

    if (this.rampTexture) this.rampTexture.dispose()
    this.rampTexture = buildRampTexture(spec.ramp)
    u.uRampTex.value = this.rampTexture

    u.uRoughBase.value = spec.roughnessBase ?? 0.5
    u.uRoughContrast.value = spec.roughnessContrast ?? 0.5
    u.uNormalStrength.value = spec.normalStrength ?? 1
    u.uTexel.value = { x: 1 / size, y: 1 / size }

    const renderer = this.renderer
    const prevTarget = renderer.getRenderTarget()

    const albedoRT = makeRenderTarget(size)
    albedoRT.texture.colorSpace = SRGBColorSpace
    const roughnessRT = makeRenderTarget(size)
    roughnessRT.texture.colorSpace = NoColorSpace
    const normalRT = makeRenderTarget(size)
    normalRT.texture.colorSpace = NoColorSpace

    const passes = [
      [MODE.albedo, albedoRT],
      [MODE.roughness, roughnessRT],
      [MODE.normal, normalRT],
    ]

    for (const [mode, rt] of passes) {
      u.uMode.value = mode
      renderer.setRenderTarget(rt)
      renderer.render(this.triangle.scene, this.triangle.camera)
    }

    renderer.setRenderTarget(prevTarget)

    return {
      albedo: albedoRT.texture,
      roughness: roughnessRT.texture,
      normal: normalRT.texture,
      dispose() {
        albedoRT.dispose()
        roughnessRT.dispose()
        normalRT.dispose()
      },
    }
  }

  dispose() {
    if (this.rampTexture) {
      this.rampTexture.dispose()
      this.rampTexture = null
    }
    this.material.dispose()
    this.triangle.geometry.dispose()
  }
}

// Pixelate + quantise + dither + palette ramp. Runs after SensorEffect
// (exposure/grain) and before EdgeOutlineEffect in the composed chain.
// colorMode 'true' is full 24-bit passthrough — no pixelate/dither/quantise,
// grain and exposure upstream and the outline downstream still apply.
import { Uniform, Vector2 } from 'three'
import { Effect } from 'postprocessing'

const DITHER_MODES = {
  none: 0, bluenoise: 1, bayer8: 2, white: 3,
  bayer4: 4, ign: 5, halftone: 6, lines: 7, edapprox: 8,
}
const COLOR_MODES = { ramp: 0, rgb: 1, rgb332: 2, true: 3 }

const fragmentShader = /* glsl */ `
uniform sampler2D uNoise;
uniform sampler2D uRamp;
uniform sampler2D uClut;
uniform float uLevels;
uniform int uDitherMode;
uniform float uDitherScale;
uniform float uPixelSize;
uniform float uIso;
uniform vec2 uDitherOffset;
uniform int uColorMode;
uniform float uIsoAgitation;

const mat4 bayer4 = mat4(
   0.0,  8.0,  2.0, 10.0,
  12.0,  4.0, 14.0,  6.0,
   3.0, 11.0,  1.0,  9.0,
  15.0,  7.0, 13.0,  5.0
);

float bayer8x8(vec2 p) {
  ivec2 c = ivec2(mod(p, 8.0));
  int qx = c.x / 4;
  int qy = c.y / 4;
  float base = bayer4[c.y - qy * 4][c.x - qx * 4] * 4.0;
  float quad = float(qy * 2 + qx);
  return base + quad;
}

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uColorMode == 3) {
    outputColor = inputColor;
    return;
  }

  vec2 sampleUv = uv;
  if (uPixelSize > 1.0) {
    vec2 cellUv = uPixelSize * texelSize;
    sampleUv = (floor(uv / cellUv) + 0.5) * cellUv;
  }

  vec4 color = uPixelSize > 1.0 ? texture2D(inputBuffer, sampleUv) : inputColor;
  vec2 fragCoord = sampleUv * resolution;

  if (uDitherMode == 8) {
    vec2 stepUv = uPixelSize > 1.0 ? uPixelSize * texelSize : texelSize;
    vec3 n = texture2D(inputBuffer, sampleUv + vec2(0.0, stepUv.y)).rgb;
    vec3 s = texture2D(inputBuffer, sampleUv - vec2(0.0, stepUv.y)).rgb;
    vec3 e = texture2D(inputBuffer, sampleUv + vec2(stepUv.x, 0.0)).rgb;
    vec3 w = texture2D(inputBuffer, sampleUv - vec2(stepUv.x, 0.0)).rgb;
    vec3 blur = (n + s + e + w) * 0.25;
    color.rgb = clamp(color.rgb + (color.rgb - blur) * 0.9, 0.0, 1.5);
  }

  float lum = dot(vec3(0.2126, 0.7152, 0.0722), color.rgb);

  float t;
  if (uDitherMode == 1 || uDitherMode == 8) {
    vec2 noiseUv = (fragCoord / uDitherScale + uDitherOffset) / 128.0;
    t = texture2D(uNoise, noiseUv).r;
  } else if (uDitherMode == 2) {
    float b = bayer8x8(fragCoord / uDitherScale + uDitherOffset);
    t = (b + 0.5) / 64.0;
  } else if (uDitherMode == 3) {
    t = hash21(floor(fragCoord / uDitherScale));
  } else if (uDitherMode == 4) {
    ivec2 c4 = ivec2(mod(fragCoord / uDitherScale + uDitherOffset, 4.0));
    float b = bayer4[c4.y][c4.x];
    t = (b + 0.5) / 16.0;
  } else if (uDitherMode == 5) {
    vec2 p = fragCoord / uDitherScale + uDitherOffset;
    t = fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
  } else if (uDitherMode == 6) {
    vec2 p = fragCoord / uDitherScale + uDitherOffset;
    vec2 c = fract(p / 6.0) - 0.5;
    t = clamp(length(c) * 2.2, 0.0, 0.999);
  } else if (uDitherMode == 7) {
    vec2 p = fragCoord / uDitherScale + uDitherOffset;
    t = fract((p.x + p.y) / 4.0);
  } else {
    t = 0.5;
  }

  float isoAmount = clamp((uIso - 100.0) / 12700.0, 0.0, 1.0) * 0.15 * uIsoAgitation;
  float jitter = hash21(fragCoord + uDitherOffset * 1.37) - 0.5;
  t = clamp(t + jitter * isoAmount, 0.0, 1.0);

  if (uColorMode == 1) {
    vec3 q3 = clamp(floor(color.rgb * (uLevels - 1.0) + t) / (uLevels - 1.0), 0.0, 1.0);
    outputColor = vec4(q3, inputColor.a);
  } else if (uColorMode == 2) {
    vec3 n332 = vec3(7.0, 7.0, 3.0);
    vec3 q3 = clamp(floor(color.rgb * n332 + t), vec3(0.0), n332);
    float idx = q3.r * 32.0 + q3.g * 4.0 + q3.b;
    outputColor = vec4(texture2D(uClut, vec2((idx + 0.5) / 256.0, 0.5)).rgb, inputColor.a);
  } else {
    float q = floor(lum * (uLevels - 1.0) + t) / (uLevels - 1.0);
    q = clamp(q, 0.0, 1.0);
    outputColor = vec4(texture2D(uRamp, vec2(q, 0.5)).rgb, inputColor.a);
  }
}
`

export class VisionEffect extends Effect {
  constructor({ noiseTexture } = {}) {
    super('VisionEffect', fragmentShader, {
      uniforms: new Map([
        ['uNoise', new Uniform(noiseTexture)],
        ['uRamp', new Uniform(null)],
        ['uClut', new Uniform(null)],
        ['uLevels', new Uniform(2)],
        ['uDitherMode', new Uniform(DITHER_MODES.bluenoise)],
        ['uDitherScale', new Uniform(1)],
        ['uPixelSize', new Uniform(1)],
        ['uIso', new Uniform(400)],
        ['uDitherOffset', new Uniform(new Vector2())],
        ['uColorMode', new Uniform(COLOR_MODES.rgb332)],
        ['uIsoAgitation', new Uniform(1)],
      ]),
    })
  }

  setParams(params) {
    this.uniforms.get('uLevels').value = Math.max(2, params.levels)
    this.uniforms.get('uDitherMode').value = DITHER_MODES[params.ditherMode] ?? DITHER_MODES.none
    this.uniforms.get('uDitherScale').value = Math.max(1, params.ditherScale)
    this.uniforms.get('uPixelSize').value = Math.max(1, params.pixelSize)
    this.uniforms.get('uIso').value = params.iso
    this.uniforms.get('uColorMode').value = COLOR_MODES[params.colorMode] ?? COLOR_MODES.rgb332
    this.uniforms.get('uIsoAgitation').value = params.isoAgitation ? 1 : 0
  }

  setRamp(texture) {
    this.uniforms.get('uRamp').value = texture
  }

  setClut(texture) {
    this.uniforms.get('uClut').value = texture
  }

  get ditherOffset() {
    return this.uniforms.get('uDitherOffset').value
  }
}

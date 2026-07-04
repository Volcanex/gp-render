// Pixelate + quantise + dither + palette ramp. Runs after SensorEffect
// (exposure/grain) and before EdgeOutlineEffect in the composed chain.
import { Uniform, Vector2 } from 'three'
import { Effect } from 'postprocessing'

const DITHER_MODES = { none: 0, bluenoise: 1, bayer8: 2, white: 3 }

const fragmentShader = /* glsl */ `
uniform sampler2D uNoise;
uniform sampler2D uRamp;
uniform float uLevels;
uniform int uDitherMode;
uniform float uDitherScale;
uniform float uPixelSize;
uniform float uIso;
uniform vec2 uDitherOffset;

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
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 sampleUv = uv;
  if (uPixelSize > 1.0) {
    vec2 cellUv = uPixelSize * texelSize;
    sampleUv = (floor(uv / cellUv) + 0.5) * cellUv;
  }

  vec4 color = uPixelSize > 1.0 ? texture2D(inputBuffer, sampleUv) : inputColor;
  vec2 fragCoord = sampleUv * resolution;

  float lum = dot(vec3(0.2126, 0.7152, 0.0722), color.rgb);

  float t;
  if (uDitherMode == 1) {
    vec2 noiseUv = (fragCoord / uDitherScale + uDitherOffset) / 128.0;
    t = texture2D(uNoise, noiseUv).r;
  } else if (uDitherMode == 2) {
    float b = bayer8x8(fragCoord / uDitherScale + uDitherOffset);
    t = (b + 0.5) / 64.0;
  } else if (uDitherMode == 3) {
    t = hash21(floor(fragCoord / uDitherScale));
  } else {
    t = 0.5;
  }

  float isoAmount = clamp((uIso - 100.0) / 12700.0, 0.0, 1.0) * 0.15;
  float jitter = hash21(fragCoord + uDitherOffset * 1.37) - 0.5;
  t = clamp(t + jitter * isoAmount, 0.0, 1.0);

  float q = floor(lum * (uLevels - 1.0) + t) / (uLevels - 1.0);
  q = clamp(q, 0.0, 1.0);

  outputColor = vec4(texture2D(uRamp, vec2(q, 0.5)).rgb, inputColor.a);
}
`

export class VisionEffect extends Effect {
  constructor({ noiseTexture } = {}) {
    super('VisionEffect', fragmentShader, {
      uniforms: new Map([
        ['uNoise', new Uniform(noiseTexture)],
        ['uRamp', new Uniform(null)],
        ['uLevels', new Uniform(2)],
        ['uDitherMode', new Uniform(DITHER_MODES.bluenoise)],
        ['uDitherScale', new Uniform(1)],
        ['uPixelSize', new Uniform(1)],
        ['uIso', new Uniform(400)],
        ['uDitherOffset', new Uniform(new Vector2())],
      ]),
    })
  }

  setParams(params) {
    this.uniforms.get('uLevels').value = Math.max(2, params.levels)
    this.uniforms.get('uDitherMode').value = DITHER_MODES[params.ditherMode] ?? DITHER_MODES.none
    this.uniforms.get('uDitherScale').value = Math.max(1, params.ditherScale)
    this.uniforms.get('uPixelSize').value = Math.max(1, params.pixelSize)
    this.uniforms.get('uIso').value = params.iso
  }

  setRamp(texture) {
    this.uniforms.get('uRamp').value = texture
  }

  get ditherOffset() {
    return this.uniforms.get('uDitherOffset').value
  }
}

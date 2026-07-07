// Screen-space crepuscular rays (GPU Gems 3 ch.13 radial march) — samples the
// depth buffer's sky mask along the line from each pixel to the sun's screen
// position, so rays only appear where geometry occludes the sky.
import { Effect, EffectAttribute } from 'postprocessing'
import { Uniform, Color, Vector2 } from 'three'

const NUM_SAMPLES = 28

const fragmentShader = /* glsl */ `
uniform float uIntensity;
uniform vec2 uSunUv;
uniform vec3 uSunColor;
uniform float uSunVisible;
uniform float uDecay;
uniform float uDensity;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uIntensity <= 0.0 || uSunVisible <= 0.0) {
    outputColor = inputColor;
    return;
  }

  const int NUM_SAMPLES = ${NUM_SAMPLES};
  vec2 delta = (uv - uSunUv) * uDensity / float(NUM_SAMPLES);
  vec2 tapUv = uv;
  float illum = 1.0;
  float accum = 0.0;

  for (int i = 0; i < NUM_SAMPLES; i++) {
    tapUv -= delta;
    vec2 sampleUv = clamp(tapUv, 0.0, 1.0);
    float depth = readDepth(sampleUv);
    float sky = depth >= 0.9999 ? 1.0 : 0.0;
    illum *= uDecay;
    accum += sky * illum;
  }

  outputColor = vec4(inputColor.rgb + uSunColor * accum * uIntensity * uSunVisible, inputColor.a);
}
`

export class LightShaftsEffect extends Effect {
  constructor() {
    super('LightShaftsEffect', fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uIntensity', new Uniform(0)],
        ['uSunUv', new Uniform(new Vector2(0.5, 0.5))],
        ['uSunColor', new Uniform(new Color(0xffffff))],
        ['uSunVisible', new Uniform(0)],
        ['uDecay', new Uniform(0.94)],
        ['uDensity', new Uniform(0.9)],
      ]),
    })
  }

  setParams(params) {
    this.uniforms.get('uIntensity').value = Math.max(0, Math.min(1, params.godRays || 0))
  }

  updateSun(uvX, uvY, visible, colorHexOrColor) {
    const uv = this.uniforms.get('uSunUv').value
    uv.x = uvX
    uv.y = uvY
    this.uniforms.get('uSunVisible').value = visible

    const colorUniform = this.uniforms.get('uSunColor').value
    if (colorHexOrColor instanceof Color) {
      colorUniform.copy(colorHexOrColor)
    } else if (colorHexOrColor !== undefined) {
      colorUniform.set(colorHexOrColor)
    }
  }
}

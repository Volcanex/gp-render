// Exposure + ISO grain — first stage in the chain, runs pre-quantise so the
// dither stage eats the noise like a real sensor feeding a bit-depth-limited ADC.
import { Effect } from 'postprocessing'
import { Uniform } from 'three'

const fragmentShader = `
uniform float uEv;
uniform float uApertureGain;
uniform float uGrainAmount;
uniform bool uAnimated;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb * exp2(uEv) * uApertureGain;

  float seed = uAnimated ? time : 0.0;
  float n = hash(vec3(gl_FragCoord.xy, seed)) * 2.0 - 1.0;

  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float weight = smoothstep(0.02, 0.25, luma) * (1.0 - smoothstep(0.6, 0.95, luma));
  c += n * weight * uGrainAmount;

  outputColor = vec4(max(c, 0.0), inputColor.a);
}
`

export class SensorEffect extends Effect {
  constructor() {
    super('SensorEffect', fragmentShader, {
      uniforms: new Map([
        ['uEv', new Uniform(0)],
        ['uApertureGain', new Uniform(1)],
        ['uGrainAmount', new Uniform(0)],
        ['uAnimated', new Uniform(true)],
      ]),
    })
  }

  setParams(params) {
    this.uniforms.get('uEv').value = params.ev
    const f = Math.max(1, params.fNumber || 5.6)
    this.uniforms.get('uApertureGain').value = (5.6 / f) ** 2
    this.uniforms.get('uGrainAmount').value = 0.35 * (params.iso - 100) / 12700
    this.uniforms.get('uAnimated').value = !!params.grainAnimated
  }
}

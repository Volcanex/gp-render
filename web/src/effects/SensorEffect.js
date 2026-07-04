// Exposure + ISO grain — first stage in the chain, runs pre-quantise so the
// dither stage eats the noise like a real sensor feeding a bit-depth-limited ADC.
import { Effect } from 'postprocessing'
import { Uniform, Vector3 } from 'three'

// Tanner Helland blackbody approximation — good enough over 2500-10000K for a
// live-adjustable WB slider, not colorimetrically exact.
function planckianRgb(kelvin) {
  const temp = kelvin / 100
  const r = temp <= 66 ? 255 : 329.698727446 * Math.pow(temp - 60, -0.1332047592)
  const g = temp <= 66
    ? 99.4708025861 * Math.log(temp) - 161.1195681661
    : 288.1221695283 * Math.pow(temp - 60, -0.0755148492)
  const b = temp >= 66 ? 255 : temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307
  return [r, g, b].map((v) => Math.min(255, Math.max(0, v)))
}

// whiteBalance is the temperature the sensor is CORRECTING FOR: light of
// exactly that Kelvin renders neutral. Gains are relative to a 6500K neutral
// reference, normalised so green stays at 1.
function wbGains(kelvin) {
  const neutral = planckianRgb(6500)
  const target = planckianRgb(kelvin)
  const gains = neutral.map((n, i) => n / target[i])
  return gains.map((v) => v / gains[1])
}

const fragmentShader = `
uniform float uEv;
uniform float uApertureGain;
uniform float uIsoGain;
uniform vec3 uWbGains;
uniform float uDynRange;
uniform float uToneS;
uniform float uGrainAmount;
uniform float uBlackLift;
uniform bool uAnimated;

float hash(vec2 p, float seed) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + seed * 269.5) * 43758.5453);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb * exp2(uEv) * uApertureGain * uIsoGain;
  c *= uWbGains;

  if (uDynRange > 0.0) {
    float luma = dot(vec3(0.2126, 0.7152, 0.0722), c);
    float lifted = clamp((log2(max(luma, 1e-6)) + uDynRange) / uDynRange, 0.0, 1.0);
    c *= lifted / max(luma, 1e-6);
  }

  if (uToneS > 0.0) {
    float luma = dot(vec3(0.2126, 0.7152, 0.0722), c);
    float t = clamp(luma, 0.0, 1.0);
    float curved = t * t * (3.0 - 2.0 * t);
    float outLuma = mix(t, curved, uToneS);
    c *= outLuma / max(luma, 1e-6);
  }

  float seed = uAnimated ? time : 0.0;
  float n = hash(gl_FragCoord.xy, seed) * 2.0 - 1.0;

  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float midtoneShape = smoothstep(0.02, 0.25, luma) * (1.0 - smoothstep(0.6, 0.95, luma));
  float shadowFloor = (1.0 - smoothstep(0.0, 0.35, luma)) * 0.9;
  float weight = max(midtoneShape, shadowFloor);
  c += n * weight * uGrainAmount;

  c += uBlackLift;

  outputColor = vec4(max(c, 0.0), inputColor.a);
}
`

export class SensorEffect extends Effect {
  constructor() {
    super('SensorEffect', fragmentShader, {
      uniforms: new Map([
        ['uEv', new Uniform(0)],
        ['uApertureGain', new Uniform(1)],
        ['uIsoGain', new Uniform(1)],
        ['uWbGains', new Uniform(new Vector3(1, 1, 1))],
        ['uDynRange', new Uniform(0)],
        ['uToneS', new Uniform(0)],
        ['uGrainAmount', new Uniform(0)],
        ['uBlackLift', new Uniform(0)],
        ['uAnimated', new Uniform(true)],
      ]),
    })
    this._manualWbGains = [1, 1, 1]
    this._autoWbGains = [1, 1, 1]
  }

  setParams(params) {
    this.uniforms.get('uEv').value = params.ev
    const f = Math.max(1, params.fNumber || 5.6)
    this.uniforms.get('uApertureGain').value = (5.6 / f) ** 2
    this.uniforms.get('uIsoGain').value = params.iso / 100
    this._manualWbGains = wbGains(params.whiteBalance || 6500)
    this._updateWbUniform()
    this.uniforms.get('uDynRange').value = params.dynamicRange || 0
    this.uniforms.get('uToneS').value = params.toneS || 0
    this.uniforms.get('uGrainAmount').value = params.grain ? 0.35 * (params.iso - 100) / 12700 : 0
    this.uniforms.get('uBlackLift').value = Math.min(0.05, 0.004 * (params.iso / 100))
    this.uniforms.get('uAnimated').value = !!params.grainAnimated
  }

  // gains3: [r, g, b] gray-world gains from metering, or null to disable.
  // Composes on top of the Kelvin gains from setParams.
  setAutoWb(gains3) {
    this._autoWbGains = gains3 || [1, 1, 1]
    this._updateWbUniform()
  }

  _updateWbUniform() {
    const [mr, mg, mb] = this._manualWbGains
    const [ar, ag, ab] = this._autoWbGains
    this.uniforms.get('uWbGains').value.set(mr * ar, mg * ag, mb * ab)
  }
}

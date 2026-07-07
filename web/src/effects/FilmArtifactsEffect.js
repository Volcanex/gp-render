// Analog film artefacts — gate weave, halation, dust & scratches. Runs after
// the sensor stage (which already models digital read noise/pedestal) and
// before quantisation. Each artefact is independently dialled and cheap
// single-pass; all sampling downstream of the weave uses the woven uv so the
// drift reads as a lens/gate wobble rather than a screen-space overlay.
import { Effect } from 'postprocessing'
import { Uniform } from 'three'

const fragmentShader = /* glsl */ `
uniform float uHalation;
uniform float uGateWeave;
uniform float uDust;
uniform float uTime;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Gate weave: two low-frequency sines per axis (0.8Hz + 1.3Hz mix) plus an
// occasional "frame-pull" vertical bump, hash-seeded per film frame.
vec2 gateWeave(float t) {
  float x = sin(t * 6.2832 * 0.8) * 0.6 + sin(t * 6.2832 * 1.3 + 1.7) * 0.4;
  float y = sin(t * 6.2832 * 0.8 + 0.9) * 0.6 + sin(t * 6.2832 * 1.3 + 2.4) * 0.4;
  vec2 drift = vec2(x, y * 0.5) * 0.002;

  float frame = floor(t * 24.0);
  float pullRoll = hash11(frame);
  float pullPhase = fract(t * 24.0);
  float pullShape = step(0.97, pullRoll)
    * smoothstep(0.0, 0.15, pullPhase)
    * (1.0 - smoothstep(0.15, 0.4, pullPhase));
  drift.y += pullShape * 0.01;

  return drift;
}

// Halation: red-orange glow where highlights punch through the emulsion and
// bounce off the film base. 5-tap wide-radius blur of thresholded brightness.
vec3 halationGlow(vec2 uv) {
  float threshold = 0.7;
  float radiusPx = 12.0;

  vec3 c0 = texture2D(inputBuffer, uv).rgb;
  vec3 c1 = texture2D(inputBuffer, uv + vec2(texelSize.x, 0.0) * radiusPx).rgb;
  vec3 c2 = texture2D(inputBuffer, uv - vec2(texelSize.x, 0.0) * radiusPx).rgb;
  vec3 c3 = texture2D(inputBuffer, uv + vec2(0.0, texelSize.y) * radiusPx).rgb;
  vec3 c4 = texture2D(inputBuffer, uv - vec2(0.0, texelSize.y) * radiusPx).rgb;

  float b0 = max(max(c0.r, c0.g), c0.b);
  float b1 = max(max(c1.r, c1.g), c1.b);
  float b2 = max(max(c2.r, c2.g), c2.b);
  float b3 = max(max(c3.r, c3.g), c3.b);
  float b4 = max(max(c4.r, c4.g), c4.b);

  vec3 accum = c0 * smoothstep(threshold, 1.0, b0)
    + c1 * smoothstep(threshold, 1.0, b1)
    + c2 * smoothstep(threshold, 1.0, b2)
    + c3 * smoothstep(threshold, 1.0, b3)
    + c4 * smoothstep(threshold, 1.0, b4);

  return accum / 5.0;
}

// Dust & scratches: per-film-frame hash-seeded dark blobs and an occasional
// vertical scratch. Kept sparse — dense only when uDust is pushed high.
vec3 dustAndScratches(vec3 color, vec2 uv, float t) {
  float frame = floor(t * 24.0);

  for (int i = 0; i < 2; i++) {
    vec2 seed = vec2(frame, float(i) * 17.0 + 3.0);
    vec2 pos = hash22(seed);
    float radius = mix(0.002, 0.006, hash12(seed + 5.0));
    float d = distance(uv, pos);
    float blob = (1.0 - smoothstep(radius * 0.5, radius, d)) * step(d, radius);
    color *= mix(1.0, 0.5, blob);
  }

  float scratchRoll = hash11(frame + 91.0);
  if (scratchRoll < 0.15) {
    float scratchX = hash11(frame + 47.0);
    float d = abs(uv.x - scratchX);
    float scratch = 1.0 - smoothstep(0.0, 0.0008, d);
    color += scratch * 0.35;
  }

  return color;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uHalation <= 0.0 && uGateWeave <= 0.0 && uDust <= 0.0) {
    outputColor = inputColor;
    return;
  }

  vec2 wuv = uv + gateWeave(uTime) * uGateWeave;
  vec3 color = texture2D(inputBuffer, wuv).rgb;

  if (uHalation > 0.0) {
    vec3 tint = halationGlow(wuv) * vec3(1.0, 0.35, 0.15);
    color += tint * uHalation;
  }

  if (uDust > 0.0) {
    color = mix(color, dustAndScratches(color, wuv, uTime), uDust);
  }

  outputColor = vec4(color, inputColor.a);
}
`

export class FilmArtifactsEffect extends Effect {
  constructor() {
    super('FilmArtifactsEffect', fragmentShader, {
      uniforms: new Map([
        ['uHalation', new Uniform(0)],
        ['uGateWeave', new Uniform(0)],
        ['uDust', new Uniform(0)],
        ['uTime', new Uniform(0)],
      ]),
    })
  }

  setParams(params = {}) {
    this.uniforms.get('uHalation').value = Math.max(0, params.halation ?? 0)
    this.uniforms.get('uGateWeave').value = Math.max(0, params.gateWeave ?? 0)
    this.uniforms.get('uDust').value = Math.max(0, params.dust ?? 0)
  }

  setTime(t) {
    this.uniforms.get('uTime').value = t
  }
}

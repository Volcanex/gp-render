// Camera-motion blur only (no per-object velocity buffer). Reconstructs each
// pixel's world position from depth, reprojects it through the previous
// frame's view-projection to get a screen-space motion vector, then streaks
// along it. Runs on the clean image, early in the chain.
import { Effect, EffectAttribute } from 'postprocessing'
import { Matrix4, Uniform } from 'three'

const MAX_SAMPLES = 16

const fragmentShader = /* glsl */ `
#define MAX_SAMPLES ${MAX_SAMPLES}

uniform float uStrength;
uniform mat4 uCurrInvVP;
uniform mat4 uPrevVP;
uniform int uSamples;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uStrength <= 0.0) {
    outputColor = inputColor;
    return;
  }

  // sky/far-plane guard: clamp depth so the reconstructed world position
  // never rides out toward infinity (same trick as the fog effect's ray march)
  float depth = min(readDepth(uv), 0.9999);
  if (depth >= 0.9999) {
    outputColor = inputColor;
    return;
  }

  // unproject this frame's pixel to world space, then reproject through last
  // frame's view-projection — the difference in uv is the motion vector
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 worldPos = uCurrInvVP * ndc;
  worldPos /= worldPos.w;

  vec4 prevClip = uPrevVP * worldPos;
  vec2 prevUv = (prevClip.xy / prevClip.w) * 0.5 + 0.5;

  vec2 motion = uv - prevUv;
  float len = length(motion);
  if (len > 0.05) motion *= 0.05 / len; // bound streaking

  vec4 accum = vec4(0.0);
  int taps = 0;
  for (int i = 0; i < MAX_SAMPLES; i++) {
    if (i >= uSamples) break;
    // spread taps across [-0.5, 0.5] of the (strength-scaled) motion vector,
    // centred on the current pixel so the blur doesn't drag the whole image
    float t = (float(i) / float(uSamples - 1)) - 0.5;
    vec2 tapUv = clamp(uv + motion * uStrength * t, vec2(0.001), vec2(0.999));
    accum += texture(inputBuffer, tapUv);
    taps++;
  }

  outputColor = accum / float(taps);
}
`

export class MotionBlurEffect extends Effect {
  constructor() {
    super('MotionBlurEffect', fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uStrength', new Uniform(0)],
        ['uCurrInvVP', new Uniform(new Matrix4())],
        ['uPrevVP', new Uniform(new Matrix4())],
        ['uSamples', new Uniform(8)],
      ]),
    })
  }

  setParams(params) {
    this.uniforms.get('uStrength').value = params.motionBlur ? Math.max(0, Math.min(1, params.motionBlur)) : 0
  }

  // called once per frame by the pipeline, which owns the matrices: this
  // frame's inverse view-projection and last frame's view-projection
  updateCamera(currInvVP, prevVP) {
    this.uniforms.get('uCurrInvVP').value.copy(currInvVP)
    this.uniforms.get('uPrevVP').value.copy(prevVP)
  }
}

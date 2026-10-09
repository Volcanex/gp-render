// Depth-based screen-space ambient occlusion: pure POST effect reading only
// the depth buffer, since render's temporal upscaler renders the scene once
// and this pass runs after it (no scene re-render, no normal buffer).
//
// Known caveat: the upscaler's nearest-upsampled depth is blocky at
// silhouettes, so this AO is deliberately soft/large-scale (radius >= 0.5).
// Fine-scale contact AO would shimmer against that blockiness.
import { Effect, EffectAttribute } from 'postprocessing'
import { Uniform, Matrix4 } from 'three'

const fragmentShader = /* glsl */ `
uniform float uIntensity;
uniform float uRadius;
uniform mat4 uProjInv;
uniform bool uEnabled;
uniform int uSamples;

// readDepth()/getViewZ() come from the shared EffectMaterial template
// (always declared, not gated behind the DEPTH attribute).

// Reconstruction reduced from a full mat4 * vec4 to a mat3 * vec3 + scaled
// translate: (uProjInv * vec4(ndc * clipW, clipW)).xyz == mat3(uProjInv) *
// (ndc * clipW) + uProjInv[3].xyz * clipW. The mat3/translate parts are
// loop-invariant (same for every tap and the center pixel) so they're
// hoisted out and passed in rather than rebuilt from uProjInv each call.
vec3 reconstructViewPos(const in vec3 ndc, const in float viewZ, const in mat3 projInv3, const in vec3 projInvT) {
  float clipW = uProjInv[2][3] * viewZ + uProjInv[3][3];
  return projInv3 * (ndc * clipW) + projInvT * clipW;
}

// Interleaved gradient noise (Jimenez 2014, "Next Generation Post Processing
// in Call of Duty: Advanced Warfare"): cheap per-pixel dither used to spin
// the sample spiral so banding turns into noise the temporal/output dither
// downstream can hide, letting the sample count drop from 12 to 8.
float interleavedGradientNoise(const in vec2 p) {
  const vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
  return fract(magic.z * fract(dot(p, magic.xy)));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (!uEnabled || uIntensity <= 0.0) {
    outputColor = inputColor;
    return;
  }

  float depth = readDepth(uv);
  if (depth >= 0.9999) {
    outputColor = inputColor;
    return;
  }

  mat3 projInv3 = mat3(uProjInv);
  vec3 projInvT = uProjInv[3].xyz;

  float viewZ0 = getViewZ(depth);
  vec3 viewPos = reconstructViewPos(vec3(uv, depth) * 2.0 - 1.0, viewZ0, projInv3, projInvT);

  vec3 dPdx = dFdx(viewPos);
  vec3 dPdy = dFdy(viewPos);
  vec3 viewNormal = normalize(cross(dPdx, dPdy));

  float viewZ = -viewPos.z;
  float screenRadius = uRadius / max(viewZ, 0.001);

  const int MAX_SAMPLES = 12;
  const float GOLDEN_ANGLE = 2.39996323;
  const float BIAS = 0.02;
  const float TWO_PI = 6.28318531;

  int sampleCount = clamp(uSamples, 1, MAX_SAMPLES);
  float baseAngle = interleavedGradientNoise(gl_FragCoord.xy) * TWO_PI;

  float occlusion = 0.0;
  for (int i = 0; i < MAX_SAMPLES; i++) {
    if (i >= sampleCount) break;

    float t = (float(i) + 0.5) / float(sampleCount);
    float angle = baseAngle + float(i) * GOLDEN_ANGLE;
    float r = sqrt(t) * screenRadius;
    vec2 offset = vec2(cos(angle), sin(angle)) * r;

    vec2 tapUv = uv + offset;
    if (tapUv.x < 0.0 || tapUv.x > 1.0 || tapUv.y < 0.0 || tapUv.y > 1.0) {
      continue;
    }

    float tapDepth = readDepth(tapUv);
    float tapViewZ = getViewZ(tapDepth);
    vec3 tapViewPos = reconstructViewPos(vec3(tapUv, tapDepth) * 2.0 - 1.0, tapViewZ, projInv3, projInvT);

    vec3 toTap = tapViewPos - viewPos;
    float dist = length(toTap);
    float closerBy = -toTap.z;
    float hemisphere = step(0.0, dot(toTap, viewNormal));

    float rangeCheck = smoothstep(0.0, 1.0, uRadius / max(dist, 0.0001));
    occlusion += hemisphere * step(BIAS, closerBy) * rangeCheck;
  }

  float ao = pow(1.0 - occlusion / float(sampleCount), 2.0);
  outputColor = vec4(inputColor.rgb * mix(1.0, ao, uIntensity), inputColor.a);
}
`

export class DepthAOEffect extends Effect {
  constructor() {
    super('DepthAOEffect', fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uIntensity', new Uniform(0)],
        ['uRadius', new Uniform(0.8)],
        ['uProjInv', new Uniform(new Matrix4())],
        ['uEnabled', new Uniform(false)],
        ['uSamples', new Uniform(8)],
      ]),
    })
  }

  setParams(params) {
    this.uniforms.get('uEnabled').value = !!params.ao
    this.uniforms.get('uIntensity').value = params.ao ? Math.max(0, Math.min(1, params.aoStrength)) : 0
  }

  setRadius(radius) {
    this.uniforms.get('uRadius').value = Math.max(0.01, radius)
  }

  setSamples(samples) {
    this.uniforms.get('uSamples').value = Math.max(1, Math.min(12, Math.round(samples)))
  }

  updateCamera(camera) {
    this.uniforms.get('uProjInv').value.copy(camera.projectionMatrixInverse)
  }
}

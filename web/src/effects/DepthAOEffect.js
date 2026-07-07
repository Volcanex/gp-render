// Depth-based screen-space ambient occlusion — pure POST effect reading only
// the depth buffer, since titan's temporal upscaler renders the scene once
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

// readDepth()/getViewZ() come from the shared EffectMaterial template
// (always declared, not gated behind the DEPTH attribute).

vec3 getViewPosition(const in vec2 uv, const in float depth) {
  float viewZ = getViewZ(depth);
  vec4 clipPosition = vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
  float clipW = uProjInv[2][3] * viewZ + uProjInv[3][3];
  clipPosition *= clipW;
  return (uProjInv * clipPosition).xyz;
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

  vec3 viewPos = getViewPosition(uv, depth);

  vec3 dPdx = dFdx(viewPos);
  vec3 dPdy = dFdy(viewPos);
  vec3 viewNormal = normalize(cross(dPdx, dPdy));

  float viewZ = -viewPos.z;
  float screenRadius = uRadius / max(viewZ, 0.001);

  const int SAMPLES = 12;
  const float GOLDEN_ANGLE = 2.39996323;
  const float BIAS = 0.02;

  float occlusion = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float t = (float(i) + 0.5) / float(SAMPLES);
    float angle = float(i) * GOLDEN_ANGLE;
    float r = sqrt(t) * screenRadius;
    vec2 offset = vec2(cos(angle), sin(angle)) * r;

    vec2 tapUv = uv + offset;
    if (tapUv.x < 0.0 || tapUv.x > 1.0 || tapUv.y < 0.0 || tapUv.y > 1.0) {
      continue;
    }

    float tapDepth = readDepth(tapUv);
    vec3 tapViewPos = getViewPosition(tapUv, tapDepth);

    vec3 toTap = tapViewPos - viewPos;
    float dist = length(toTap);
    float closerBy = -toTap.z;
    float hemisphere = step(0.0, dot(toTap, viewNormal));

    float rangeCheck = smoothstep(0.0, 1.0, uRadius / max(dist, 0.0001));
    occlusion += hemisphere * step(BIAS, closerBy) * rangeCheck;
  }

  float ao = pow(1.0 - occlusion / float(SAMPLES), 2.0);
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

  updateCamera(camera) {
    this.uniforms.get('uProjInv').value.copy(camera.projectionMatrixInverse)
  }
}

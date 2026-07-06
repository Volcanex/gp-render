// GLSL noise/fractal library for the procedural material baker.
// GLSL3-compatible, no texture reads, no uniforms — functions only.
export const noiseGLSL = /* glsl */ `
// --- hash primitives ---------------------------------------------------
// sin-free hashes, after Inigo Quilez (https://www.shadertoy.com/view/4dS3Wd)
// and Dave Hoskins (https://www.shadertoy.com/view/4djSRW)
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// --- value noise ---------------------------------------------------------
// bilinear hash interpolation with quintic fade (Quilez fade curve), [0,1]
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// --- perlin (gradient) noise ---------------------------------------------
// classic 2D gradient noise, remapped from [-1,1] to [0,1]
float perlinNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  vec2 ga = hash22(i) * 2.0 - 1.0;
  vec2 gb = hash22(i + vec2(1.0, 0.0)) * 2.0 - 1.0;
  vec2 gc = hash22(i + vec2(0.0, 1.0)) * 2.0 - 1.0;
  vec2 gd = hash22(i + vec2(1.0, 1.0)) * 2.0 - 1.0;

  float va = dot(ga, f - vec2(0.0, 0.0));
  float vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0));
  float vd = dot(gd, f - vec2(1.0, 1.0));

  float n = mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y);
  return n * 0.5 + 0.5;
}

// --- worley (cellular) noise ---------------------------------------------
// 3x3 neighbourhood search, returns (F1, F2) nearest-point distances
vec2 worley(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);

  float f1 = 8.0;
  float f2 = 8.0;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cell = vec2(float(x), float(y));
      vec2 point = hash22(i + cell);
      vec2 diff = cell + point - f;
      float dist = length(diff);
      if (dist < f1) {
        f2 = f1;
        f1 = dist;
      } else if (dist < f2) {
        f2 = dist;
      }
    }
  }

  return vec2(f1, f2);
}

// --- fractal brownian motion ---------------------------------------------
// sums 'base' noise (0 = value, 1 = perlin) over up to 8 octaves, [0,1]
float fbmGen(vec2 p, int octaves, float lacunarity, float gain, int base) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  vec2 q = p;

  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float n = (base == 0) ? valueNoise(q) : perlinNoise(q);
    sum += n * amp;
    norm += amp;
    q *= lacunarity;
    amp *= gain;
  }

  return norm > 0.0 ? sum / norm : 0.0;
}

// --- ridged multifractal --------------------------------------------------
// 1 - abs(2n - 1) per octave on perlin noise, after Quilez's ridge remap
// (https://iquilezles.org/articles/warp/ and musgrave ridged multifractal)
float ridged(vec2 p, int octaves, float lacunarity, float gain) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  vec2 q = p;

  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float n = perlinNoise(q);
    float ridge = 1.0 - abs(2.0 * n - 1.0);
    sum += ridge * amp;
    norm += amp;
    q *= lacunarity;
    amp *= gain;
  }

  return norm > 0.0 ? sum / norm : 0.0;
}

// --- dispatcher ------------------------------------------------------------
// contract entry point for the material baker; p arrives pre-scaled.
float genEval(int genType, vec2 p, int octaves, float lacunarity, float gain, float seed) {
  vec2 sp = p + vec2(seed * 17.31, seed * 9.77);

  if (genType == 0) {
    // value
    return valueNoise(sp);
  } else if (genType == 1) {
    // perlin
    return perlinNoise(sp);
  } else if (genType == 2) {
    // worley F1, clamped and scaled to fill [0,1]
    vec2 w = worley(sp);
    return clamp(w.x * 1.2, 0.0, 1.0);
  } else if (genType == 3) {
    // worleyEdge: F2 - F1, emphasises cell boundaries
    vec2 w = worley(sp);
    return clamp((w.y - w.x) * 1.2, 0.0, 1.0);
  } else if (genType == 4) {
    // fbm (perlin base)
    return fbmGen(sp, octaves, lacunarity, gain, 1);
  } else if (genType == 5) {
    // ridged multifractal
    return ridged(sp, octaves, lacunarity, gain);
  } else if (genType == 6) {
    // domain warp: fbm evaluated at a warped position
    // after Quilez's "Domain Warping" (https://iquilezles.org/articles/warp/)
    vec2 q = vec2(
      fbmGen(sp + vec2(0.0, 0.0), octaves, lacunarity, gain, 1),
      fbmGen(sp + vec2(5.2, 1.3), octaves, lacunarity, gain, 1)
    );
    vec2 r = vec2(
      fbmGen(sp + 4.0 * q + vec2(1.7, 9.2), octaves, lacunarity, gain, 1),
      fbmGen(sp + 4.0 * q + vec2(8.3, 2.8), octaves, lacunarity, gain, 1)
    );
    return fbmGen(sp + 4.0 * r, octaves, lacunarity, gain, 1);
  } else if (genType == 7) {
    // stripes: sin bands along x, wobbled by fbm
    float n = fbmGen(sp, octaves, lacunarity, gain, 1);
    return 0.5 + 0.5 * sin(sp.x * 6.2832 + n * 4.0);
  } else if (genType == 8) {
    // checker: alternating cells softened by a touch of value noise
    vec2 cell = floor(sp);
    float parity = mod(cell.x + cell.y, 2.0);
    float soften = valueNoise(sp * 4.0) * 0.15;
    return clamp(parity + soften - 0.075, 0.0, 1.0);
  }

  return 0.0;
}
`;

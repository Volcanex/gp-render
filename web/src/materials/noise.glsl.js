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

// --- helpers ---------------------------------------------------------------
vec2 rotate2(vec2 v, float a) {
  float s = sin(a), c = cos(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

// --- simplex noise ---------------------------------------------------------
// 2D simplex noise, Gustavson construction (Ashima Arts formulation), with
// the permutation-table step replaced by our own hash22 gradient lookup.
// https://github.com/ashima/webgl-noise
float simplexNoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 x1 = x0 + C.xx - i1;
  vec2 x2 = x0 + C.zz;

  vec2 g0 = hash22(i) * 2.0 - 1.0;
  vec2 g1 = hash22(i + i1) * 2.0 - 1.0;
  vec2 g2 = hash22(i + 1.0) * 2.0 - 1.0;

  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2)), 0.0);
  m = m * m;
  m = m * m;

  vec3 gdot = vec3(dot(g0, x0), dot(g1, x1), dot(g2, x2));
  float n = 70.0 * dot(m, gdot);
  return n * 0.5 + 0.5;
}

// --- billow -----------------------------------------------------------------
// fbm of abs(2n-1) per octave on perlin noise — billowy, cloud-like masses
float billow(vec2 p, int octaves, float lacunarity, float gain) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  vec2 q = p;

  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float n = perlinNoise(q);
    sum += abs(2.0 * n - 1.0) * amp;
    norm += amp;
    q *= lacunarity;
    amp *= gain;
  }

  return norm > 0.0 ? sum / norm : 0.0;
}

// --- marble ------------------------------------------------------------------
// classic Perlin marble: sine banding warped by fbm turbulence
float marble(vec2 p, int octaves, float lacunarity, float gain) {
  float n = fbmGen(p, octaves, lacunarity, gain, 1);
  return 0.5 + 0.5 * sin(p.x * 3.0 + n * 6.0);
}

// --- wood --------------------------------------------------------------------
// concentric rings from radial distance, sine-banded (no fract seams) and
// wobbled by fbm, then sharpened
float wood(vec2 p, int octaves, float lacunarity, float gain) {
  float n = fbmGen(p, octaves, lacunarity, gain, 1);
  float r = length(p) * 8.0 + n * 3.0;
  float rings = 0.5 + 0.5 * sin(r * 6.2832);
  return pow(rings, 2.0);
}

// --- cracks ------------------------------------------------------------------
// worleyEdge sharpened into thin bright crack lines on a dark ground
float cracks(vec2 p) {
  vec2 w = worley(p);
  float edge = w.y - w.x;
  float c = 1.0 - smoothstep(0.0, 0.08, edge);
  return pow(c, 1.5);
}

// --- craters -----------------------------------------------------------------
// worley F1 shaped into rimmed bowls: dark hollow interior, bright rim ring
float craters(vec2 p) {
  vec2 w = worley(p);
  float f1 = w.x;
  float rim = smoothstep(0.35, 0.5, f1) * (1.0 - smoothstep(0.5, 0.65, f1));
  float bowl = 1.0 - smoothstep(0.0, 0.5, f1);
  return clamp(bowl * 0.7 + rim, 0.0, 1.0);
}

// --- scales ------------------------------------------------------------------
// reptile scales: rows of overlapping per-cell discs, alternate rows offset
float scales(vec2 p) {
  float rows = 6.0;
  vec2 q = p * rows;
  float row = floor(q.y);
  q.x += mod(row, 2.0) * 0.5;
  vec2 cell = fract(q) - 0.5;
  float d = length(cell * vec2(1.0, 1.3));
  return 1.0 - smoothstep(0.2, 0.5, d);
}

// --- hex ---------------------------------------------------------------------
// hexagonal tiling via nearest-centre distance field, bevelled edges
// (hex distance / tiling construction after Inigo Quilez's grid articles,
// https://iquilezles.org/articles/distfunctions2d/)
vec2 hexCell(vec2 p) {
  vec2 r = vec2(1.0, 1.73205);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  return dot(a, a) < dot(b, b) ? a : b;
}

float hexTile(vec2 p) {
  vec2 gv = hexCell(p * 4.0);
  vec2 ap = abs(gv);
  float d = max(dot(ap, normalize(vec2(1.0, 1.73205))), ap.x);
  return 1.0 - smoothstep(0.3, 0.5, d);
}

// --- dots --------------------------------------------------------------------
// polka bombing: per-cell random-radius, random-offset soft disc via hash22
float dots(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p) - 0.5;
  vec2 h = hash22(i);
  float radius = 0.15 + h.x * 0.25;
  vec2 center = (h - 0.5) * 0.5;
  float d = length(f - center);
  return 1.0 - smoothstep(radius - 0.05, radius, d);
}

// --- caustics ----------------------------------------------------------------
// smooth (exponential) voronoi, after Inigo Quilez's smooth voronoi article
// (https://iquilezles.org/articles/smoothvoronoi/), squared/inverted into
// bright underwater-light webs
float smoothVoronoi(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float res = 0.0;
  float k = 32.0;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cell = vec2(float(x), float(y));
      vec2 point = hash22(i + cell);
      float d = length(cell + point - f);
      res += exp(-k * d);
    }
  }

  return -log(res) / k;
}

float caustics(vec2 p) {
  float v = smoothVoronoi(p);
  float c = 1.0 - clamp(v * 1.5, 0.0, 1.0);
  return pow(c, 2.0);
}

// --- julia -------------------------------------------------------------------
// escape-time Julia set with a smooth (continuous) iteration count, after
// Inigo Quilez's smooth iteration-count technique
// (https://iquilezles.org/articles/msetsmooth/)
float julia(vec2 p, float seed) {
  vec2 c = vec2(-0.745, 0.186) + (hash22(vec2(seed)) - 0.5) * 0.22;
  vec2 z = p * 1.5;
  float i = 0.0;

  for (int n = 0; n < 24; n++) {
    if (dot(z, z) > 4.0) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    i += 1.0;
  }

  float smoothI = i - log2(log2(dot(z, z) + 1e-6)) + 4.0;
  return clamp(smoothI / 24.0, 0.0, 1.0);
}

// --- plasma ------------------------------------------------------------------
// classic demoscene plasma: sum of sine waves at rotated frequencies, plus
// a touch of fbm for texture
float plasma(vec2 p, int octaves, float lacunarity, float gain) {
  float v = sin(p.x * 6.0 + p.y * 3.0)
          + sin(p.y * 7.0 - p.x * 2.0)
          + sin((p.x + p.y) * 5.0)
          + sin(length(p) * 8.0);
  v = v * 0.125 + 0.5;
  float n = fbmGen(p, octaves, lacunarity, gain, 1);
  return clamp(mix(v, n, 0.3), 0.0, 1.0);
}

// --- terrace -----------------------------------------------------------------
// fbm quantised into steps with a smoothed transition band — layered strata
float terrace(vec2 p, int octaves, float lacunarity, float gain) {
  float n = fbmGen(p, octaves, lacunarity, gain, 1);
  float steps = 8.0;
  float stepped = floor(n * steps) / steps;
  float frac = fract(n * steps);
  return clamp(mix(stepped, stepped + 1.0 / steps, smoothstep(0.85, 1.0, frac)), 0.0, 1.0);
}

// --- swirl -------------------------------------------------------------------
// fbm sampled through a rotational domain warp: angle grows as 1/radius
// from the enclosing cell's centre
float swirl(vec2 p, int octaves, float lacunarity, float gain) {
  vec2 center = floor(p) + 0.5;
  vec2 d = p - center;
  float r = length(d) + 1e-3;
  vec2 warped = center + rotate2(d, 0.5 / r);
  return fbmGen(warped, octaves, lacunarity, gain, 1);
}

// --- truchet -----------------------------------------------------------------
// classic truchet weave: each cell holds two quarter-circle arcs from
// opposite corners, orientation flipped per-cell by a hash
float truchet(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p) - 0.5;
  if (hash21(i) > 0.5) f.x = -f.x;
  float d1 = abs(length(f - vec2(-0.5, -0.5)) - 0.5);
  float d2 = abs(length(f - vec2(0.5, 0.5)) - 0.5);
  float d = min(d1, d2);
  return 1.0 - smoothstep(0.0, 0.08, d);
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
  } else if (genType == 9) {
    // simplex
    return simplexNoise(sp);
  } else if (genType == 10) {
    // billow
    return billow(sp, octaves, lacunarity, gain);
  } else if (genType == 11) {
    // marble
    return marble(sp, octaves, lacunarity, gain);
  } else if (genType == 12) {
    // wood
    return wood(sp, octaves, lacunarity, gain);
  } else if (genType == 13) {
    // cracks
    return cracks(sp);
  } else if (genType == 14) {
    // craters
    return craters(sp);
  } else if (genType == 15) {
    // scales
    return scales(sp);
  } else if (genType == 16) {
    // hex
    return hexTile(sp);
  } else if (genType == 17) {
    // dots
    return dots(sp);
  } else if (genType == 18) {
    // caustics
    return caustics(sp);
  } else if (genType == 19) {
    // julia
    return julia(sp, seed);
  } else if (genType == 20) {
    // plasma
    return plasma(sp, octaves, lacunarity, gain);
  } else if (genType == 21) {
    // terrace
    return terrace(sp, octaves, lacunarity, gain);
  } else if (genType == 22) {
    // swirl
    return swirl(sp, octaves, lacunarity, gain);
  } else if (genType == 23) {
    // truchet
    return truchet(sp);
  }

  return 0.0;
}
`;

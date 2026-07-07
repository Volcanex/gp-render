// three-taau — temporal resolve shader.
//
// This is the core of the upscaler: it runs once per output pixel on a
// fullscreen triangle and turns (a) this frame's jittered low-resolution
// render plus (b) the accumulated output-resolution history into a single
// anti-aliased, upscaled pixel. The recipe is assembled from several
// published techniques, each cited at its point of use:
//
//   - AMD FidelityFX Super Resolution 2 (FSR2), ffx_fsr2_upsample.h /
//     ffx_fsr2_reproject.h — MIT licensed. Source of the upsample
//     confidence weighting, closest-depth dilation and the overall
//     "current + reprojected history" resolve structure.
//   - Brian Karis, "High Quality Temporal Supersampling", SIGGRAPH 2014
//     Advances in Real-Time Rendering course notes — neighbourhood
//     clipping and the tonemapped (firefly-suppressing) blend.
//   - Marco Salvi, "An Excursion in Temporal Supersampling", GDC 2016 —
//     variance-based neighbourhood AABB (mean +/- gamma * stddev) in place
//     of a min/max clamp box.
//   - Jimenez et al., "A Journey Through Post-Processing in Filmic Games" /
//     the Call of Duty temporal AA talks — the 5-tap Catmull-Rom history
//     filter, exploiting bilinear hardware sampling to approximate bicubic
//     with 5 taps instead of 16.
//   - Karis (2014) and the Eurographics 2020 TAA survey (Xiao et al.) also
//     motivate the YCoCg working space for clipping: its axis-aligned Co/Cg
//     plane approximates chroma much better than raw RGB for box clipping.
//
// Uniform contract (provided by TAAUPass.js):
//   sampler2D tCurrent        low-res color, this frame, jittered
//   sampler2D tCurrentDepth   low-res depth, this frame, jittered
//   sampler2D tHistory        output-res accumulated history, previous frame
//   float     uHistoryValid   0 on the first frame / after a hard reset
//   vec2      uJitter         this frame's sub-pixel jitter, in render pixels
//   float     uRatio          output / render resolution ratio
//   vec2      uRenderSize     low-res render target dimensions, in texels
//   vec2      uOutputSize     history/output target dimensions, in texels
//   mat4      uCurrInvVP      unjittered current inverse view-projection
//   mat4      uPrevVP         unjittered previous view-projection
//   float     uVarianceGamma  neighbourhood clip box half-width, in std devs
//   float     uBlendBase      baseline history weight (1 - uBlendBase = base current weight)
//   float     uDepthDisocclusion  disocclusion rejection sensitivity
//   float     uKernelSharpness  confidence Gaussian falloff constant (default 2.9)
//   float     uLumaRejection    luminance-rejection reactivity, 0 (off) .. 1 (aggressive)
//   int       uHistoryFilter    history fetch filter: 0 bilinear, 1 Catmull-Rom
//   int       uDebugView        0 off, 1 confidence, 2 clip, 3 history, 4 motion

export const resolveVertexShader = /* glsl */ `
in vec3 position;
in vec2 uv;

out vec2 vUv;

void main() {
  vUv = uv;
  // Fullscreen triangle/quad: clip-space xy come straight from the
  // [-1, 1] NDC quad's own position attribute, no projection needed.
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export const resolveFragmentShader = /* glsl */ `
precision highp float;

uniform sampler2D tCurrent;
uniform sampler2D tCurrentDepth;
uniform sampler2D tHistory;

uniform float uHistoryValid;
uniform vec2 uJitter;
uniform float uRatio;
uniform vec2 uRenderSize;
uniform vec2 uOutputSize;
uniform mat4 uCurrInvVP;
uniform mat4 uPrevVP;
uniform float uVarianceGamma;
uniform float uBlendBase;
uniform float uDepthDisocclusion;
uniform float uKernelSharpness;
uniform float uLumaRejection;
uniform int uHistoryFilter;
uniform int uDebugView;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

// ---------------------------------------------------------------------
// YCoCg <-> RGB. Cheaper than YCbCr (no matrix, just adds/shifts) and its
// Co/Cg chroma plane is close enough to axis-aligned that a per-channel
// AABB clip (below) holds up much better than clipping raw RGB — this is
// the space Karis 2014 and the Eurographics 2020 TAA survey both clip in.
// ---------------------------------------------------------------------
vec3 rgb2ycocg(vec3 c) {
  float y  = dot(c, vec3(0.25, 0.5, 0.25));
  float co = dot(c, vec3(0.5, 0.0, -0.5));
  float cg = dot(c, vec3(-0.25, 0.5, -0.25));
  return vec3(y, co, cg);
}

vec3 ycocg2rgb(vec3 c) {
  float y = c.x;
  float co = c.y;
  float cg = c.z;
  return vec3(y + co - cg, y + cg, y - co - cg);
}

// Rec.709 luma, used only for the Karis tonemapped blend below (distinct
// from the YCoCg Y channel used for clipping/disocclusion — this one just
// needs to be a reasonable brightness estimate for the 1/(1+L) weighting).
float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// ---------------------------------------------------------------------
// Salvi variance clipping (GDC 2016 "An Excursion in Temporal
// Supersampling"): clip the history sample toward the neighbourhood mean
// so it lands on the boundary of an AABB in color space, rather than
// clamping it component-wise (which crushes gradients). This is the
// Karis/Salvi "clip toward center" line-box intersection.
// ---------------------------------------------------------------------
vec3 clipToAABB(vec3 boxMin, vec3 boxMax, vec3 point, vec3 center) {
  vec3 halfSize = 0.5 * (boxMax - boxMin) + 1e-5;
  vec3 toPoint = point - center;
  vec3 unitCoords = toPoint / halfSize;
  float maxUnit = max(abs(unitCoords.x), max(abs(unitCoords.y), abs(unitCoords.z)));
  if (maxUnit > 1.0) {
    return center + toPoint / maxUnit;
  }
  return point;
}

// ---------------------------------------------------------------------
// 5-tap Catmull-Rom (Jimenez 2016 / Call of Duty temporal AA talks): a
// bicubic Catmull-Rom filter reconstructed from 5 bilinear hardware taps
// instead of 16 point taps. The 4 corner taps of the full 3x3 bicubic
// kernel carry the least weight, so they're dropped here and the
// remaining 5 weights are renormalized to sum to 1.
// ---------------------------------------------------------------------
vec3 sampleCatmullRom5Tap(sampler2D tex, vec2 uv, vec2 texSize) {
  vec2 samplePos = uv * texSize;
  vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
  vec2 f = samplePos - texPos1;

  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);

  // w1 and w2 are combined into a single bilinear-filtered tap, since
  // hardware bilinear sampling gives us that weighted average for free.
  vec2 w12 = w1 + w2;
  vec2 offset12 = w2 / w12;

  vec2 texPos0 = (texPos1 - 1.0) / texSize;
  vec2 texPos3 = (texPos1 + 2.0) / texSize;
  vec2 texPos12 = (texPos1 + offset12) / texSize;

  vec3 result = vec3(0.0);
  float weightSum = 0.0;

  vec2 tap;
  float w;

  tap = vec2(texPos12.x, texPos0.y);  w = w12.x * w0.y;  result += texture(tex, tap).rgb * w; weightSum += w;
  tap = vec2(texPos0.x, texPos12.y);  w = w0.x * w12.y;  result += texture(tex, tap).rgb * w; weightSum += w;
  tap = vec2(texPos12.x, texPos12.y); w = w12.x * w12.y; result += texture(tex, tap).rgb * w; weightSum += w;
  tap = vec2(texPos3.x, texPos12.y);  w = w3.x * w12.y;  result += texture(tex, tap).rgb * w; weightSum += w;
  tap = vec2(texPos12.x, texPos3.y);  w = w12.x * w3.y;  result += texture(tex, tap).rgb * w; weightSum += w;

  return result / weightSum;
}

void main() {
  vec2 renderTexel = 1.0 / uRenderSize;
  ivec2 renderSizeI = ivec2(uRenderSize);

  // -------------------------------------------------------------------
  // Core upsampling insight (FSR2 ffx_fsr2_upsample.h): NEVER resample
  // the current frame. tCurrent was rendered through a projection
  // shifted by uJitter (see jitter.js applyJitter), so its samples don't
  // sit at texel centers in "true", unjittered scene space — but that's
  // fine, because reconstruction doesn't need to move them there. It
  // needs two honest, matching things instead: the RAW sample (no
  // filtering) and the TRUE location that sample was actually taken at.
  // The latter is exactly what the sampleConfidence Gaussian below
  // computes, from this same uJitter. An earlier version of this shader
  // instead resampled tCurrent at a "jitter-cancelling" sub-pixel uv
  // offset via bilinear texture() — geometrically reasonable-sounding,
  // but every such fetch is a bilinear blend of neighbouring texels, and
  // that blur gets deposited into history and compounds every frame it
  // accumulates, converging to a ~1px tent blur. That is precisely why
  // TAAU at ratio 1:1 came out blurrier than TAAU-off: the reprojection
  // math was correct, but the thing being reprojected had already been
  // pre-filtered. Fix: texelFetch the raw texel; let sampleConfidence
  // carry the sub-pixel location information instead of the color read.
  // -------------------------------------------------------------------
  ivec2 texelCoord = clamp(ivec2(vUv * uRenderSize), ivec2(0), renderSizeI - ivec2(1));
  vec3 currentColor = texelFetch(tCurrent, texelCoord, 0).rgb;

  // First frame (or a forced reset): nothing to reproject against yet.
  if (uHistoryValid < 0.5) {
    fragColor = vec4(currentColor, 1.0);
    return;
  }

  // -------------------------------------------------------------------
  // 1. Upsample confidence (FSR2 ffx_fsr2_upsample.h): how close is this
  // output pixel's center to the TRUE location of the raw sample fetched
  // above? The raw texel at texelCoord was rendered at grid position
  // texelCoord + 0.5, shifted by this frame's jitter — so its honest
  // location is (texelCoord + 0.5 + uJitter), which is what this
  // distance measures against the output pixel's own (unjittered)
  // position. Render and output share the same normalized [0,1] frame,
  // so vUv * uRenderSize gives this output pixel's position in
  // continuous render-pixel units.
  // -------------------------------------------------------------------
  vec2 renderPos = vUv * uRenderSize;
  // texelCoord is exactly the texel currentColor was fetched from above —
  // its true sample location must be derived from that SAME texel, not a
  // separately re-derived "nearest sample" search, or the raw color and
  // its confidence weight could end up describing two different samples.
  vec2 trueSamplePos = vec2(texelCoord) + 0.5 + uJitter;
  vec2 sampleDelta = renderPos - trueSamplePos;
  float sampleDist2 = dot(sampleDelta, sampleDelta);
  // uKernelSharpness replaces FSR2's fixed 2.9 falloff constant: higher
  // means only output pixels very close to a true jittered sample trust
  // the current frame (sharper reconstruction, slower to converge on
  // fresh detail); lower widens that trust radius (softer, less shimmer).
  float sampleConfidence = exp(-uKernelSharpness * sampleDist2);

  // -------------------------------------------------------------------
  // 2. Closest-depth dilation over a 3x3 render-pixel neighbourhood
  // (Karis 2014 / Tardif's "motion vectors in disoccluded regions"
  // approach, used in FSR2's reprojection pass): reproject using the
  // depth/position of whichever tap is nearest the camera, not the
  // center tap, so thin foreground edges get correct reprojection
  // instead of inheriting background motion. Raw texelFetch, same
  // reasoning as the current-color fetch above (never resample depth
  // either). The resulting texel-center uv ignores this frame's
  // sub-pixel jitter — a tolerable approximation for reprojection, since
  // uCurrInvVP is itself the unjittered inverse view-projection and only
  // needs a same-pixel depth estimate, not a sub-pixel-exact one.
  // -------------------------------------------------------------------
  float closestDepth = 1.0;
  ivec2 closestTexel = texelCoord;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 tapCoord = clamp(texelCoord + ivec2(x, y), ivec2(0), renderSizeI - ivec2(1));
      float d = texelFetch(tCurrentDepth, tapCoord, 0).r;
      if (d < closestDepth) {
        closestDepth = d;
        closestTexel = tapCoord;
      }
    }
  }
  vec2 dilatedUv = (vec2(closestTexel) + 0.5) * renderTexel;

  // -------------------------------------------------------------------
  // 3. Reprojection: unproject the dilated depth with this frame's
  // (unjittered) inverse view-projection to get a world position, then
  // reproject with last frame's (unjittered) view-projection to find
  // where this surface point was in the history buffer.
  // -------------------------------------------------------------------
  vec3 ndc = vec3(dilatedUv * 2.0 - 1.0, closestDepth * 2.0 - 1.0);
  vec4 worldPos = uCurrInvVP * vec4(ndc, 1.0);
  worldPos /= worldPos.w;

  vec4 prevClip = uPrevVP * worldPos;
  vec2 prevUv = (prevClip.xy / prevClip.w) * 0.5 + 0.5;

  bool offScreen = any(lessThan(prevUv, vec2(0.0))) || any(greaterThan(prevUv, vec2(1.0)));

  // -------------------------------------------------------------------
  // 4. History fetch: 5-tap Catmull-Rom (Jimenez 2016) rather than a
  // plain bilinear tap, so the history doesn't get progressively blurred
  // out by repeated resampling every frame. uHistoryFilter exposes the
  // plain-bilinear fetch too, since Catmull-Rom's sharper reconstruction
  // can ring on some content — the tuning surface for that tradeoff.
  //
  // Static-exact fetch (anti-blur): ANY resampling filter — Catmull-Rom
  // or bilinear — is a low-pass when the sample point doesn't land
  // exactly on a texel center, and it gets reapplied every single frame
  // history accumulates. On a static camera the reprojection keeps
  // landing at the same sub-texel offset, so that low-pass compounds
  // frame after frame and the image slowly blurs even though nothing is
  // moving — the classic "sharpest while panning, soft when still" TAA
  // symptom. When the reprojection delta is negligible (sub-1/20th of an
  // output pixel), skip the filtered fetch entirely and take a single
  // plain texture tap at vUv: with bilinear sampling exactly on a texel
  // center that degenerates to reading the stored texel unfiltered, so a
  // still camera stops losing sharpness to repeated resampling and is at
  // least as crisp as a moving one.
  // -------------------------------------------------------------------
  vec2 motionPx = (prevUv - vUv) * uOutputSize;
  bool reprojectionStatic = dot(motionPx, motionPx) < 0.0025;
  vec3 historyColor = reprojectionStatic
    ? texture(tHistory, vUv).rgb
    : (uHistoryFilter == 1
        ? sampleCatmullRom5Tap(tHistory, prevUv, uOutputSize)
        : texture(tHistory, prevUv).rgb);
  vec3 historyYCoCg = rgb2ycocg(historyColor);

  // -------------------------------------------------------------------
  // 5. Neighbourhood statistics (Salvi 2016): mean and stddev of a 3x3
  // YCoCg neighbourhood around the *undilated* current sample, used to
  // build a variance-based clip box (mean +/- uVarianceGamma * stddev)
  // instead of a hard min/max clamp. Raw texelFetch, same reasoning as
  // the current-color fetch above — a filtered read here would make the
  // clip box itself carry the same compounding blur.
  // -------------------------------------------------------------------
  vec3 moment1 = vec3(0.0);
  vec3 moment2 = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 tapCoord = clamp(texelCoord + ivec2(x, y), ivec2(0), renderSizeI - ivec2(1));
      vec3 tapYCoCg = rgb2ycocg(texelFetch(tCurrent, tapCoord, 0).rgb);
      moment1 += tapYCoCg;
      moment2 += tapYCoCg * tapYCoCg;
    }
  }
  vec3 neighbourhoodMean = moment1 / 9.0;
  vec3 neighbourhoodVariance = max(moment2 / 9.0 - neighbourhoodMean * neighbourhoodMean, vec3(0.0));
  vec3 neighbourhoodSigma = sqrt(neighbourhoodVariance);

  vec3 aabbMin = neighbourhoodMean - uVarianceGamma * neighbourhoodSigma;
  vec3 aabbMax = neighbourhoodMean + uVarianceGamma * neighbourhoodSigma;

  // -------------------------------------------------------------------
  // 6. Clip the history sample into that box (line-to-box clip toward
  // the neighbourhood mean, not a per-channel clamp — clamping crushes
  // saturated/detailed regions that clipping preserves).
  // -------------------------------------------------------------------
  vec3 clippedYCoCg = clipToAABB(aabbMin, aabbMax, historyYCoCg, neighbourhoodMean);
  vec3 clippedHistory = ycocg2rgb(clippedYCoCg);

  // -------------------------------------------------------------------
  // 7. Disocclusion. There's no stored previous-frame depth in this v1
  // (see module doc), so true depth-based disocclusion isn't available;
  // instead reject via a soft luminance-change test between the current
  // sample and the *clipped* history — a large relative Y jump means the
  // clip box had to move the history a long way, i.e. this surface
  // wasn't actually visible last frame. uDepthDisocclusion doubles as
  // the sensitivity threshold for this fallback (documented deviation
  // from a true depth-disocclusion test — see resolve.glsl.js docblock).
  // -------------------------------------------------------------------
  float currentY = rgb2ycocg(currentColor).x;
  float clippedY = clippedYCoCg.x;
  float relativeLumaChange = abs(currentY - clippedY) / max(max(currentY, clippedY), 0.2);
  // uLumaRejection scales how much this test is allowed to react at all:
  // 0 disables it outright (maximum stability, more ghosting on shading
  // changes), 1 lets it fire at full strength (fast response, more shimmer).
  float disocclusion = smoothstep(uDepthDisocclusion, uDepthDisocclusion * 10.0, relativeLumaChange) * uLumaRejection;
  // Off-screen reprojection is an unambiguous full disocclusion regardless
  // of the luma-rejection dial — there is no history to speak of.
  disocclusion = offScreen ? 1.0 : disocclusion;

  // -------------------------------------------------------------------
  // 8 & 9. Blend weight: pixels near an actual jittered sample trust the
  // current frame a little more (upsample confidence); disoccluded
  // pixels trust it a lot more (disocclusionBoost pushes the weight
  // toward saturation so rejected history doesn't ghost through).
  // uBlendBase sets the baseline history weight when both confidence and
  // disocclusion are low.
  // -------------------------------------------------------------------
  // Confidence scales the current-frame deposit DOWN when the sample is
  // interpolated, never up: an earlier formulation swung the weight between
  // ~0.18 and 0.5 with the jitter cycle, which pulsed the whole image every
  // frame (visible wobble) and blended blurry interpolated samples at high
  // weight (persistent fuzz). FSR2's accumulation is monotone in confidence
  // for the same reason.
  float baseWeight = (1.0 - uBlendBase) * mix(0.25, 1.0, sampleConfidence);
  float disocclusionBoost = mix(1.0, 20.0, disocclusion);
  float wCurrent = clamp(baseWeight * disocclusionBoost, 0.01, 1.0);

  // Karis tonemapped blend (SIGGRAPH 2014): weight both colors by
  // 1/(1+luma) before mixing and invert afterward, so a single bright
  // firefly in either the current sample or the history can't dominate
  // the average the way it would under a plain linear mix.
  vec3 toneCurrent = currentColor / (1.0 + luma(currentColor));
  vec3 toneHistory = clippedHistory / (1.0 + luma(clippedHistory));
  vec3 blended = mix(toneHistory, toneCurrent, wCurrent);
  // Guard the inverse tonemap's denominator: luma(blended) can reach or
  // exceed 1 for very bright/emissive input, which would divide by zero
  // or flip sign. Clamping it keeps the output finite and non-negative.
  float inverseDenom = max(1.0 - luma(blended), 1e-3);
  vec3 result = max(blended / inverseDenom, vec3(0.0));

  // Diagnostic views replace the final colour outright — each isolates
  // one stage of the resolve so instability/blur can be attributed to a
  // specific step rather than guessed at from the final image.
  if (uDebugView == 1) {
    // Confidence: how much this output pixel trusts the current frame's
    // jittered sample, before any history blending — bright = near a true
    // sample (sharp, fast-converging), dark = interpolated (softer).
    fragColor = vec4(vec3(sampleConfidence), 1.0);
    return;
  }
  if (uDebugView == 2) {
    // Clip amount: how far the variance clip had to move the history
    // sample in YCoCg space, as a red overlay on the dimmed current
    // image — hotspots mark where rectification is fighting the history
    // hardest, i.e. where instability/ghosting is most likely.
    float clipAmount = length(historyYCoCg - clippedYCoCg) * 4.0;
    fragColor = vec4(currentColor * 0.3 + vec3(clipAmount, 0.0, 0.0), 1.0);
    return;
  }
  if (uDebugView == 3) {
    // Raw reprojected history, pre-clip: any ghosting is visible directly,
    // unmasked by the rectification step that would otherwise hide it.
    fragColor = vec4(historyColor, 1.0);
    return;
  }
  if (uDebugView == 4) {
    // Motion: reprojection delta magnitude (history uv vs. this frame's
    // uv), exaggerated x50 and shown in green — large values mark where
    // reprojection itself is likely wrong (bad motion, occlusion edges).
    float motion = length(prevUv - vUv) * 50.0;
    fragColor = vec4(0.0, motion, 0.0, 1.0);
    return;
  }

  fragColor = vec4(result, 1.0);
}
`

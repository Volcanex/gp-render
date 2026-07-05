// three-taau — temporal anti-aliased upscaling for WebGL2 / three.js.
// FSR2-class recipe in pure fragment shaders: jittered low-res render,
// camera-reprojected output-resolution history with YCoCg variance clipping,
// RCAS sharpening. Built inside the titan explorer; extraction target: the
// standalone MIT package `three-taau`. Keep this directory free of imports
// from the rest of the app.
export { TAAUPass } from './TAAUPass.js'
export { RCASEffect } from './RCASEffect.js'
export { JitterSequence, halton, jitterPhaseCount, applyJitter, clearJitter } from './jitter.js'

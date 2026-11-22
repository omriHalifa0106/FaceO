// Copies the face-api model weights (public/models) and the TensorFlow.js WASM
// binaries (public/wasm) so they are served from our own origin (no third-party
// CDN sees users' traffic). The WASM version must match the tfjs bundled in
// @vladmandic/face-api (4.22.0), hence the exact pin in package.json.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', '@vladmandic', 'face-api', 'model')
const dest = join(root, 'public', 'models')
const MODELS = ['ssd_mobilenetv1_model', 'face_landmark_68_model', 'face_recognition_model']

if (!existsSync(src)) {
  console.error('[models] @vladmandic/face-api is not installed; run npm install')
  process.exit(1)
}
mkdirSync(dest, { recursive: true })
for (const name of MODELS) {
  for (const file of [`${name}-weights_manifest.json`, `${name}.bin`]) {
    const target = join(dest, file)
    if (!existsSync(target)) cpSync(join(src, file), target)
  }
}

const wasmSrc = join(root, 'node_modules', '@tensorflow', 'tfjs-backend-wasm', 'dist')
const wasmDest = join(root, 'public', 'wasm')
if (!existsSync(wasmSrc)) {
  console.error('[models] @tensorflow/tfjs-backend-wasm is not installed; run npm install')
  process.exit(1)
}
mkdirSync(wasmDest, { recursive: true })
for (const file of ['tfjs-backend-wasm.wasm', 'tfjs-backend-wasm-simd.wasm', 'tfjs-backend-wasm-threaded-simd.wasm']) {
  const target = join(wasmDest, file)
  if (!existsSync(target)) cpSync(join(wasmSrc, file), target)
}
console.log(`[models] face models ready in public/models, wasm in public/wasm`)

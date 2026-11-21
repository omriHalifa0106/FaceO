// Copies the face-api model weights FaceO needs into public/models so they are
// served from our own origin (no third-party CDN sees users' traffic).
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
console.log(`[models] face models ready in public/models`)

// Generates PNG copies of the brand SVG icons for platforms that don't accept
// SVG (notably iOS apple-touch-icon — Safari ignores SVG and falls back to a
// generic browser screenshot). Run after editing icon-*.svg:
//   node scripts/generate-icons.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ICONS_DIR = resolve(__dirname, '..', 'public', 'icons')

// Sizes Apple actually uses for home-screen icons + the manifest standards.
const SIZES = [144, 152, 167, 180, 192, 512]

for (const size of SIZES) {
  // Prefer a same-size SVG source when one exists; fall back to 512 (the SVG
  // is vector so this only affects rasterization quality at smaller sizes,
  // and 512 → smaller is sharper than 144 → bigger).
  const candidates = [`icon-${size}x${size}.svg`, 'icon-512x512.svg']
  let svg = null
  let used = null
  for (const name of candidates) {
    try {
      svg = await readFile(resolve(ICONS_DIR, name))
      used = name
      break
    } catch {}
  }
  if (!svg) {
    console.warn(`[icons] no SVG source for ${size}x${size}, skipping`)
    continue
  }

  const out = resolve(ICONS_DIR, `icon-${size}x${size}.png`)
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(out)
  console.log(`[icons] ${used} → icon-${size}x${size}.png`)
}

// Also write a 180x180 alias as apple-touch-icon.png at the public root —
// iOS Safari probes that exact filename when no <link> is found.
const root180 = resolve(ICONS_DIR, '..', 'apple-touch-icon.png')
const svg512 = await readFile(resolve(ICONS_DIR, 'icon-512x512.svg'))
await sharp(svg512, { density: 384 })
  .resize(180, 180)
  .png({ compressionLevel: 9 })
  .toFile(root180)
console.log('[icons] icon-512x512.svg → /apple-touch-icon.png (180x180)')

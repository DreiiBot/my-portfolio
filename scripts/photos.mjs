// Turns the original photos in photos/ into the WebP files the page uses (src/assets/photos/).
// Each photo is resized with Lanczos to the largest size it's shown at (2x for retina) and
// lightly sharpened. The two small palm-tree photos are upscaled, so they get a stronger pass.
// The hero portrait is also cut out of its background with MODNet, a portrait-matting model
// (Apache-2.0) that runs locally; the first run downloads it (about 25 MB) from Hugging Face.
// Run with `npm run photos` after adding or replacing an original.
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pipeline } from '@huggingface/transformers'
import sharp from 'sharp'

const src = resolve('photos')
const out = resolve('src/assets/photos')

const jobs = [
  { name: 'night', width: 1200 },
  // A face crop for the small avatars in the dock and buttons.
  { name: 'smile', as: 'avatar', extract: { left: 540, top: 150, width: 860, height: 860 }, width: 112 },
  { name: 'turtleneck', width: 900 },
  { name: 'denim-front', width: 900 },
  { name: 'denim-side', width: 900 },
  { name: 'bench', width: 900 },
  { name: 'walkway', width: 900 },
  { name: 'forest-walk', width: 1200 },
  { name: 'forest-road', width: 1200 },
  { name: 'palm-front', width: 900, upscale: true },
  { name: 'palm-side', width: 900, upscale: true },
]

await mkdir(out, { recursive: true })
for (const job of jobs) {
  let img = sharp(resolve(src, `${job.name}.jpg`)).rotate()
  if (job.extract) img = img.extract(job.extract)
  img = img.resize({ width: job.width, kernel: 'lanczos3', withoutEnlargement: !job.upscale })
  img = job.upscale ? img.sharpen({ sigma: 1.1, m1: 0.6, m2: 2.4 }) : img.sharpen({ sigma: 0.6 })
  const file = resolve(out, `${job.as ?? job.name}.webp`)
  const info = await img.webp({ quality: 84, effort: 6 }).toFile(file)
  console.log(`${job.as ?? job.name}.webp  ${info.width}x${info.height}  ${Math.round(info.size / 1024)} KB`)
}

// Product screenshots in photos/screens/. The website captures (1440x900, from headless Chrome)
// carry a 15px scrollbar on the right, which is trimmed off. From the app promos (1080x1920
// posters), only the phone is kept.
const screens = [
  { file: 'posibli-site.png', trim: { right: 15 } },
  { file: 'yuaskme-site.png', trim: { right: 15 } },
  { file: 'orange-portal-site.png', trim: { right: 15 } },
  { file: 'vistay-site.png', trim: { right: 15 } },
  { file: 'synapsego-site.png', trim: { right: 15 } },
  { file: 'picklebook-site.webp', trim: { top: 6 } },
  { file: 'picklebook-app-schedule.webp', phone: true },
  { file: 'synapsego-app-home.webp', phone: true },
]
for (const s of screens) {
  const path = resolve(src, 'screens', s.file)
  const meta = await sharp(path).metadata()
  let img = sharp(path)
  if (s.phone) img = img.extract({ left: 296, top: 488, width: 528, height: 1066 })
  if (s.trim) {
    const top = s.trim.top ?? 0
    img = img.extract({ left: 0, top, width: meta.width - (s.trim.right ?? 0), height: meta.height - top })
  }
  const name = s.file.replace(/\.\w+$/, '')
  const info = await img
    .resize({ width: s.phone ? 528 : 1440, kernel: 'lanczos3', withoutEnlargement: true })
    .webp({ quality: 86, effort: 6 })
    .toFile(resolve(out, `${name}.webp`))
  console.log(`${name}.webp  ${info.width}x${info.height}  ${Math.round(info.size / 1024)} KB`)
}

// Hero: the suit portrait with its wall removed, saved with transparency.
const matte = await pipeline('background-removal', 'Xenova/modnet', { dtype: 'fp32' })
let cut = await matte(resolve(src, 'suit.jpg'))
if (Array.isArray(cut)) cut = cut[0]
const alpha = Buffer.alloc(cut.width * cut.height)
for (let i = 0; i < alpha.length; i++) alpha[i] = cut.data[i * cut.channels + cut.channels - 1]
// Pulls the edge in by 2px and softens it, so no light fringe from the wall is left around the
// suit. (sharp's morphology works on dark shapes: dilate is what shrinks the opaque area.)
const edge = await sharp(alpha, { raw: { width: cut.width, height: cut.height, channels: 1 } })
  .dilate(2)
  .blur(0.8)
  .toColourspace('b-w')
  .png()
  .toBuffer()
const info = await sharp(resolve(src, 'suit.jpg'))
  .joinChannel(edge)
  .resize({ width: 1080, kernel: 'lanczos3' })
  .sharpen({ sigma: 0.6 })
  .webp({ quality: 86, alphaQuality: 90, effort: 6 })
  .toFile(resolve(out, 'hero-cutout.webp'))
console.log(`hero-cutout.webp  ${info.width}x${info.height}  ${Math.round(info.size / 1024)} KB`)

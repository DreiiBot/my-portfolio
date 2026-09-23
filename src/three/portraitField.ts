// A halftone portrait made of points. Two photographs are sampled on a grid; each point
// knows where it sits in the grey portrait (A), the red portrait (B) and a loose scatter.
// The page drives three numbers — mix (A→B), scatter, and the group's placement — and the
// shader does the rest.
import * as THREE from 'three'

export interface FieldTarget {
  mix: number // 0 = grey portrait, 1 = red portrait
  scatter: number // 0 = assembled, 1 = drifting field
  x: number // world units
  y: number
  scale: number
  turn: number // radians, the portrait's baseline yaw
  opacity: number
}

export interface PortraitField {
  target: FieldTarget
  visibleWidth: () => number
  dispose: () => void
}

interface Options {
  a: string
  b: string
  reducedMotion: boolean
  onReady?: () => void
}

interface Sample {
  x: number
  y: number
  z: number
  r: number
  g: number
  b: number
  l: number
}

const SIZE = 2.4 // world units the photo spans
const CAM_Z = 7
const FOV = 30
// Dot diameter as a multiple of the grid spacing, before each dot's own size.
const DOT = 0.96

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })

// A rough bust volume so the portrait has real depth when it turns: a head ellipsoid
// and a shoulder cylinder, plus a little relief from the photo's own light.
const bustDepth = (u: number, v: number, head: [number, number], l: number) => {
  const hx = (u - head[0]) / 0.17
  const hy = (v - head[1]) / 0.22
  const headZ = 0.42 * Math.sqrt(Math.max(0, 1 - hx * hx - hy * hy))
  const tx = (u - 0.5) / 0.46
  const torsoZ = v > 0.42 ? 0.3 * Math.sqrt(Math.max(0, 1 - tx * tx)) : 0
  return Math.max(headZ, torsoZ) + (l - 0.5) * 0.08
}

// Keeps a pixel when it differs from the background at the two ends of its own row.
// The row average follows the studio falloff, which a single corner color would not.
function sampleImage(
  img: HTMLImageElement,
  grid: number,
  head: [number, number],
  isSubject: (px: number[], bg: number[]) => boolean,
): Sample[] {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = grid
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, grid, grid)
  const data = ctx.getImageData(0, 0, grid, grid).data
  const at = (x: number, y: number) => {
    const i = (y * grid + x) * 4
    return [data[i], data[i + 1], data[i + 2]]
  }
  const edge = Math.max(2, Math.round(grid * 0.02))
  const out: Sample[] = []
  for (let y = 0; y < grid; y++) {
    const bg = [0, 0, 0]
    for (let k = 0; k < edge; k++) {
      const l = at(k, y)
      const r = at(grid - 1 - k, y)
      for (let c = 0; c < 3; c++) bg[c] += (l[c] + r[c]) / (edge * 2)
    }
    for (let x = 0; x < grid; x++) {
      const px = at(x, y)
      if (!isSubject(px, bg)) continue
      const u = x / (grid - 1)
      const v = y / (grid - 1)
      const l = (0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]) / 255
      out.push({
        x: (u - 0.5) * SIZE,
        y: (0.5 - v) * SIZE,
        z: bustDepth(u, v, head, l) + (Math.random() - 0.5) * 0.03,
        r: px[0] / 255,
        g: px[1] / 255,
        b: px[2] / 255,
        l,
      })
    }
  }
  return out
}

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

// Grey studio wall: anything clearly away from the wall color is the subject.
const greySubject = (px: number[], bg: number[]) => dist(px, bg) > 44

// Red studio: the backdrop is a saturated mid red. The suit and hair are darker and greyer,
// the lit face and shirt are brighter. Chroma separates the suit from a dark vignette.
const redSubject = (px: number[], bg: number[]) => {
  const chroma = px[0] - Math.max(px[1], px[2])
  const bgChroma = bg[0] - Math.max(bg[1], bg[2])
  const lum = px[0] + px[1] + px[2]
  const bgLum = bg[0] + bg[1] + bg[2]
  return chroma < bgChroma * 0.62 || lum > bgLum * 1.45
}

const vertex = /* glsl */ `
  attribute vec3 aPosB;
  attribute vec3 aScatter;
  attribute vec3 aColA;
  attribute vec3 aColB;
  attribute float aSizeA;
  attribute float aSizeB;
  attribute float aSeed;
  attribute float aLayer; // 0 = surface, 1 = volume behind it, 2 = halo around the figure
  uniform float uMix;
  uniform float uScatter;
  uniform float uIntro;
  uniform float uTime;
  uniform float uMotion;
  uniform float uSize;
  uniform float uScale;
  uniform float uOpacity;
  uniform vec3 uPointer; // xy in model space, z = strength
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    // The entrance reads top to bottom, like a scan line settling onto the face.
    float top = 1.0 - (position.y / ${SIZE.toFixed(2)} + 0.5);
    float delay = aSeed * 0.35 + top * 0.6;
    float intro = smoothstep(delay, delay + 0.55, uIntro);
    float s = max(uScatter, 1.0 - intro);
    s = s * s * (3.0 - 2.0 * s);

    vec3 p = mix(position, aPosB, uMix);
    float mid = sin(uMix * 3.14159);
    p.xy += mid * 0.22 * vec2(sin(aSeed * 40.0 + uTime * 0.5), cos(aSeed * 31.0 + uTime * 0.4));
    p.z += mid * (aSeed - 0.5) * 1.4;
    p = mix(p, aScatter, s);

    // A slow ripple through depth, plus each dot's own drift. Dots further from the surface
    // wander further, so the figure shimmers while the face stays legible.
    p.z += uMotion * 0.03 * sin(uTime * 0.8 + position.y * 3.0 + position.x * 1.5);
    float wander = 0.003 + 0.016 * aLayer + 0.03 * step(1.5, aLayer) + 0.12 * s;
    p += uMotion * wander * vec3(
      sin(uTime * (0.6 + aSeed * 0.5) + aSeed * 20.0),
      cos(uTime * (0.5 + aSeed * 0.4) + aSeed * 17.0),
      sin(uTime * 0.4 + aSeed * 11.0) * 2.0
    );

    vec2 d = p.xy - uPointer.xy;
    float near = 1.0 - smoothstep(0.0, 0.42, length(d));
    float push = near * near * uPointer.z * (1.0 - s);
    p.xy += normalize(d + 1e-4) * push * 0.07;
    p.z += push * 0.35;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = mix(aSizeA, aSizeB, uMix) * mix(1.0, 0.7, s);
    gl_PointSize = size * uSize * uScale / -mv.z;
    vColor = mix(aColA, aColB, uMix);
    float layerAlpha = aLayer < 0.5 ? 1.0 : (aLayer < 1.5 ? 0.6 : 0.45);
    vAlpha = mix(layerAlpha, 0.22, s) * uOpacity;
  }
`

const fragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    gl_FragColor = vec4(vColor, smoothstep(0.5, 0.43, r) * vAlpha);
  }
`

// Colors go to the shader as raw sRGB, to match the CSS backdrop behind the canvas exactly.
const raw = (h: number) => new THREE.Color().setHex(h, THREE.LinearSRGBColorSpace)

export function createPortraitField(host: HTMLElement, opts: Options): PortraitField | null {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' })
  } catch {
    return null
  }
  renderer.setClearColor(0x000000, 0)
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50)
  camera.position.set(0, 0, CAM_Z)
  const group = new THREE.Group()
  scene.add(group)

  const target: FieldTarget = { mix: 0, scatter: 0, x: 0, y: 0, scale: 1, turn: 0, opacity: 1 }
  const now = { ...target }
  const pointer = { x: 0, y: 0, strength: 0, active: false, nx: 0, ny: 0 }
  const tilt = { x: 0, y: 0 }

  const uniforms = {
    uMix: { value: 0 },
    uScatter: { value: 0 },
    uIntro: { value: opts.reducedMotion ? 2 : 0 },
    uTime: { value: 0 },
    uMotion: { value: opts.reducedMotion ? 0 : 1 },
    uSize: { value: 1 },
    uScale: { value: 1 },
    uOpacity: { value: 1 },
    uPointer: { value: new THREE.Vector3() },
  }

  let grid = 0
  const resize = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    // One grid cell at the portrait plane, in device pixels, times depth (divided back out in the shader).
    const pxPerUnit = h / (2 * CAM_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2)))
    if (grid) uniforms.uSize.value = (SIZE / grid) * pxPerUnit * CAM_Z * DOT * renderer.getPixelRatio()
  }
  const visibleWidth = () => 2 * CAM_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * camera.aspect

  let points: THREE.Points | null = null
  let disposed = false

  const build = async () => {
    const [imgA, imgB] = await Promise.all([loadImage(opts.a), loadImage(opts.b)])
    if (disposed) return
    grid = window.innerWidth < 700 ? 170 : 240
    const A = sampleImage(imgA, grid, [0.5, 0.26], greySubject)
    const B = sampleImage(imgB, grid, [0.49, 0.3], redSubject)
    const surface = Math.max(A.length, B.length)
    const volume = Math.round(surface * 0.6) // dots behind the surface, for parallax when the head turns
    const halo = Math.round(surface * 0.12)
    const n = surface + volume + halo

    const lums = B.map((s) => s.l)
    const lMin = Math.min(...lums)
    const lMax = Math.max(...lums)
    const blush = raw(0xf1c7bd)
    const ember = raw(0x8a2a31)
    const cell = SIZE / grid

    const posA = new Float32Array(n * 3)
    const posB = new Float32Array(n * 3)
    const scatter = new Float32Array(n * 3)
    const colA = new Float32Array(n * 3)
    const colB = new Float32Array(n * 3)
    const sizeA = new Float32Array(n)
    const sizeB = new Float32Array(n)
    const seed = new Float32Array(n)
    const layer = new Float32Array(n)
    const c = new THREE.Color()
    const rand = (k: number) => (Math.random() - 0.5) * k

    // Pushes a sample off the surface: back into the body for the volume layer, outward from
    // the figure's center for the halo.
    const offset = (smp: Sample, kind: number) => {
      if (kind === 0) return [smp.x, smp.y, smp.z]
      if (kind === 1) return [smp.x + rand(cell * 1.6), smp.y + rand(cell * 1.6), smp.z - 0.05 - Math.random() * 0.4]
      const dx = smp.x
      const dy = smp.y + 0.2
      const len = Math.hypot(dx, dy) || 1
      const out = 0.04 + Math.pow(Math.random(), 2) * 0.35
      return [smp.x + (dx / len) * out, smp.y + (dy / len) * out, smp.z + rand(0.9)]
    }

    for (let i = 0; i < n; i++) {
      // Points draw in buffer order without depth testing, so the layers behind come first
      // and the surface paints last, on top.
      const kind = i < volume ? 1 : i < volume + halo ? 2 : 0
      // Proportional index keeps both lists in reading order, so rows travel to rows.
      // The halo picks its samples at random so it rings the whole silhouette.
      const j = kind === 1 ? Math.floor((i * surface) / volume) : kind === 2 ? Math.floor(Math.random() * surface) : i - volume - halo
      const a = A[Math.floor((j * A.length) / surface)]
      const b = B[Math.floor((j * B.length) / surface)]
      posA.set(offset(a, kind), i * 3)
      posB.set(offset(b, kind), i * 3)
      scatter.set([rand(16), rand(9), -6 + Math.random() * 6.5], i * 3)
      const shrink = kind === 0 ? 1 : kind === 1 ? 0.62 : 0.4
      // Grey portrait: the photo's own color, halftoned — darker means a larger dot.
      colA.set([a.r * 0.86, a.g * 0.84, a.b * 0.84], i * 3)
      sizeA[i] = (1.12 + 0.24 * (1 - a.l)) * shrink
      // Red portrait, printed in negative: light dots on oxblood, brighter means larger.
      const t = Math.pow((b.l - lMin) / Math.max(1e-3, lMax - lMin), 0.8)
      c.copy(ember).lerp(blush, kind === 2 ? Math.max(t, 0.6) : t)
      colB.set([c.r, c.g, c.b], i * 3)
      sizeB[i] = (0.62 + 0.62 * t) * shrink
      seed[i] = Math.random()
      layer[i] = kind
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(posA, 3))
    geo.setAttribute('aPosB', new THREE.BufferAttribute(posB, 3))
    geo.setAttribute('aScatter', new THREE.BufferAttribute(scatter, 3))
    geo.setAttribute('aColA', new THREE.BufferAttribute(colA, 3))
    geo.setAttribute('aColB', new THREE.BufferAttribute(colB, 3))
    geo.setAttribute('aSizeA', new THREE.BufferAttribute(sizeA, 1))
    geo.setAttribute('aSizeB', new THREE.BufferAttribute(sizeB, 1))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    geo.setAttribute('aLayer', new THREE.BufferAttribute(layer, 1))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20)

    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
    })
    points = new THREE.Points(geo, mat)
    group.add(points)
    resize()
    Object.assign(now, target)
    opts.onReady?.()
  }

  const raycaster = new THREE.Raycaster()
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  const hit = new THREE.Vector3()
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    pointer.nx = (e.clientX / window.innerWidth) * 2 - 1
    pointer.ny = -(e.clientY / window.innerHeight) * 2 + 1
    pointer.active = true
  }
  const onLeave = () => {
    pointer.active = false
  }

  window.addEventListener('resize', resize)
  window.addEventListener('pointermove', onPointer, { passive: true })
  document.documentElement.addEventListener('pointerleave', onLeave)
  resize()
  build().catch(() => {})

  let introStart = -1
  let last = performance.now()
  let frame = 0
  const tick = (ms: number) => {
    frame = requestAnimationFrame(tick)
    const dt = Math.min((ms - last) / 1000, 0.05)
    last = ms
    if (!points) return
    const t = ms / 1000
    if (introStart < 0) introStart = t
    if (!opts.reducedMotion) {
      const p = Math.min(1, (t - introStart) / 2.8)
      uniforms.uIntro.value = 1.6 * (1 - Math.pow(1 - p, 3))
    }
    uniforms.uTime.value = opts.reducedMotion ? 0 : t

    const k = opts.reducedMotion ? 1 : 1 - Math.exp(-dt * 5)
    for (const key of Object.keys(target) as (keyof FieldTarget)[]) now[key] += (target[key] - now[key]) * k

    uniforms.uMix.value = now.mix
    uniforms.uScatter.value = now.scatter
    uniforms.uOpacity.value = now.opacity
    uniforms.uScale.value = now.scale
    group.position.set(now.x, now.y, 0)
    group.scale.setScalar(now.scale)

    // The portrait turns a little toward the cursor; touch devices keep the baseline pose.
    const want = pointer.active && !opts.reducedMotion ? pointer.nx : 0
    const wantY = pointer.active && !opts.reducedMotion ? pointer.ny : 0
    tilt.y += (want * 0.32 - tilt.y) * (1 - Math.exp(-dt * 3))
    tilt.x += (-wantY * 0.12 - tilt.x) * (1 - Math.exp(-dt * 3))
    group.rotation.set(tilt.x, now.turn + tilt.y, 0)
    group.updateMatrixWorld()

    pointer.strength += ((pointer.active && !opts.reducedMotion ? 1 : 0) - pointer.strength) * (1 - Math.exp(-dt * 4))
    raycaster.setFromCamera(new THREE.Vector2(pointer.nx, pointer.ny), camera)
    if (raycaster.ray.intersectPlane(plane, hit)) {
      const local = group.worldToLocal(hit.clone())
      uniforms.uPointer.value.set(local.x, local.y, pointer.strength)
    }

    renderer.render(scene, camera)
  }
  frame = requestAnimationFrame(tick)

  return {
    target,
    visibleWidth,
    dispose() {
      disposed = true
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointer)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      if (points) {
        points.geometry.dispose()
        ;(points.material as THREE.Material).dispose()
      }
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}

// Review harness for the img2threejs passes: renders the bust from the solved reference camera
// (optionally over the photo) or from turntable azimuths, and flags window.__ready for capture.
// ?view=0|90|180|270|35|-35  ?overlay=1  ?project=1
import * as THREE from 'three'
import photoUrl from '../assets/eleandre-portrait-1200.jpg'
import albedoUrl from '../assets/eleandre-albedo.png'
import { createEleandrePortraitBustEnvironment, createEleandrePortraitBustModel } from '../scene/eleandreBust'
import { projectPhoto, referenceCamera } from '../scene/photoProjection'

const q = new URLSearchParams(location.search)
const azimuth = Number(q.get('view') ?? 0)
const overlay = q.get('overlay') === '1'
const wrap = document.getElementById('wrap')!

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
renderer.setSize(1000, 1000)
renderer.toneMapping = THREE.NeutralToneMapping
renderer.setClearColor(0xc9cdcd, overlay ? 0 : 1)
wrap.appendChild(renderer.domElement)

const scene = new THREE.Scene()
// Neutral studio room, as reflected in the lenses: metal needs something to reflect.
scene.environment = createEleandrePortraitBustEnvironment(renderer)
scene.environmentIntensity = 0.6
scene.add(new THREE.HemisphereLight('#ffffff', '#6b6f70', 1.1))
const key = new THREE.DirectionalLight('#fff6ee', 2.2)
key.position.set(4, 3, 8)
const rim = new THREE.DirectionalLight('#e2b75c', 1.6)
rim.position.set(-5, 2, -6)
scene.add(key, rim)

const model = createEleandrePortraitBustModel()
scene.add(model)

async function main() {
  if (q.get('project') === '1') {
    const tex = await new THREE.TextureLoader().loadAsync(albedoUrl)
    tex.colorSpace = THREE.SRGBColorSpace
    const meshes = model.userData.sculptRuntime.meshes as Record<string, THREE.Mesh>
    const fallback: Record<string, string> = {
      torso: '#18191d', 'turtleneck-collar': '#141519', head: '#af704e', hair: '#0e0e11', 'lens-r': '#181519', 'lens-l': '#181519',
    }
    const parts = Object.entries(fallback).filter(([id]) => meshes[id]).map(([id, color]) => ({ mesh: meshes[id], fallback: color }))
    projectPhoto(renderer, model, parts, tex)
  }
  // Let the evidence maps finish loading before capture.
  await new Promise((r) => setTimeout(r, 1500))
  // Turntable: rotate the bust about its vertical axis under the fixed reference camera.
  model.rotation.y = THREE.MathUtils.degToRad(azimuth)
  const camera = referenceCamera()
  if (overlay) {
    // Silhouette check: the model as flat translucent red over the photo, both through the same camera.
    scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: '#ff2a2a' })
    renderer.render(scene, camera)
    const photo = new Image()
    photo.src = photoUrl
    await photo.decode()
    const out = document.createElement('canvas')
    out.width = out.height = 1000
    const g = out.getContext('2d')!
    g.drawImage(photo, 0, 0, 1000, 1000)
    g.globalAlpha = 0.45
    g.drawImage(renderer.domElement, 0, 0)
    renderer.domElement.remove()
    wrap.appendChild(out)
  } else {
    const debug = q.get('debug')
    if (debug === 'unlit') {
      // Map-stripped, unlit evidence: every part in its flat base colour, no textures, no lights.
      model.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const src = mesh.material as THREE.MeshStandardMaterial
        mesh.material = new THREE.MeshBasicMaterial({ color: src.color ?? new THREE.Color('#888') })
      })
    }
    if (debug === 'normal') scene.overrideMaterial = new THREE.MeshNormalMaterial()
    if (debug === 'silhouette') scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: '#101010' })
    if (debug === 'white') scene.overrideMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 })
    if (debug === 'white2') scene.overrideMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, side: THREE.DoubleSide })
    renderer.render(scene, camera)
  }
  ;(window as unknown as { __ready: boolean }).__ready = true
}
main()

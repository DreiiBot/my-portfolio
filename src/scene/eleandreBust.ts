import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

type SdfVector = readonly [number, number, number];
type SdfTransform = { position?: SdfVector; translation?: SdfVector; rotation?: SdfVector; scale?: SdfVector };
type SdfPrimitive = {
  readonly id: string;
  readonly type: 'sphere' | 'capsule' | 'box' | 'cone' | 'ellipsoid';
  readonly center?: SdfVector;
  readonly radius?: number | SdfVector;
  readonly height?: number;
  readonly size?: SdfVector;
  readonly dimensions?: SdfVector;
  readonly radii?: SdfVector;
  readonly transform?: SdfTransform;
};
type SdfOperation = {
  readonly id?: string;
  readonly output?: string;
  readonly type: 'smooth-union' | 'subtract' | 'intersect';
  readonly left: string;
  readonly right: string;
  readonly radius?: number;
};
type SdfDescriptor = {
  readonly primitives: readonly SdfPrimitive[];
  readonly operations?: readonly SdfOperation[];
  readonly resolution: number;
  readonly bounds?: { readonly min: SdfVector; readonly max: SdfVector };
};
type SdfFunction = (point: THREE.Vector3) => number;

function sdfSphere(point: THREE.Vector3, radius: number): number {
  return point.length() - radius;
}

function sdfCapsule(point: THREE.Vector3, radius: number, height: number): number {
  const halfHeight = height * 0.5;
  const y = Math.max(-halfHeight, Math.min(halfHeight, point.y));
  return point.distanceTo(new THREE.Vector3(0, y, 0)) - radius;
}

function sdfBox(point: THREE.Vector3, size: SdfVector): number {
  const q = new THREE.Vector3(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z))
    .sub(new THREE.Vector3(size[0] * 0.5, size[1] * 0.5, size[2] * 0.5));
  return q.clone().max(new THREE.Vector3()).length() + Math.min(Math.max(q.x, q.y, q.z), 0);
}

function sdfCone(point: THREE.Vector3, radius: number, height: number): number {
  const halfHeight = height * 0.5;
  const taper = radius * (1 - (point.y + halfHeight) / height);
  return Math.max(Math.hypot(point.x, point.z) - Math.max(0, taper), Math.abs(point.y) - halfHeight);
}

function sdfEllipsoid(point: THREE.Vector3, radii: SdfVector): number {
  const scaled = new THREE.Vector3(point.x / radii[0], point.y / radii[1], point.z / radii[2]);
  return (scaled.length() - 1) * Math.min(radii[0], radii[1], radii[2]);
}

function sdfRadii(primitive: SdfPrimitive): SdfVector {
  const radius = primitive.radius;
  if (primitive.radii) return primitive.radii;
  if (typeof radius === 'number') return [radius, radius, radius];
  return radius ?? [0.5, 0.5, 0.5];
}

function smin(left: number, right: number, radius: number): number {
  const blend = Math.max(radius - Math.abs(left - right), 0) / radius;
  return Math.min(left, right) - blend * blend * radius * 0.25;
}

function sdfLocalPoint(point: THREE.Vector3, primitive: SdfPrimitive): { point: THREE.Vector3; scale: number } {
  const transform = primitive.transform;
  const translation = transform?.position ?? transform?.translation ?? primitive.center ?? [0, 0, 0];
  const rotation = transform?.rotation ?? [0, 0, 0];
  const scale = transform?.scale ?? [1, 1, 1];
  const local = point.clone().sub(new THREE.Vector3(translation[0], translation[1], translation[2]));
  const inverseRotation = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]))
    .invert();
  local.applyQuaternion(inverseRotation);
  local.set(local.x / scale[0], local.y / scale[1], local.z / scale[2]);
  return { point: local, scale: Math.min(scale[0], scale[1], scale[2]) };
}

function sdfPrimitive(point: THREE.Vector3, primitive: SdfPrimitive): number {
  const local = sdfLocalPoint(point, primitive);
  let distance: number;
  switch (primitive.type) {
    case 'sphere':
      distance = sdfSphere(local.point, typeof primitive.radius === 'number' ? primitive.radius : 0.5);
      break;
    case 'capsule':
      distance = sdfCapsule(local.point, typeof primitive.radius === 'number' ? primitive.radius : 0.25, primitive.height ?? 1);
      break;
    case 'box':
      distance = sdfBox(local.point, primitive.size ?? primitive.dimensions ?? [1, 1, 1]);
      break;
    case 'cone':
      distance = sdfCone(local.point, typeof primitive.radius === 'number' ? primitive.radius : 0.5, primitive.height ?? 1);
      break;
    case 'ellipsoid':
      distance = sdfEllipsoid(local.point, sdfRadii(primitive));
      break;
  }
  return distance * local.scale;
}

function sdfSample(descriptor: SdfDescriptor): SdfFunction {
  const nodes = new Map<string, SdfFunction>();
  for (const primitive of descriptor.primitives) nodes.set(primitive.id, (point) => sdfPrimitive(point, primitive));
  let result = descriptor.primitives.length > 0 ? nodes.get(descriptor.primitives[0].id) : undefined;
  for (let index = 0; index < (descriptor.operations?.length ?? 0); index += 1) {
    const operation = descriptor.operations?.[index];
    if (!operation) continue;
    const left = nodes.get(operation.left);
    const right = nodes.get(operation.right);
    if (!left || !right) continue;
    let combined: SdfFunction;
    switch (operation.type) {
      case 'smooth-union':
        combined = (point) => smin(left(point), right(point), operation.radius ?? 0.1);
        break;
      case 'subtract':
        combined = (point) => Math.max(left(point), -right(point));
        break;
      case 'intersect':
        combined = (point) => Math.max(left(point), right(point));
        break;
    }
    nodes.set(operation.id ?? operation.output ?? `operation-${index}`, combined);
    result = combined;
  }
  return result ?? (() => Infinity);
}

function polygonizeSdf(descriptor: SdfDescriptor): THREE.BufferGeometry {
  // SURFACE NETS, not a voxel shell.
  //
  // This used to emit one axis-aligned quad per exposed voxel face, which is a Minecraft surface:
  // every face is axis-aligned, every edge is a 90-degree step, and the result is stair-stepped at
  // exactly the scale of the sampling grid. For a subject whose whole identity is smooth blended
  // organic form -- which is the only kind of subject anyone reaches for an implicit surface to
  // build -- that is worse than the assembled primitives it was meant to replace.
  //
  // Naive surface nets places ONE vertex per sign-changing cell, at the average of the linearly
  // interpolated crossings on that cell's edges, and joins the four cells around each crossing
  // edge into a quad. It is compact, manifold, and smooth, and it is a natural fit for a field
  // that can be sampled anywhere rather than only at corners.
  //
  // Normals come from the field GRADIENT, not from face averaging: the gradient is the exact
  // surface normal of the implicit surface, so shading no longer carries the grid's imprint.
  const resolution = Math.max(4, Math.min(64, Math.floor(descriptor.resolution)));
  const defaultBounds: { readonly min: SdfVector; readonly max: SdfVector } = { min: [-2, -2, -2], max: [2, 2, 2] };
  const bounds = descriptor.bounds ?? defaultBounds;
  const min = new THREE.Vector3(bounds.min[0], bounds.min[1], bounds.min[2]);
  const step = new THREE.Vector3(
    (bounds.max[0] - bounds.min[0]) / resolution,
    (bounds.max[1] - bounds.min[1]) / resolution,
    (bounds.max[2] - bounds.min[2]) / resolution,
  );
  const sample = sdfSample(descriptor);
  const scratch = new THREE.Vector3();

  // Corner grid: one more corner than cells on each axis.
  const side = resolution + 1;
  const field = new Float32Array(side * side * side);
  const cornerAt = (x: number, y: number, z: number): number => (z * side + y) * side + x;
  for (let z = 0; z < side; z += 1) {
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        scratch.set(min.x + x * step.x, min.y + y * step.y, min.z + z * step.z);
        field[cornerAt(x, y, z)] = sample(scratch);
      }
    }
  }

  // The 12 cell edges as corner-offset pairs.
  const CUBE_EDGES: readonly (readonly [number, number, number, number, number, number])[] = [
    [0, 0, 0, 1, 0, 0], [1, 0, 0, 1, 1, 0], [0, 1, 0, 1, 1, 0], [0, 0, 0, 0, 1, 0],
    [0, 0, 1, 1, 0, 1], [1, 0, 1, 1, 1, 1], [0, 1, 1, 1, 1, 1], [0, 0, 1, 0, 1, 1],
    [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [1, 1, 0, 1, 1, 1], [0, 1, 0, 0, 1, 1],
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const cellVertex = new Int32Array(resolution * resolution * resolution).fill(-1);
  const cellAt = (x: number, y: number, z: number): number => (z * resolution + y) * resolution + x;

  // Central-difference gradient, stepped at a fraction of a cell so it follows the field rather
  // than the grid.
  const epsilon = Math.min(step.x, step.y, step.z) * 0.25;
  const gradient = (point: THREE.Vector3): THREE.Vector3 => {
    const gx = sample(scratch.set(point.x + epsilon, point.y, point.z))
      - sample(scratch.set(point.x - epsilon, point.y, point.z));
    const gy = sample(scratch.set(point.x, point.y + epsilon, point.z))
      - sample(scratch.set(point.x, point.y - epsilon, point.z));
    const gz = sample(scratch.set(point.x, point.y, point.z + epsilon))
      - sample(scratch.set(point.x, point.y, point.z - epsilon));
    const normal = new THREE.Vector3(gx, gy, gz);
    // A point where the field is flat has no defined normal; +Y is arbitrary but finite, and
    // leaving a zero vector would poison every lighting calculation downstream.
    return normal.lengthSq() < 1e-20 ? new THREE.Vector3(0, 1, 0) : normal.normalize();
  };

  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        let crossings = 0;
        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        for (const [ax, ay, az, bx, by, bz] of CUBE_EDGES) {
          const a = field[cornerAt(x + ax, y + ay, z + az)];
          const b = field[cornerAt(x + bx, y + by, z + bz)];
          if ((a <= 0) === (b <= 0)) continue;
          const t = a / (a - b);
          sumX += (ax + (bx - ax) * t);
          sumY += (ay + (by - ay) * t);
          sumZ += (az + (bz - az) * t);
          crossings += 1;
        }
        if (crossings === 0) continue;
        const px = min.x + (x + sumX / crossings) * step.x;
        const py = min.y + (y + sumY / crossings) * step.y;
        const pz = min.z + (z + sumZ / crossings) * step.z;
        cellVertex[cellAt(x, y, z)] = positions.length / 3;
        positions.push(px, py, pz);
        const normal = gradient(new THREE.Vector3(px, py, pz));
        normals.push(normal.x, normal.y, normal.z);
      }
    }
  }

  // One quad per sign-changing grid edge, joining the four cells that share it.
  //
  // Winding, worked out rather than guessed. For the +x edge from corner (x,y,z), the four cells
  // around it are (x, y-1, z-1), (x, y, z-1), (x, y, z), (x, y-1, z); in the (y,z) plane that
  // traversal is +y, +z, -y, whose cross product is +x. So when the corner is INSIDE and its
  // neighbour is outside, the unflipped order already faces out, and the flip belongs on the
  // opposite case. Getting this backwards is invisible in the normals -- those come from the
  // gradient and stay correct -- and shows only as back-face culling removing the front surface,
  // i.e. the model rendering as a hollow shell with its interior visible.
  const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) indices.push(a, c, b, a, d, c);
    else indices.push(a, b, c, a, c, d);
  };
  // Each quad joins the FOUR cells sharing one grid edge, so every one of those cells must exist.
  // Bounding only the edge axis and the lower end of the other two let y/z reach `resolution`, which
  // is a corner index, not a cell index: `cellAt` then strides into an unrelated slot (with
  // resolution 8, `cellAt(3, 8, 1)` is 131 -- the slot for cell (3, 0, 2)) or past the end of the
  // array, where a typed-array read yields `undefined`. `undefined < 0` is false, so the guard in
  // `quad` passed it through to `setIndex`, which coerces it to 0. Measured on a sphere reaching its
  // own bounds at resolution 8: 60 out-of-range reads and 108 aliased reads. A surface that touches
  // the sampling box is therefore left OPEN at that face rather than closed with wrong triangles --
  // pad `bounds` past the surface to get a closed mesh.
  for (let z = 0; z < side; z += 1) {
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        const here = field[cornerAt(x, y, z)] <= 0;
        if (x + 1 < side && y > 0 && z > 0 && y < side - 1 && z < side - 1
          && here !== (field[cornerAt(x + 1, y, z)] <= 0)) {
          quad(
            cellVertex[cellAt(x, y - 1, z - 1)], cellVertex[cellAt(x, y, z - 1)],
            cellVertex[cellAt(x, y, z)], cellVertex[cellAt(x, y - 1, z)], !here,
          );
        }
        if (y + 1 < side && x > 0 && z > 0 && x < side - 1 && z < side - 1
          && here !== (field[cornerAt(x, y + 1, z)] <= 0)) {
          quad(
            cellVertex[cellAt(x - 1, y, z - 1)], cellVertex[cellAt(x - 1, y, z)],
            cellVertex[cellAt(x, y, z)], cellVertex[cellAt(x, y, z - 1)], !here,
          );
        }
        if (z + 1 < side && x > 0 && y > 0 && x < side - 1 && y < side - 1
          && here !== (field[cornerAt(x, y, z + 1)] <= 0)) {
          quad(
            cellVertex[cellAt(x - 1, y - 1, z)], cellVertex[cellAt(x, y - 1, z)],
            cellVertex[cellAt(x, y, z)], cellVertex[cellAt(x - 1, y, z)], !here,
          );
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

type TaperedStation = { position: [number, number, number]; rx: number; rz: number; twist?: number };

// Frames come from PARALLEL TRANSPORT, not from a Frenet frame. A Frenet frame is defined by
// the curve's normal, which flips sign wherever the path has an inflection or straightens out,
// and every flip twists the surface 180 degrees within one segment. Carrying the previous frame
// forward and removing only its along-path component keeps the twist continuous. THREE's own
// extrudePath and TubeGeometry do not expose this, which is why this is hand-built.
function buildTaperedSweepGeometry(
  sweep: { stations: TaperedStation[]; radialSegments?: number; capEnds?: boolean },
): THREE.BufferGeometry {
  const stations = sweep.stations;
  if (stations.length < 2) throw new Error('tapered-sweep needs at least two stations');
  const radial = Math.max(3, sweep.radialSegments ?? 10);
  const centres = stations.map((s) => new THREE.Vector3(...s.position));

  const tangents = centres.map((_, i) => {
    const prev = centres[Math.max(0, i - 1)];
    const next = centres[Math.min(centres.length - 1, i + 1)];
    const t = next.clone().sub(prev);
    // Coincident neighbours would normalise to NaN and poison every downstream vertex.
    return t.lengthSq() < 1e-12 ? new THREE.Vector3(0, 1, 0) : t.normalize();
  });

  // Seed a reference axis that is not parallel to the first tangent, or the first cross
  // product is degenerate and the whole sweep collapses to a line.
  let ref = new THREE.Vector3(0, 0, 1);
  if (Math.abs(tangents[0].dot(ref)) > 0.9) ref = new THREE.Vector3(1, 0, 0);

  const normals: THREE.Vector3[] = [];
  const binormals: THREE.Vector3[] = [];
  let carried = ref.clone().sub(tangents[0].clone().multiplyScalar(ref.dot(tangents[0]))).normalize();
  for (let i = 0; i < tangents.length; i += 1) {
    const t = tangents[i];
    // Project the carried frame back onto the plane perpendicular to this tangent.
    const n = carried.clone().sub(t.clone().multiplyScalar(carried.dot(t)));
    if (n.lengthSq() < 1e-12) {
      const fallback = Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      n.copy(fallback.sub(t.clone().multiplyScalar(fallback.dot(t))));
    }
    n.normalize();
    normals.push(n);
    binormals.push(new THREE.Vector3().crossVectors(t, n).normalize());
    carried = n;
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringStart: number[] = [];
  const isPoint: boolean[] = [];

  for (let i = 0; i < stations.length; i += 1) {
    const st = stations[i];
    const v = i / (stations.length - 1);
    ringStart.push(positions.length / 3);
    // A station whose section has collapsed emits ONE vertex, not a ring of radius zero.
    // A degenerate ring still carries `radial` coincident vertices and `radial` zero-area
    // triangles, so the lock ends in a blunt cap the width of the floating-point noise
    // rather than at a point -- and a hair lock, a horn or a blade tip has to reach a point.
    if (st.rx <= 1e-6 && st.rz <= 1e-6) {
      isPoint.push(true);
      positions.push(centres[i].x, centres[i].y, centres[i].z);
      uvs.push(0.5, v);
      continue;
    }
    isPoint.push(false);
    const twist = ((st.twist ?? 0) * Math.PI) / 180;
    for (let j = 0; j <= radial; j += 1) {
      const theta = (j / radial) * Math.PI * 2 + twist;
      const offset = normals[i].clone().multiplyScalar(Math.cos(theta) * st.rx)
        .add(binormals[i].clone().multiplyScalar(Math.sin(theta) * st.rz));
      const p = centres[i].clone().add(offset);
      positions.push(p.x, p.y, p.z);
      uvs.push(j / radial, v);
    }
  }

  for (let i = 0; i < stations.length - 1; i += 1) {
    const a0 = ringStart[i];
    const b0 = ringStart[i + 1];
    if (isPoint[i] && isPoint[i + 1]) continue;   // two collapsed stations bound nothing
    for (let j = 0; j < radial; j += 1) {
      // Wound so the face normal points radially OUTWARD.
      //
      // Ring vertices advance from `normal` toward `binormal`, and binormal is
      // tangent x normal, so increasing theta runs counter-clockwise seen from the
      // far end of the segment. Taking the ring-to-ring edge first therefore puts
      // the cross product on the inside. Measured as signed volume on the built
      // mesh: every tapered-sweep came out negative -- a torso at -0.0674 and a
      // tail at -0.0044 against a positive ellipsoid head -- so every sweep this
      // generator has ever emitted rendered its back faces, with normals pointing
      // into the solid and every lighting judgement made on the wrong surface.
      if (isPoint[i]) indices.push(a0, b0 + j + 1, b0 + j);
      else if (isPoint[i + 1]) indices.push(a0 + j, a0 + j + 1, b0);
      else indices.push(a0 + j, a0 + j + 1, b0 + j, a0 + j + 1, b0 + j + 1, b0 + j);
    }
  }

  if (sweep.capEnds ?? true) {
    for (const end of [0, stations.length - 1]) {
      if (isPoint[end]) continue;   // a point end is already closed
      const centreIndex = positions.length / 3;
      positions.push(centres[end].x, centres[end].y, centres[end].z);
      uvs.push(0.5, end === 0 ? 0 : 1);
      const base = ringStart[end];
      for (let j = 0; j < radial; j += 1) {
        if (end === 0) indices.push(centreIndex, base + j + 1, base + j);
        else indices.push(centreIndex, base + j, base + j + 1);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Eleandre portrait bust
// Sculpt build pass: material-pass
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createEleandrePortraitBustModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Eleandre portrait bust";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"version": "1.0", "sourceImage": "C:\\devs\\my-portfolio\\src\\assets\\eleandre-portrait.jpg", "solver": "stage1_intake/solve_camera_pose.py", "method": "heuristic default-guess camera, not solved from image content; image dimensions give an exact aspect ratio, everything else is a starting point for agent refinement", "imageWidth": 2000, "imageHeight": 2000, "fovDegrees": {"value": 18.0, "source": "user-supplied", "agentFill": false, "rationale": "default guess for a landscape/square photo (typical phone/short-tele framing)"}, "aspect": {"value": 1.0, "source": "image-dimensions", "agentFill": false}, "orientation": {"yawDegrees": {"value": 0.0, "source": "agent-measured", "agentFill": false}, "pitchDegrees": {"value": 0.0, "source": "agent-measured", "agentFill": false}, "rollDegrees": {"value": 0.0, "source": "agent-measured", "agentFill": false}, "note": "Level, straight-on shot: horizon of the wall has no keystone, shoulders square. Head yaw/roll belong to the subject, not the camera."}, "position": {"hint": [0.0, 0.0, 10.0], "distance": {"value": 10.0, "source": "agent-chosen", "agentFill": false}, "note": "World units: image plane at z=0 spans 2*10*tan(9deg)=3.1677 units vertically; image (u,v) -> X=(u-0.5)*3.1677, Y=(0.5-v)*3.1677. Camera looks down -Z."}, "confidence": 0.55, "limitations": ["no true camera calibration is performed; focal length/FOV/orientation are not recovered from pixels", "fovDegrees is a genre default, not a measurement; wrong FOV distorts perceived proportions under overlay", "orientation and position are placeholders and will almost always need manual/agent adjustment", "this script cannot detect lens distortion, perspective foreshortening, or non-zero roll"], "note": "Final camera match must be confirmed by overlay review: render the fitted mesh from this camera, place it beside or over the reference image, and adjust fovDegrees/orientation/position until silhouette and landmark alignment match before trusting projected texture bakes."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["skin-projected"] = createSculptMaterial(
    "skin-projected",
    {"id": "skin-projected", "name": "Skin (projected photo)", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#af704e", "color": "#af704e", "albedo": {"dominant": "#af704e", "secondary": [], "samplingNotes": "Albedo is the de-lit reference projected from the matched camera; this colour is the fallback for surfaces the camera never saw."}, "colorVariation": {"palette": ["#e8b98f", "#be9875"], "pattern": "flat", "amplitude": 0.05, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.55, "variation": 0.08, "map": "independent-procedural-field", "localResponse": ""}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "moustache", "kind": "stain", "description": "Thin dark moustache over the upper lip (carried by projection)", "region": [0.455, 0.345, 0.075, 0.02], "affects": "albedo", "value": "projected", "evidenceRef": "face-landmarks"}, {"id": "lip-tint", "kind": "stain", "description": "Warmer, pinker lips (carried by projection)", "region": [0.46, 0.36, 0.065, 0.028], "affects": "albedo", "value": "projected", "evidenceRef": "face-landmarks"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"version": "1.0", "sourceImage": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-head.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.779, "estimatedFidelity": 0.779, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\skin-projected\\skin-projected_albedo.png", "url": "/sculpt-evidence/skin-projected/skin-projected_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\skin-projected\\skin-projected_roughness.png", "url": "/sculpt-evidence/skin-projected/skin-projected_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\skin-projected\\skin-projected_height.png", "url": "/sculpt-evidence/skin-projected/skin-projected_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\skin-projected\\skin-projected_normal.png", "url": "/sculpt-evidence/skin-projected/skin-projected_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\skin-projected\\skin-projected_ao.png", "url": "/sculpt-evidence/skin-projected/skin-projected_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 160, "sourceHeight": 100, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 160, "height": 100}, "mask": {"backgroundColor": "#B57553", "backgroundNoise": 64.699, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.2775, "heightP90Gradient": 0.02162, "roughnessBase": 0.707, "roughnessVariation": 0.05, "normalStrength": 0.182, "blurRadius": 21}, "palette": ["#C3815C", "#B47351", "#87523C", "#D0916B", "#9F6345"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}},
    options
  );
  materialMap["hair"] = createSculptMaterial(
    "hair",
    {"id": "hair", "name": "Hair (projected photo)", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#0e0e11", "color": "#0e0e11", "albedo": {"dominant": "#0e0e11", "secondary": [], "samplingNotes": "Albedo is the de-lit reference projected from the matched camera; this colour is the fallback for surfaces the camera never saw."}, "colorVariation": {"palette": ["#171310", "#13100d"], "pattern": "flat", "amplitude": 0.05, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.5, "variation": 0.08, "map": "independent-procedural-field", "localResponse": ""}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "crown-sheen", "kind": "gloss", "description": "Highlight band across the top of the hair", "region": [0.4, 0.1, 0.2, 0.05], "affects": "roughness", "value": 0.32, "evidenceRef": "face-landmarks"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"version": "1.0", "sourceImage": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-hair.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.831, "estimatedFidelity": 0.831, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\hair\\hair_albedo.png", "url": "/sculpt-evidence/hair/hair_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\hair\\hair_roughness.png", "url": "/sculpt-evidence/hair/hair_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\hair\\hair_height.png", "url": "/sculpt-evidence/hair/hair_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\hair\\hair_normal.png", "url": "/sculpt-evidence/hair/hair_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\hair\\hair_ao.png", "url": "/sculpt-evidence/hair/hair_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 280, "sourceHeight": 70, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 280, "height": 70}, "mask": {"backgroundColor": "#617876", "backgroundNoise": 151.664, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.2739}, "mapStats": {"valueRange": 0.14, "heightP90Gradient": 0.04302, "roughnessBase": 0.691, "roughnessVariation": 0.085, "normalStrength": 0.207, "blurRadius": 21}, "palette": ["#0E0F12", "#161519", "#090A0C", "#201D1F", "#3C3737"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"]}},
    options
  );
  materialMap["cloth"] = createSculptMaterial(
    "cloth",
    {"id": "cloth", "name": "Black knit and woven cloth (projected photo)", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#18191d", "color": "#18191d", "albedo": {"dominant": "#18191d", "secondary": [], "samplingNotes": "Albedo is the de-lit reference projected from the matched camera; this colour is the fallback for surfaces the camera never saw."}, "colorVariation": {"palette": ["#20202a", "#1a1a22"], "pattern": "flat", "amplitude": 0.05, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.88, "variation": 0.08, "map": "independent-procedural-field", "localResponse": ""}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"version": "1.0", "sourceImage": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-torso.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.766, "estimatedFidelity": 0.766, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\cloth\\cloth_albedo.png", "url": "/sculpt-evidence/cloth/cloth_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\cloth\\cloth_roughness.png", "url": "/sculpt-evidence/cloth/cloth_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\cloth\\cloth_height.png", "url": "/sculpt-evidence/cloth/cloth_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\cloth\\cloth_normal.png", "url": "/sculpt-evidence/cloth/cloth_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\cloth\\cloth_ao.png", "url": "/sculpt-evidence/cloth/cloth_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 120, "sourceHeight": 160, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 120, "height": 160}, "mask": {"backgroundColor": "#131416", "backgroundNoise": 8.66, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.157}, "mapStats": {"valueRange": 0.08, "heightP90Gradient": 0.01143, "roughnessBase": 0.68, "roughnessVariation": 0.05, "normalStrength": 0.17, "blurRadius": 21}, "palette": ["#17181C", "#0E0F12", "#15161A", "#121317", "#191A1E"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"]}},
    options
  );
  materialMap["lens-glass"] = createSculptMaterial(
    "lens-glass",
    {"id": "lens-glass", "name": "Dark lens glass", "type": "physical", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#181519", "color": "#181519", "albedo": {"dominant": "#181519", "secondary": [], "samplingNotes": "Dark neutral glass; reflections in the photo are specular, not albedo."}, "colorVariation": {"palette": ["#f2eee4", "#c6c3bb"], "pattern": "flat", "amplitude": 0.05, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.08, "variation": 0.08, "map": "independent-procedural-field", "localResponse": ""}, "metalness": {"base": 0.1, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "lens-reflection", "kind": "gloss", "description": "Sharp environment reflections on the lenses", "region": [0.41, 0.235, 0.19, 0.09], "affects": "roughness", "value": 0.06, "evidenceRef": "face-landmarks"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"version": "1.0", "sourceImage": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-lens-r.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.831, "estimatedFidelity": 0.831, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\lens-glass\\lens-glass_albedo.png", "url": "/sculpt-evidence/lens-glass/lens-glass_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\lens-glass\\lens-glass_roughness.png", "url": "/sculpt-evidence/lens-glass/lens-glass_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\lens-glass\\lens-glass_height.png", "url": "/sculpt-evidence/lens-glass/lens-glass_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\lens-glass\\lens-glass_normal.png", "url": "/sculpt-evidence/lens-glass/lens-glass_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\lens-glass\\lens-glass_ao.png", "url": "/sculpt-evidence/lens-glass/lens-glass_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 70, "sourceHeight": 60, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 70, "height": 60}, "mask": {"backgroundColor": "#262428", "backgroundNoise": 17.493, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.3757}, "mapStats": {"valueRange": 0.0944, "heightP90Gradient": 0.02613, "roughnessBase": 0.687, "roughnessVariation": 0.05, "normalStrength": 0.187, "blurRadius": 21}, "palette": ["#222127", "#1D1B20", "#151115", "#1A161A", "#494A4F"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"]}},
    options
  );
  materialMap["frame-metal"] = createSculptMaterial(
    "frame-metal",
    {"id": "frame-metal", "name": "Silver wire frame", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#909398", "color": "#909398", "albedo": {"dominant": "#909398", "secondary": [], "samplingNotes": "Raw silver metal."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.3, "variation": 0.08, "map": "independent-procedural-field", "localResponse": ""}, "metalness": {"base": 1.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"version": "1.0", "sourceImage": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-rim.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.786, "estimatedFidelity": 0.786, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\frame-metal\\frame-metal_albedo.png", "url": "/sculpt-evidence/frame-metal/frame-metal_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\frame-metal\\frame-metal_roughness.png", "url": "/sculpt-evidence/frame-metal/frame-metal_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\frame-metal\\frame-metal_height.png", "url": "/sculpt-evidence/frame-metal/frame-metal_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\frame-metal\\frame-metal_normal.png", "url": "/sculpt-evidence/frame-metal/frame-metal_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\frame-metal\\frame-metal_ao.png", "url": "/sculpt-evidence/frame-metal/frame-metal_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 32, "sourceHeight": 8, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 32, "height": 8}, "mask": {"backgroundColor": "#828688", "backgroundNoise": 99.318, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.4474, "heightP90Gradient": 0.0225, "roughnessBase": 0.692, "roughnessVariation": 0.05, "normalStrength": 0.183, "blurRadius": 21}, "palette": ["#96989E", "#2E312F", "#878A8D", "#474A4A", "#6A6D6D"]}, "warnings": ["foreground mask is tiny; material extraction is likely unreliable", "image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}},
    options
  );
  materialMap["chain-gold"] = createSculptMaterial(
    "chain-gold",
    {"id": "chain-gold", "name": "Gold chain", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#b39a64", "color": "#b39a64", "albedo": {"dominant": "#b39a64", "secondary": [], "samplingNotes": "Warm yellow gold."}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.25, "variation": 0.08, "map": "independent-procedural-field", "localResponse": ""}, "metalness": {"base": 1.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"version": "1.0", "sourceImage": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-chain.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.829, "estimatedFidelity": 0.829, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\chain-gold\\chain-gold_albedo.png", "url": "/sculpt-evidence/chain-gold/chain-gold_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\chain-gold\\chain-gold_roughness.png", "url": "/sculpt-evidence/chain-gold/chain-gold_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\chain-gold\\chain-gold_height.png", "url": "/sculpt-evidence/chain-gold/chain-gold_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\chain-gold\\chain-gold_normal.png", "url": "/sculpt-evidence/chain-gold/chain-gold_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\chain-gold\\chain-gold_ao.png", "url": "/sculpt-evidence/chain-gold/chain-gold_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 32, "sourceHeight": 7, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 32, "height": 7}, "mask": {"backgroundColor": "#644F35", "backgroundNoise": 107.452, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.6121, "heightP90Gradient": 0.02863, "roughnessBase": 0.698, "roughnessVariation": 0.057, "normalStrength": 0.19, "blurRadius": 21}, "palette": ["#2C1F0F", "#8F7F62", "#4B3D24", "#B8A88D", "#67583C"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_torso_0 = makeAttachmentEndpoint(null);
  const node_torso_0 = new THREE.Group();
  node_torso_0.name = "Torso, shoulders and neck__pivot";
  node_torso_0.scale.set(1, 1, 1);
  if (endpoint_torso_0) {
    node_torso_0.position.copy(endpoint_torso_0.start);
    node_torso_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_torso_0.position.set(0.0, 0.0, 0.0);
    node_torso_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_torso_0.userData.sculptComponent = {"id": "torso", "name": "Torso, shoulders and neck", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.7, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Chest, sloped shoulders, upper arms and neck read as one continuous clothed surface with no seam; cut flat where the photo crops.", "geometryDescriptor": {"topologyIntent": "Torso, shoulders and neck", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "sdf": {"primitives": [{"id": "chest", "type": "ellipsoid", "center": [-0.06, -0.95, -0.15], "radii": [0.92, 0.95, 0.42]}, {"id": "shoulders", "type": "capsule", "radius": 0.25, "height": 1.25, "transform": {"position": [-0.06, -0.34, -0.12], "rotation": [0, 0, 1.5708], "scale": [1, 1, 1]}}, {"id": "arm-r", "type": "capsule", "radius": 0.24, "height": 1.2, "transform": {"position": [-0.93, -1.05, -0.12], "rotation": [0, 0, -0.08], "scale": [1, 1, 1]}}, {"id": "arm-l", "type": "capsule", "radius": 0.24, "height": 1.2, "transform": {"position": [0.8, -1.05, -0.12], "rotation": [0, 0, 0.08], "scale": [1, 1, 1]}}, {"id": "collar-mound", "type": "ellipsoid", "center": [-0.05, -0.08, -0.06], "radii": [0.4, 0.25, 0.3]}, {"id": "neck", "type": "capsule", "radius": 0.165, "height": 0.45, "center": [-0.05, 0.13, -0.1]}, {"id": "crop", "type": "box", "center": [0, -2.3, 0], "size": [4, 1.43, 4]}], "operations": [{"id": "u-shoulders", "type": "smooth-union", "left": "chest", "right": "shoulders", "radius": 0.25}, {"id": "u-arm-r", "type": "smooth-union", "left": "u-shoulders", "right": "arm-r", "radius": 0.12}, {"id": "u-arm-l", "type": "smooth-union", "left": "u-arm-r", "right": "arm-l", "radius": 0.12}, {"id": "u-collar-mound", "type": "smooth-union", "left": "u-arm-l", "right": "collar-mound", "radius": 0.2}, {"id": "u-neck", "type": "smooth-union", "left": "u-collar-mound", "right": "neck", "radius": 0.12}, {"id": "bust", "type": "subtract", "left": "u-neck", "right": "crop"}], "resolution": 64, "bounds": {"min": [-1.35, -1.62, -0.75], "max": [1.25, 0.42, 0.55]}}}, "parent": null, "attachment": null, "dimensions": {"width": 2.1, "height": 1.9, "depth": 0.9, "units": "world", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "torso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "cloth"}}, "material": "cloth", "materialLayers": ["cloth"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lapel-edge", "kind": "seam", "description": "Open overshirt collar lapels framing the turtleneck (projected albedo edge)", "region": [0.25, 0.47, 0.5, 0.12], "evidenceRef": "face-landmarks", "confidence": 0.7}, {"id": "pocket-outline", "kind": "seam", "description": "Patch pocket on the subject-left chest (projected)", "region": [0.6, 0.73, 0.12, 0.12], "evidenceRef": "face-landmarks", "confidence": 0.6}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "torso", "dominantAlbedo": "rgba(24, 25, 29, 1.0)", "secondaryAlbedo": "rgba(21, 22, 25, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.6, "roughnessEstimate": 0.87, "metalnessEstimate": 0.0, "highlightEvidence": "broad, gradually-fading highlight — supports high roughness/diffuse response", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-torso.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.389}}};
  node_torso_0.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "torso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "cloth"}};
  (nodes["root"] ?? root).add(node_torso_0);
  nodes["torso"] = node_torso_0;
  const mesh_torso_0Geometry = polygonizeSdf({"primitives": [{"id": "chest", "type": "ellipsoid", "center": [-0.06, -0.95, -0.15], "radii": [0.92, 0.95, 0.42]}, {"id": "shoulders", "type": "capsule", "radius": 0.25, "height": 1.25, "transform": {"position": [-0.06, -0.34, -0.12], "rotation": [0, 0, 1.5708], "scale": [1, 1, 1]}}, {"id": "arm-r", "type": "capsule", "radius": 0.24, "height": 1.2, "transform": {"position": [-0.93, -1.05, -0.12], "rotation": [0, 0, -0.08], "scale": [1, 1, 1]}}, {"id": "arm-l", "type": "capsule", "radius": 0.24, "height": 1.2, "transform": {"position": [0.8, -1.05, -0.12], "rotation": [0, 0, 0.08], "scale": [1, 1, 1]}}, {"id": "collar-mound", "type": "ellipsoid", "center": [-0.05, -0.08, -0.06], "radii": [0.4, 0.25, 0.3]}, {"id": "neck", "type": "capsule", "radius": 0.165, "height": 0.45, "center": [-0.05, 0.13, -0.1]}, {"id": "crop", "type": "box", "center": [0, -2.3, 0], "size": [4, 1.43, 4]}], "operations": [{"id": "u-shoulders", "type": "smooth-union", "left": "chest", "right": "shoulders", "radius": 0.25}, {"id": "u-arm-r", "type": "smooth-union", "left": "u-shoulders", "right": "arm-r", "radius": 0.12}, {"id": "u-arm-l", "type": "smooth-union", "left": "u-arm-r", "right": "arm-l", "radius": 0.12}, {"id": "u-collar-mound", "type": "smooth-union", "left": "u-arm-l", "right": "collar-mound", "radius": 0.2}, {"id": "u-neck", "type": "smooth-union", "left": "u-collar-mound", "right": "neck", "radius": 0.12}, {"id": "bust", "type": "subtract", "left": "u-neck", "right": "crop"}], "resolution": 64, "bounds": {"min": [-1.35, -1.62, -0.75], "max": [1.25, 0.42, 0.55]}});
  if (!endpoint_torso_0) {
    mesh_torso_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_torso_0 = new THREE.SkinnedMesh(
    mesh_torso_0Geometry,
    createSculptMaterial("cloth", {"id": "cloth", "name": "Black knit and woven cloth (projected photo)", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#18191d", "color": "#18191d", "albedo": {"dominant": "#18191d", "secondary": [], "samplingNotes": "Albedo is the de-lit reference projected from the matched camera; this colour is the fallback for surfaces the camera never saw."}, "colorVariation": {"palette": ["#20202a", "#1a1a22"], "pattern": "flat", "amplitude": 0.05, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.88, "variation": 0.08, "map": "independent-procedural-field", "localResponse": ""}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"version": "1.0", "sourceImage": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-torso.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.766, "estimatedFidelity": 0.766, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\cloth\\cloth_albedo.png", "url": "/sculpt-evidence/cloth/cloth_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\cloth\\cloth_roughness.png", "url": "/sculpt-evidence/cloth/cloth_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\cloth\\cloth_height.png", "url": "/sculpt-evidence/cloth/cloth_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\cloth\\cloth_normal.png", "url": "/sculpt-evidence/cloth/cloth_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\cloth\\cloth_ao.png", "url": "/sculpt-evidence/cloth/cloth_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 120, "sourceHeight": 160, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 120, "height": 160}, "mask": {"backgroundColor": "#131416", "backgroundNoise": 8.66, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.157}, "mapStats": {"valueRange": 0.08, "heightP90Gradient": 0.01143, "roughnessBase": 0.68, "roughnessVariation": 0.05, "normalStrength": 0.17, "blurRadius": 21}, "palette": ["#17181C", "#0E0F12", "#15161A", "#121317", "#191A1E"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"]}}, options, true)
  );
  mesh_torso_0.name = "Torso, shoulders and neck";
  if (endpoint_torso_0) {
    mesh_torso_0.position.copy(endpoint_torso_0.midpoint);
    mesh_torso_0.quaternion.copy(endpoint_torso_0.quaternion);
  }
  mesh_torso_0.castShadow = options.castShadow ?? true;
  mesh_torso_0.receiveShadow = options.receiveShadow ?? true;
  mesh_torso_0.userData.sculptComponent = {"id": "torso", "name": "Torso, shoulders and neck", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.7, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Chest, sloped shoulders, upper arms and neck read as one continuous clothed surface with no seam; cut flat where the photo crops.", "geometryDescriptor": {"topologyIntent": "Torso, shoulders and neck", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "sdf": {"primitives": [{"id": "chest", "type": "ellipsoid", "center": [-0.06, -0.95, -0.15], "radii": [0.92, 0.95, 0.42]}, {"id": "shoulders", "type": "capsule", "radius": 0.25, "height": 1.25, "transform": {"position": [-0.06, -0.34, -0.12], "rotation": [0, 0, 1.5708], "scale": [1, 1, 1]}}, {"id": "arm-r", "type": "capsule", "radius": 0.24, "height": 1.2, "transform": {"position": [-0.93, -1.05, -0.12], "rotation": [0, 0, -0.08], "scale": [1, 1, 1]}}, {"id": "arm-l", "type": "capsule", "radius": 0.24, "height": 1.2, "transform": {"position": [0.8, -1.05, -0.12], "rotation": [0, 0, 0.08], "scale": [1, 1, 1]}}, {"id": "collar-mound", "type": "ellipsoid", "center": [-0.05, -0.08, -0.06], "radii": [0.4, 0.25, 0.3]}, {"id": "neck", "type": "capsule", "radius": 0.165, "height": 0.45, "center": [-0.05, 0.13, -0.1]}, {"id": "crop", "type": "box", "center": [0, -2.3, 0], "size": [4, 1.43, 4]}], "operations": [{"id": "u-shoulders", "type": "smooth-union", "left": "chest", "right": "shoulders", "radius": 0.25}, {"id": "u-arm-r", "type": "smooth-union", "left": "u-shoulders", "right": "arm-r", "radius": 0.12}, {"id": "u-arm-l", "type": "smooth-union", "left": "u-arm-r", "right": "arm-l", "radius": 0.12}, {"id": "u-collar-mound", "type": "smooth-union", "left": "u-arm-l", "right": "collar-mound", "radius": 0.2}, {"id": "u-neck", "type": "smooth-union", "left": "u-collar-mound", "right": "neck", "radius": 0.12}, {"id": "bust", "type": "subtract", "left": "u-neck", "right": "crop"}], "resolution": 64, "bounds": {"min": [-1.35, -1.62, -0.75], "max": [1.25, 0.42, 0.55]}}}, "parent": null, "attachment": null, "dimensions": {"width": 2.1, "height": 1.9, "depth": 0.9, "units": "world", "confidence": 0.7}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "torso", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "cloth"}}, "material": "cloth", "materialLayers": ["cloth"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lapel-edge", "kind": "seam", "description": "Open overshirt collar lapels framing the turtleneck (projected albedo edge)", "region": [0.25, 0.47, 0.5, 0.12], "evidenceRef": "face-landmarks", "confidence": 0.7}, {"id": "pocket-outline", "kind": "seam", "description": "Patch pocket on the subject-left chest (projected)", "region": [0.6, 0.73, 0.12, 0.12], "evidenceRef": "face-landmarks", "confidence": 0.6}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "torso", "dominantAlbedo": "rgba(24, 25, 29, 1.0)", "secondaryAlbedo": "rgba(21, 22, 25, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.6, "roughnessEstimate": 0.87, "metalnessEstimate": 0.0, "highlightEvidence": "broad, gradually-fading highlight — supports high roughness/diffuse response", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-torso.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.389}}};
  node_torso_0.add(mesh_torso_0);
  meshes["torso"] = mesh_torso_0;
  colliders["torso"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["torso"] ??= [];
  destructionGroups["torso"].push(node_torso_0);

  const endpoint_turtleneck_collar_1 = makeAttachmentEndpoint(null);
  const node_turtleneck_collar_1 = new THREE.Group();
  node_turtleneck_collar_1.name = "Rolled turtleneck collar__pivot";
  node_turtleneck_collar_1.scale.set(1, 1, 1);
  if (endpoint_turtleneck_collar_1) {
    node_turtleneck_collar_1.position.copy(endpoint_turtleneck_collar_1.start);
    node_turtleneck_collar_1.rotation.set(1.5708, 0.0, 0.0);
  } else {
    node_turtleneck_collar_1.position.set(-0.05, 0.17, -0.09);
    node_turtleneck_collar_1.rotation.set(1.5708, 0.0, 0.0);
  }
  node_turtleneck_collar_1.userData.sculptComponent = {"id": "turtleneck-collar", "name": "Rolled turtleneck collar", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "A rolled knit tube wrapped around the neck base.", "geometryDescriptor": {"topologyIntent": "Rolled turtleneck collar", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.16}, "parent": "torso", "attachment": {"parentSocket": "neck-base", "localStart": [-0.05, 0.12, -0.09], "localEnd": [-0.05, 0.22, -0.09], "contactType": "wraps-neck", "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"]}, "dimensions": {"width": 0.4, "height": 0.4, "depth": 0.12, "units": "world", "confidence": 0.75}, "transform": {"position": [-0.05, 0.17, -0.09], "rotation": [1.5708, 0, 0], "scale": [0.44, 0.44, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "turtleneck-collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "cloth"}}, "material": "cloth", "materialLayers": ["cloth"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "roll-fold", "kind": "seam", "description": "High rolled turtleneck collar hugging the neck base", "region": [0.39, 0.44, 0.2, 0.07], "evidenceRef": "face-landmarks", "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "turtleneck-collar", "dominantAlbedo": "rgba(20, 21, 25, 1.0)", "secondaryAlbedo": "rgba(14, 15, 18, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.6, "roughnessEstimate": 0.87, "metalnessEstimate": 0.0, "highlightEvidence": "broad, gradually-fading highlight — supports high roughness/diffuse response", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-turtleneck-collar.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.352}}};
  node_turtleneck_collar_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "turtleneck-collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "cloth"}};
  (nodes["torso"] ?? root).add(node_turtleneck_collar_1);
  nodes["turtleneck-collar"] = node_turtleneck_collar_1;
  const mesh_turtleneck_collar_1Geometry = endpoint_turtleneck_collar_1
    ? new THREE.CylinderGeometry(endpoint_turtleneck_collar_1.endRadius, endpoint_turtleneck_collar_1.baseRadius, endpoint_turtleneck_collar_1.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.072, 24, 96);
  if (!endpoint_turtleneck_collar_1) {
    mesh_turtleneck_collar_1Geometry.scale(0.44, 0.44, 0.5);
  }
  const mesh_turtleneck_collar_1 = new THREE.Mesh(
    mesh_turtleneck_collar_1Geometry,
    materialMap["cloth"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_turtleneck_collar_1.name = "Rolled turtleneck collar";
  if (endpoint_turtleneck_collar_1) {
    mesh_turtleneck_collar_1.position.copy(endpoint_turtleneck_collar_1.midpoint);
    mesh_turtleneck_collar_1.quaternion.copy(endpoint_turtleneck_collar_1.quaternion);
  }
  mesh_turtleneck_collar_1.castShadow = options.castShadow ?? true;
  mesh_turtleneck_collar_1.receiveShadow = options.receiveShadow ?? true;
  mesh_turtleneck_collar_1.userData.sculptComponent = {"id": "turtleneck-collar", "name": "Rolled turtleneck collar", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "A rolled knit tube wrapped around the neck base.", "geometryDescriptor": {"topologyIntent": "Rolled turtleneck collar", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.16}, "parent": "torso", "attachment": {"parentSocket": "neck-base", "localStart": [-0.05, 0.12, -0.09], "localEnd": [-0.05, 0.22, -0.09], "contactType": "wraps-neck", "embedDepth": 0.03, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"]}, "dimensions": {"width": 0.4, "height": 0.4, "depth": 0.12, "units": "world", "confidence": 0.75}, "transform": {"position": [-0.05, 0.17, -0.09], "rotation": [1.5708, 0, 0], "scale": [0.44, 0.44, 0.5]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "turtleneck-collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "cloth"}}, "material": "cloth", "materialLayers": ["cloth"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "roll-fold", "kind": "seam", "description": "High rolled turtleneck collar hugging the neck base", "region": [0.39, 0.44, 0.2, 0.07], "evidenceRef": "face-landmarks", "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "turtleneck-collar", "dominantAlbedo": "rgba(20, 21, 25, 1.0)", "secondaryAlbedo": "rgba(14, 15, 18, 1.0)", "materialClass": "fabric", "materialClassConfidence": 0.6, "roughnessEstimate": 0.87, "metalnessEstimate": 0.0, "highlightEvidence": "broad, gradually-fading highlight — supports high roughness/diffuse response", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-turtleneck-collar.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.352}}};
  node_turtleneck_collar_1.add(mesh_turtleneck_collar_1);
  meshes["turtleneck-collar"] = mesh_turtleneck_collar_1;
  colliders["turtleneck-collar"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["turtleneck-collar"] ??= [];
  destructionGroups["turtleneck-collar"].push(node_turtleneck_collar_1);

  const endpoint_head_2 = makeAttachmentEndpoint(null);
  const node_head_2 = new THREE.Group();
  node_head_2.name = "Head__pivot";
  node_head_2.scale.set(1, 1, 1);
  if (endpoint_head_2) {
    node_head_2.position.copy(endpoint_head_2.start);
    node_head_2.rotation.set(0.0, 0.13962634015954636, -0.10471975511965978);
  } else {
    node_head_2.position.set(-0.0382, 0.6876, 0.0);
    node_head_2.rotation.set(0.0, 0.13962634015954636, -0.10471975511965978);
  }
  node_head_2.userData.sculptComponent = {"id": "head", "name": "Head", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.72, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Cranium, face mass, jaw, cheekbones, brow, nose, lips and ears blend into one continuous skin surface.", "geometryDescriptor": {"topologyIntent": "Head", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "sdf": {"primitives": [{"id": "cranium", "type": "ellipsoid", "center": [0.0, 0.0955, -0.0573], "radii": [0.3342, 0.4011, 0.4202]}, {"id": "face", "type": "ellipsoid", "center": [0.0, -0.0955, 0.0669], "radii": [0.2865, 0.4011, 0.3151]}, {"id": "jaw", "type": "ellipsoid", "center": [0.0, -0.3438, 0.0955], "radii": [0.2101, 0.1528, 0.2101]}, {"id": "chin", "type": "ellipsoid", "center": [0.0, -0.4202, 0.191], "radii": [0.0955, 0.0669, 0.0955]}, {"id": "cheek-r", "type": "ellipsoid", "center": [-0.2101, -0.0478, 0.191], "radii": [0.105, 0.0955, 0.1241]}, {"id": "cheek-l", "type": "ellipsoid", "center": [0.2101, -0.0478, 0.191], "radii": [0.105, 0.0955, 0.1241]}, {"id": "brow", "type": "ellipsoid", "center": [0.0, 0.1146, 0.2674], "radii": [0.2579, 0.0669, 0.0955]}, {"id": "nose-bridge", "type": "ellipsoid", "radii": [0.0525, 0.1337, 0.0669], "transform": {"position": [0.0, -0.0191, 0.3533], "rotation": [-0.25, 0, 0], "scale": [1, 1, 1]}}, {"id": "nose-tip", "type": "sphere", "center": [0.0, -0.1528, 0.3868], "radius": 0.0573}, {"id": "nostrils", "type": "ellipsoid", "center": [0.0, -0.1719, 0.3342], "radii": [0.0907, 0.043, 0.0621]}, {"id": "lips", "type": "ellipsoid", "center": [0.0, -0.2865, 0.3247], "radii": [0.105, 0.0478, 0.0621]}, {"id": "ear-r", "type": "ellipsoid", "center": [-0.3438, -0.0955, -0.0191], "radii": [0.0478, 0.1194, 0.0812]}, {"id": "ear-l", "type": "ellipsoid", "center": [0.3438, -0.0955, -0.0191], "radii": [0.0478, 0.1194, 0.0812]}], "operations": [{"id": "u-face", "type": "smooth-union", "left": "cranium", "right": "face", "radius": 0.1146}, {"id": "u-jaw", "type": "smooth-union", "left": "u-face", "right": "jaw", "radius": 0.1337}, {"id": "u-chin", "type": "smooth-union", "left": "u-jaw", "right": "chin", "radius": 0.0764}, {"id": "u-cheek-r", "type": "smooth-union", "left": "u-chin", "right": "cheek-r", "radius": 0.0764}, {"id": "u-cheek-l", "type": "smooth-union", "left": "u-cheek-r", "right": "cheek-l", "radius": 0.0764}, {"id": "u-brow", "type": "smooth-union", "left": "u-cheek-l", "right": "brow", "radius": 0.0669}, {"id": "u-nose-bridge", "type": "smooth-union", "left": "u-brow", "right": "nose-bridge", "radius": 0.0478}, {"id": "u-nose-tip", "type": "smooth-union", "left": "u-nose-bridge", "right": "nose-tip", "radius": 0.0382}, {"id": "u-nostrils", "type": "smooth-union", "left": "u-nose-tip", "right": "nostrils", "radius": 0.0382}, {"id": "u-lips", "type": "smooth-union", "left": "u-nostrils", "right": "lips", "radius": 0.0382}, {"id": "u-ear-r", "type": "smooth-union", "left": "u-lips", "right": "ear-r", "radius": 0.0286}, {"id": "u-ear-l", "type": "smooth-union", "left": "u-ear-r", "right": "ear-l", "radius": 0.0286}], "resolution": 64, "bounds": {"min": [-0.55, -0.62, -0.55], "max": [0.55, 0.62, 0.6]}}}, "parent": "torso", "attachment": null, "dimensions": {"width": 0.72, "height": 1.02, "depth": 0.95, "units": "world", "confidence": 0.72}, "transform": {"position": [-0.0382, 0.6876, 0.0], "rotation": [0.0, 0.13962634015954636, -0.10471975511965978], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "look-at", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin-projected"}}, "material": "skin-projected", "materialLayers": ["skin-projected"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "ear-helix", "kind": "contour", "description": "Both ears; viewer-left ear more exposed by the head yaw", "region": [0.35, 0.265, 0.26, 0.1], "evidenceRef": "face-landmarks", "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "head", "dominantAlbedo": "rgba(175, 112, 78, 1.0)", "secondaryAlbedo": "rgba(201, 135, 98, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.6, "roughnessEstimate": 0.459, "metalnessEstimate": 0.0, "highlightEvidence": "moderate hotspot spread — mid-range roughness", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-head.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.351}}};
  node_head_2.userData.actionProfile = {"animationRole": "look-at", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin-projected"}};
  (nodes["torso"] ?? root).add(node_head_2);
  nodes["head"] = node_head_2;
  const mesh_head_2Geometry = polygonizeSdf({"primitives": [{"id": "cranium", "type": "ellipsoid", "center": [0.0, 0.0955, -0.0573], "radii": [0.3342, 0.4011, 0.4202]}, {"id": "face", "type": "ellipsoid", "center": [0.0, -0.0955, 0.0669], "radii": [0.2865, 0.4011, 0.3151]}, {"id": "jaw", "type": "ellipsoid", "center": [0.0, -0.3438, 0.0955], "radii": [0.2101, 0.1528, 0.2101]}, {"id": "chin", "type": "ellipsoid", "center": [0.0, -0.4202, 0.191], "radii": [0.0955, 0.0669, 0.0955]}, {"id": "cheek-r", "type": "ellipsoid", "center": [-0.2101, -0.0478, 0.191], "radii": [0.105, 0.0955, 0.1241]}, {"id": "cheek-l", "type": "ellipsoid", "center": [0.2101, -0.0478, 0.191], "radii": [0.105, 0.0955, 0.1241]}, {"id": "brow", "type": "ellipsoid", "center": [0.0, 0.1146, 0.2674], "radii": [0.2579, 0.0669, 0.0955]}, {"id": "nose-bridge", "type": "ellipsoid", "radii": [0.0525, 0.1337, 0.0669], "transform": {"position": [0.0, -0.0191, 0.3533], "rotation": [-0.25, 0, 0], "scale": [1, 1, 1]}}, {"id": "nose-tip", "type": "sphere", "center": [0.0, -0.1528, 0.3868], "radius": 0.0573}, {"id": "nostrils", "type": "ellipsoid", "center": [0.0, -0.1719, 0.3342], "radii": [0.0907, 0.043, 0.0621]}, {"id": "lips", "type": "ellipsoid", "center": [0.0, -0.2865, 0.3247], "radii": [0.105, 0.0478, 0.0621]}, {"id": "ear-r", "type": "ellipsoid", "center": [-0.3438, -0.0955, -0.0191], "radii": [0.0478, 0.1194, 0.0812]}, {"id": "ear-l", "type": "ellipsoid", "center": [0.3438, -0.0955, -0.0191], "radii": [0.0478, 0.1194, 0.0812]}], "operations": [{"id": "u-face", "type": "smooth-union", "left": "cranium", "right": "face", "radius": 0.1146}, {"id": "u-jaw", "type": "smooth-union", "left": "u-face", "right": "jaw", "radius": 0.1337}, {"id": "u-chin", "type": "smooth-union", "left": "u-jaw", "right": "chin", "radius": 0.0764}, {"id": "u-cheek-r", "type": "smooth-union", "left": "u-chin", "right": "cheek-r", "radius": 0.0764}, {"id": "u-cheek-l", "type": "smooth-union", "left": "u-cheek-r", "right": "cheek-l", "radius": 0.0764}, {"id": "u-brow", "type": "smooth-union", "left": "u-cheek-l", "right": "brow", "radius": 0.0669}, {"id": "u-nose-bridge", "type": "smooth-union", "left": "u-brow", "right": "nose-bridge", "radius": 0.0478}, {"id": "u-nose-tip", "type": "smooth-union", "left": "u-nose-bridge", "right": "nose-tip", "radius": 0.0382}, {"id": "u-nostrils", "type": "smooth-union", "left": "u-nose-tip", "right": "nostrils", "radius": 0.0382}, {"id": "u-lips", "type": "smooth-union", "left": "u-nostrils", "right": "lips", "radius": 0.0382}, {"id": "u-ear-r", "type": "smooth-union", "left": "u-lips", "right": "ear-r", "radius": 0.0286}, {"id": "u-ear-l", "type": "smooth-union", "left": "u-ear-r", "right": "ear-l", "radius": 0.0286}], "resolution": 64, "bounds": {"min": [-0.55, -0.62, -0.55], "max": [0.55, 0.62, 0.6]}});
  if (!endpoint_head_2) {
    mesh_head_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_head_2 = new THREE.SkinnedMesh(
    mesh_head_2Geometry,
    createSculptMaterial("skin-projected", {"id": "skin-projected", "name": "Skin (projected photo)", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#af704e", "color": "#af704e", "albedo": {"dominant": "#af704e", "secondary": [], "samplingNotes": "Albedo is the de-lit reference projected from the matched camera; this colour is the fallback for surfaces the camera never saw."}, "colorVariation": {"palette": ["#e8b98f", "#be9875"], "pattern": "flat", "amplitude": 0.05, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.55, "variation": 0.08, "map": "independent-procedural-field", "localResponse": ""}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "moustache", "kind": "stain", "description": "Thin dark moustache over the upper lip (carried by projection)", "region": [0.455, 0.345, 0.075, 0.02], "affects": "albedo", "value": "projected", "evidenceRef": "face-landmarks"}, {"id": "lip-tint", "kind": "stain", "description": "Warmer, pinker lips (carried by projection)", "region": [0.46, 0.36, 0.065, 0.028], "affects": "albedo", "value": "projected", "evidenceRef": "face-landmarks"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"version": "1.0", "sourceImage": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-head.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.779, "estimatedFidelity": 0.779, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\skin-projected\\skin-projected_albedo.png", "url": "/sculpt-evidence/skin-projected/skin-projected_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\skin-projected\\skin-projected_roughness.png", "url": "/sculpt-evidence/skin-projected/skin-projected_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\skin-projected\\skin-projected_height.png", "url": "/sculpt-evidence/skin-projected/skin-projected_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\skin-projected\\skin-projected_normal.png", "url": "/sculpt-evidence/skin-projected/skin-projected_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\skin-projected\\skin-projected_ao.png", "url": "/sculpt-evidence/skin-projected/skin-projected_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 160, "sourceHeight": 100, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 160, "height": 100}, "mask": {"backgroundColor": "#B57553", "backgroundNoise": 64.699, "transparentPixelFraction": 0.0, "foregroundCoverage": 1.0}, "mapStats": {"valueRange": 0.2775, "heightP90Gradient": 0.02162, "roughnessBase": 0.707, "roughnessVariation": 0.05, "normalStrength": 0.182, "blurRadius": 21}, "palette": ["#C3815C", "#B47351", "#87523C", "#D0916B", "#9F6345"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}}, options, true)
  );
  mesh_head_2.name = "Head";
  if (endpoint_head_2) {
    mesh_head_2.position.copy(endpoint_head_2.midpoint);
    mesh_head_2.quaternion.copy(endpoint_head_2.quaternion);
  }
  mesh_head_2.castShadow = options.castShadow ?? true;
  mesh_head_2.receiveShadow = options.receiveShadow ?? true;
  mesh_head_2.userData.sculptComponent = {"id": "head", "name": "Head", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.72, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Cranium, face mass, jaw, cheekbones, brow, nose, lips and ears blend into one continuous skin surface.", "geometryDescriptor": {"topologyIntent": "Head", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "sdf": {"primitives": [{"id": "cranium", "type": "ellipsoid", "center": [0.0, 0.0955, -0.0573], "radii": [0.3342, 0.4011, 0.4202]}, {"id": "face", "type": "ellipsoid", "center": [0.0, -0.0955, 0.0669], "radii": [0.2865, 0.4011, 0.3151]}, {"id": "jaw", "type": "ellipsoid", "center": [0.0, -0.3438, 0.0955], "radii": [0.2101, 0.1528, 0.2101]}, {"id": "chin", "type": "ellipsoid", "center": [0.0, -0.4202, 0.191], "radii": [0.0955, 0.0669, 0.0955]}, {"id": "cheek-r", "type": "ellipsoid", "center": [-0.2101, -0.0478, 0.191], "radii": [0.105, 0.0955, 0.1241]}, {"id": "cheek-l", "type": "ellipsoid", "center": [0.2101, -0.0478, 0.191], "radii": [0.105, 0.0955, 0.1241]}, {"id": "brow", "type": "ellipsoid", "center": [0.0, 0.1146, 0.2674], "radii": [0.2579, 0.0669, 0.0955]}, {"id": "nose-bridge", "type": "ellipsoid", "radii": [0.0525, 0.1337, 0.0669], "transform": {"position": [0.0, -0.0191, 0.3533], "rotation": [-0.25, 0, 0], "scale": [1, 1, 1]}}, {"id": "nose-tip", "type": "sphere", "center": [0.0, -0.1528, 0.3868], "radius": 0.0573}, {"id": "nostrils", "type": "ellipsoid", "center": [0.0, -0.1719, 0.3342], "radii": [0.0907, 0.043, 0.0621]}, {"id": "lips", "type": "ellipsoid", "center": [0.0, -0.2865, 0.3247], "radii": [0.105, 0.0478, 0.0621]}, {"id": "ear-r", "type": "ellipsoid", "center": [-0.3438, -0.0955, -0.0191], "radii": [0.0478, 0.1194, 0.0812]}, {"id": "ear-l", "type": "ellipsoid", "center": [0.3438, -0.0955, -0.0191], "radii": [0.0478, 0.1194, 0.0812]}], "operations": [{"id": "u-face", "type": "smooth-union", "left": "cranium", "right": "face", "radius": 0.1146}, {"id": "u-jaw", "type": "smooth-union", "left": "u-face", "right": "jaw", "radius": 0.1337}, {"id": "u-chin", "type": "smooth-union", "left": "u-jaw", "right": "chin", "radius": 0.0764}, {"id": "u-cheek-r", "type": "smooth-union", "left": "u-chin", "right": "cheek-r", "radius": 0.0764}, {"id": "u-cheek-l", "type": "smooth-union", "left": "u-cheek-r", "right": "cheek-l", "radius": 0.0764}, {"id": "u-brow", "type": "smooth-union", "left": "u-cheek-l", "right": "brow", "radius": 0.0669}, {"id": "u-nose-bridge", "type": "smooth-union", "left": "u-brow", "right": "nose-bridge", "radius": 0.0478}, {"id": "u-nose-tip", "type": "smooth-union", "left": "u-nose-bridge", "right": "nose-tip", "radius": 0.0382}, {"id": "u-nostrils", "type": "smooth-union", "left": "u-nose-tip", "right": "nostrils", "radius": 0.0382}, {"id": "u-lips", "type": "smooth-union", "left": "u-nostrils", "right": "lips", "radius": 0.0382}, {"id": "u-ear-r", "type": "smooth-union", "left": "u-lips", "right": "ear-r", "radius": 0.0286}, {"id": "u-ear-l", "type": "smooth-union", "left": "u-ear-r", "right": "ear-l", "radius": 0.0286}], "resolution": 64, "bounds": {"min": [-0.55, -0.62, -0.55], "max": [0.55, 0.62, 0.6]}}}, "parent": "torso", "attachment": null, "dimensions": {"width": 0.72, "height": 1.02, "depth": 0.95, "units": "world", "confidence": 0.72}, "transform": {"position": [-0.0382, 0.6876, 0.0], "rotation": [0.0, 0.13962634015954636, -0.10471975511965978], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "look-at", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "head", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "skin-projected"}}, "material": "skin-projected", "materialLayers": ["skin-projected"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "ear-helix", "kind": "contour", "description": "Both ears; viewer-left ear more exposed by the head yaw", "region": [0.35, 0.265, 0.26, 0.1], "evidenceRef": "face-landmarks", "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "head", "dominantAlbedo": "rgba(175, 112, 78, 1.0)", "secondaryAlbedo": "rgba(201, 135, 98, 1.0)", "materialClass": "skin", "materialClassConfidence": 0.6, "roughnessEstimate": 0.459, "metalnessEstimate": 0.0, "highlightEvidence": "moderate hotspot spread — mid-range roughness", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-head.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.351}}};
  node_head_2.add(mesh_head_2);
  meshes["head"] = mesh_head_2;
  colliders["head"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["head"] ??= [];
  destructionGroups["head"].push(node_head_2);

  const endpoint_hair_3 = makeAttachmentEndpoint(null);
  const node_hair_3 = new THREE.Group();
  node_hair_3.name = "Swept-up hair mass__pivot";
  node_hair_3.scale.set(1, 1, 1);
  if (endpoint_hair_3) {
    node_hair_3.position.copy(endpoint_hair_3.start);
    node_hair_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_hair_3.position.set(0.0, 0.0, 0.0);
    node_hair_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_hair_3.userData.sculptComponent = {"id": "hair", "name": "Swept-up hair mass", "level": "macro", "role": "shell", "importance": 0.9, "confidence": 0.65, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Hair reads as a few blended masses (top, quiff, back, sides, loose curls) standing proud of the scalp.", "geometryDescriptor": {"topologyIntent": "Swept-up hair mass", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "sdf": {"primitives": [{"id": "hair-top", "type": "ellipsoid", "center": [0.0191, 0.3629, -0.1528], "radii": [0.3725, 0.2005, 0.4202]}, {"id": "quiff", "type": "ellipsoid", "radii": [0.2674, 0.1146, 0.191], "transform": {"position": [0.0, 0.4488, 0.0955], "rotation": [0.3, 0, 0], "scale": [1, 1, 1]}}, {"id": "hair-back", "type": "ellipsoid", "center": [0.0, 0.1146, -0.191], "radii": [0.3533, 0.382, 0.3151]}, {"id": "side-r", "type": "ellipsoid", "center": [-0.3151, 0.1528, -0.0573], "radii": [0.0669, 0.191, 0.2674]}, {"id": "side-l", "type": "ellipsoid", "center": [0.3151, 0.1528, -0.0573], "radii": [0.0669, 0.191, 0.2674]}, {"id": "curls-l", "type": "ellipsoid", "center": [0.3438, 0.2865, 0.0191], "radii": [0.0764, 0.1146, 0.1337]}], "operations": [{"id": "u-quiff", "type": "smooth-union", "left": "hair-top", "right": "quiff", "radius": 0.0955}, {"id": "u-hair-back", "type": "smooth-union", "left": "u-quiff", "right": "hair-back", "radius": 0.1146}, {"id": "u-side-r", "type": "smooth-union", "left": "u-hair-back", "right": "side-r", "radius": 0.0764}, {"id": "u-side-l", "type": "smooth-union", "left": "u-side-r", "right": "side-l", "radius": 0.0764}, {"id": "u-curls-l", "type": "smooth-union", "left": "u-side-l", "right": "curls-l", "radius": 0.0573}], "resolution": 56, "bounds": {"min": [-0.55, -0.35, -0.6], "max": [0.55, 0.72, 0.55]}}}, "parent": "head", "attachment": null, "dimensions": {"width": 0.8, "height": 0.5, "depth": 0.95, "units": "world", "confidence": 0.65}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pompadour-lift", "kind": "contour", "description": "Hair swept up and back, loose curls at the viewer-right temple", "region": [0.36, 0.09, 0.28, 0.12], "evidenceRef": "face-landmarks", "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "hair", "dominantAlbedo": "rgba(14, 14, 17, 1.0)", "secondaryAlbedo": "rgba(26, 25, 28, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.6, "roughnessEstimate": 0.124, "metalnessEstimate": 0.0, "highlightEvidence": "sharp, tight specular hotspot — supports low roughness/high specularity", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-hair.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.578}}};
  node_hair_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}};
  (nodes["head"] ?? root).add(node_hair_3);
  nodes["hair"] = node_hair_3;
  const mesh_hair_3Geometry = polygonizeSdf({"primitives": [{"id": "hair-top", "type": "ellipsoid", "center": [0.0191, 0.3629, -0.1528], "radii": [0.3725, 0.2005, 0.4202]}, {"id": "quiff", "type": "ellipsoid", "radii": [0.2674, 0.1146, 0.191], "transform": {"position": [0.0, 0.4488, 0.0955], "rotation": [0.3, 0, 0], "scale": [1, 1, 1]}}, {"id": "hair-back", "type": "ellipsoid", "center": [0.0, 0.1146, -0.191], "radii": [0.3533, 0.382, 0.3151]}, {"id": "side-r", "type": "ellipsoid", "center": [-0.3151, 0.1528, -0.0573], "radii": [0.0669, 0.191, 0.2674]}, {"id": "side-l", "type": "ellipsoid", "center": [0.3151, 0.1528, -0.0573], "radii": [0.0669, 0.191, 0.2674]}, {"id": "curls-l", "type": "ellipsoid", "center": [0.3438, 0.2865, 0.0191], "radii": [0.0764, 0.1146, 0.1337]}], "operations": [{"id": "u-quiff", "type": "smooth-union", "left": "hair-top", "right": "quiff", "radius": 0.0955}, {"id": "u-hair-back", "type": "smooth-union", "left": "u-quiff", "right": "hair-back", "radius": 0.1146}, {"id": "u-side-r", "type": "smooth-union", "left": "u-hair-back", "right": "side-r", "radius": 0.0764}, {"id": "u-side-l", "type": "smooth-union", "left": "u-side-r", "right": "side-l", "radius": 0.0764}, {"id": "u-curls-l", "type": "smooth-union", "left": "u-side-l", "right": "curls-l", "radius": 0.0573}], "resolution": 56, "bounds": {"min": [-0.55, -0.35, -0.6], "max": [0.55, 0.72, 0.55]}});
  if (!endpoint_hair_3) {
    mesh_hair_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_hair_3 = new THREE.Mesh(
    mesh_hair_3Geometry,
    createSculptMaterial("hair", {"id": "hair", "name": "Hair (projected photo)", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#0e0e11", "color": "#0e0e11", "albedo": {"dominant": "#0e0e11", "secondary": [], "samplingNotes": "Albedo is the de-lit reference projected from the matched camera; this colour is the fallback for surfaces the camera never saw."}, "colorVariation": {"palette": ["#171310", "#13100d"], "pattern": "flat", "amplitude": 0.05, "heightCorrelation": 0.0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.5, "variation": 0.08, "map": "independent-procedural-field", "localResponse": ""}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24.0, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "crown-sheen", "kind": "gloss", "description": "Highlight band across the top of the hair", "region": [0.4, 0.1, 0.2, 0.05], "affects": "roughness", "value": 0.32, "evidenceRef": "face-landmarks"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"version": "1.0", "sourceImage": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-hair.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.831, "estimatedFidelity": 0.831, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\hair\\hair_albedo.png", "url": "/sculpt-evidence/hair/hair_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\hair\\hair_roughness.png", "url": "/sculpt-evidence/hair/hair_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\hair\\hair_height.png", "url": "/sculpt-evidence/hair/hair_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\hair\\hair_normal.png", "url": "/sculpt-evidence/hair/hair_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "C:\\devs\\my-portfolio\\.img2threejs\\material-evidence\\hair\\hair_ao.png", "url": "/sculpt-evidence/hair/hair_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 280, "sourceHeight": 70, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 280, "height": 70}, "mask": {"backgroundColor": "#617876", "backgroundNoise": 151.664, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.2739}, "mapStats": {"valueRange": 0.14, "heightP90Gradient": 0.04302, "roughnessBase": 0.691, "roughnessVariation": 0.085, "normalStrength": 0.207, "blurRadius": 21}, "palette": ["#0E0F12", "#161519", "#090A0C", "#201D1F", "#3C3737"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"]}}, options, true)
  );
  mesh_hair_3.name = "Swept-up hair mass";
  if (endpoint_hair_3) {
    mesh_hair_3.position.copy(endpoint_hair_3.midpoint);
    mesh_hair_3.quaternion.copy(endpoint_hair_3.quaternion);
  }
  mesh_hair_3.castShadow = options.castShadow ?? true;
  mesh_hair_3.receiveShadow = options.receiveShadow ?? true;
  mesh_hair_3.userData.sculptComponent = {"id": "hair", "name": "Swept-up hair mass", "level": "macro", "role": "shell", "importance": 0.9, "confidence": 0.65, "primitive": "ellipsoid", "topologyClass": "implicit", "topologyRationale": "Hair reads as a few blended masses (top, quiff, back, sides, loose curls) standing proud of the scalp.", "geometryDescriptor": {"topologyIntent": "Swept-up hair mass", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "sdf": {"primitives": [{"id": "hair-top", "type": "ellipsoid", "center": [0.0191, 0.3629, -0.1528], "radii": [0.3725, 0.2005, 0.4202]}, {"id": "quiff", "type": "ellipsoid", "radii": [0.2674, 0.1146, 0.191], "transform": {"position": [0.0, 0.4488, 0.0955], "rotation": [0.3, 0, 0], "scale": [1, 1, 1]}}, {"id": "hair-back", "type": "ellipsoid", "center": [0.0, 0.1146, -0.191], "radii": [0.3533, 0.382, 0.3151]}, {"id": "side-r", "type": "ellipsoid", "center": [-0.3151, 0.1528, -0.0573], "radii": [0.0669, 0.191, 0.2674]}, {"id": "side-l", "type": "ellipsoid", "center": [0.3151, 0.1528, -0.0573], "radii": [0.0669, 0.191, 0.2674]}, {"id": "curls-l", "type": "ellipsoid", "center": [0.3438, 0.2865, 0.0191], "radii": [0.0764, 0.1146, 0.1337]}], "operations": [{"id": "u-quiff", "type": "smooth-union", "left": "hair-top", "right": "quiff", "radius": 0.0955}, {"id": "u-hair-back", "type": "smooth-union", "left": "u-quiff", "right": "hair-back", "radius": 0.1146}, {"id": "u-side-r", "type": "smooth-union", "left": "u-hair-back", "right": "side-r", "radius": 0.0764}, {"id": "u-side-l", "type": "smooth-union", "left": "u-side-r", "right": "side-l", "radius": 0.0764}, {"id": "u-curls-l", "type": "smooth-union", "left": "u-side-l", "right": "curls-l", "radius": 0.0573}], "resolution": 56, "bounds": {"min": [-0.55, -0.35, -0.6], "max": [0.55, 0.72, 0.55]}}}, "parent": "head", "attachment": null, "dimensions": {"width": 0.8, "height": 0.5, "depth": 0.95, "units": "world", "confidence": 0.65}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "hair", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hair"}}, "material": "hair", "materialLayers": ["hair"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "pompadour-lift", "kind": "contour", "description": "Hair swept up and back, loose curls at the viewer-right temple", "region": [0.36, 0.09, 0.28, 0.12], "evidenceRef": "face-landmarks", "confidence": 0.75}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "hair", "dominantAlbedo": "rgba(14, 14, 17, 1.0)", "secondaryAlbedo": "rgba(26, 25, 28, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.6, "roughnessEstimate": 0.124, "metalnessEstimate": 0.0, "highlightEvidence": "sharp, tight specular hotspot — supports low roughness/high specularity", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-hair.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.578}}};
  node_hair_3.add(mesh_hair_3);
  meshes["hair"] = mesh_hair_3;
  colliders["hair"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["hair"] ??= [];
  destructionGroups["hair"].push(node_hair_3);

  const attachment_lens_r_4 = {"parentSocket": "eye-socket-r", "localStart": [-0.1557, -0.0162, 0.4428], "localEnd": [-0.1557, -0.0162, 0.4548], "contactType": "held-in-rim", "embedDepth": 0.004, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"], "baseRadius": 0.1083, "endRadius": 0.1083};
  const endpoint_lens_r_4 = makeAttachmentEndpoint(attachment_lens_r_4);
  const node_lens_r_4 = new THREE.Group();
  node_lens_r_4.name = "Lens, subject-right (viewer-left)__pivot";
  node_lens_r_4.scale.set(1, 1, 1);
  if (endpoint_lens_r_4) {
    node_lens_r_4.position.copy(endpoint_lens_r_4.start);
    node_lens_r_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lens_r_4.position.set(-0.1557, -0.0162, 0.4488);
    node_lens_r_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_lens_r_4.userData.sculptComponent = {"id": "lens-r", "name": "Lens, subject-right (viewer-left)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Flat dark glass disc held in front of the eye.", "geometryDescriptor": {"topologyIntent": "Lens, subject-right (viewer-left)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentSocket": "eye-socket-r", "localStart": [-0.1557, -0.0162, 0.4428], "localEnd": [-0.1557, -0.0162, 0.4548], "contactType": "held-in-rim", "embedDepth": 0.004, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"], "baseRadius": 0.1083, "endRadius": 0.1083}, "dimensions": {"width": 0.2234, "height": 0.012, "depth": 0.2234, "units": "world", "confidence": 0.75}, "transform": {"position": [-0.1557, -0.0162, 0.4488], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "lens-glass"}}, "material": "lens-glass", "materialLayers": ["lens-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "lens-r", "dominantAlbedo": "rgba(24, 21, 25, 1.0)", "secondaryAlbedo": "rgba(32, 31, 37, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.6, "roughnessEstimate": 0.143, "metalnessEstimate": 0.0, "highlightEvidence": "sharp, tight specular hotspot — supports low roughness/high specularity", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-lens-r.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.51}}};
  node_lens_r_4.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "lens-glass"}};
  (nodes["head"] ?? root).add(node_lens_r_4);
  nodes["lens-r"] = node_lens_r_4;
  const mesh_lens_r_4Geometry = endpoint_lens_r_4
    ? new THREE.CylinderGeometry(endpoint_lens_r_4.endRadius, endpoint_lens_r_4.baseRadius, endpoint_lens_r_4.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_lens_r_4) {
    mesh_lens_r_4Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lens_r_4 = new THREE.Mesh(
    mesh_lens_r_4Geometry,
    materialMap["lens-glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_r_4.name = "Lens, subject-right (viewer-left)";
  if (endpoint_lens_r_4) {
    mesh_lens_r_4.position.copy(endpoint_lens_r_4.midpoint);
    mesh_lens_r_4.quaternion.copy(endpoint_lens_r_4.quaternion);
  }
  mesh_lens_r_4.castShadow = options.castShadow ?? true;
  mesh_lens_r_4.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_r_4.userData.sculptComponent = {"id": "lens-r", "name": "Lens, subject-right (viewer-left)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Flat dark glass disc held in front of the eye.", "geometryDescriptor": {"topologyIntent": "Lens, subject-right (viewer-left)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentSocket": "eye-socket-r", "localStart": [-0.1557, -0.0162, 0.4428], "localEnd": [-0.1557, -0.0162, 0.4548], "contactType": "held-in-rim", "embedDepth": 0.004, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"], "baseRadius": 0.1083, "endRadius": 0.1083}, "dimensions": {"width": 0.2234, "height": 0.012, "depth": 0.2234, "units": "world", "confidence": 0.75}, "transform": {"position": [-0.1557, -0.0162, 0.4488], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "lens-glass"}}, "material": "lens-glass", "materialLayers": ["lens-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "lens-r", "dominantAlbedo": "rgba(24, 21, 25, 1.0)", "secondaryAlbedo": "rgba(32, 31, 37, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.6, "roughnessEstimate": 0.143, "metalnessEstimate": 0.0, "highlightEvidence": "sharp, tight specular hotspot — supports low roughness/high specularity", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-lens-r.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.51}}};
  node_lens_r_4.add(mesh_lens_r_4);
  meshes["lens-r"] = mesh_lens_r_4;
  colliders["lens-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lens-r"] ??= [];
  destructionGroups["lens-r"].push(node_lens_r_4);

  const endpoint_rim_r_5 = makeAttachmentEndpoint(null);
  const node_rim_r_5 = new THREE.Group();
  node_rim_r_5.name = "Wire rim, subject-right (viewer-left)__pivot";
  node_rim_r_5.scale.set(1, 1, 1);
  if (endpoint_rim_r_5) {
    node_rim_r_5.position.copy(endpoint_rim_r_5.start);
    node_rim_r_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rim_r_5.position.set(-0.1557, -0.0162, 0.4488);
    node_rim_r_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_rim_r_5.userData.sculptComponent = {"id": "rim-r", "name": "Wire rim, subject-right (viewer-left)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Thin round wire loop around each lens.", "geometryDescriptor": {"topologyIntent": "Wire rim, subject-right (viewer-left)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.072}, "parent": "head", "attachment": {"parentSocket": "lens-r-edge", "localStart": [-0.1557, -0.0162, 0.4488], "localEnd": [-0.1557, -0.0162, 0.4568], "contactType": "rigid-weld", "embedDepth": 0.004, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"]}, "dimensions": {"width": 0.2234, "height": 0.2234, "depth": 0.016, "units": "world", "confidence": 0.75}, "transform": {"position": [-0.1557, -0.0162, 0.4488], "rotation": [0, 0, 0], "scale": [0.2482, 0.2482, 0.2482]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rim-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "frame-metal"}}, "material": "frame-metal", "materialLayers": ["frame-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rim-round-wire", "kind": "bevel", "description": "Thin round silver wire rim", "region": [0.41, 0.232, 0.19, 0.095], "evidenceRef": "face-landmarks", "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "rim-r", "dominantAlbedo": "rgba(144, 147, 152, 1.0)", "secondaryAlbedo": "rgba(58, 61, 60, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.6, "roughnessEstimate": 0.671, "metalnessEstimate": 1.0, "highlightEvidence": "broad, gradually-fading highlight — supports high roughness/diffuse response", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-rim.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.453}}};
  node_rim_r_5.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rim-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "frame-metal"}};
  (nodes["head"] ?? root).add(node_rim_r_5);
  nodes["rim-r"] = node_rim_r_5;
  const mesh_rim_r_5Geometry = endpoint_rim_r_5
    ? new THREE.CylinderGeometry(endpoint_rim_r_5.endRadius, endpoint_rim_r_5.baseRadius, endpoint_rim_r_5.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.0324, 24, 96);
  if (!endpoint_rim_r_5) {
    mesh_rim_r_5Geometry.scale(0.2482, 0.2482, 0.2482);
  }
  const mesh_rim_r_5 = new THREE.Mesh(
    mesh_rim_r_5Geometry,
    materialMap["frame-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rim_r_5.name = "Wire rim, subject-right (viewer-left)";
  if (endpoint_rim_r_5) {
    mesh_rim_r_5.position.copy(endpoint_rim_r_5.midpoint);
    mesh_rim_r_5.quaternion.copy(endpoint_rim_r_5.quaternion);
  }
  mesh_rim_r_5.castShadow = options.castShadow ?? true;
  mesh_rim_r_5.receiveShadow = options.receiveShadow ?? true;
  mesh_rim_r_5.userData.sculptComponent = {"id": "rim-r", "name": "Wire rim, subject-right (viewer-left)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Thin round wire loop around each lens.", "geometryDescriptor": {"topologyIntent": "Wire rim, subject-right (viewer-left)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.072}, "parent": "head", "attachment": {"parentSocket": "lens-r-edge", "localStart": [-0.1557, -0.0162, 0.4488], "localEnd": [-0.1557, -0.0162, 0.4568], "contactType": "rigid-weld", "embedDepth": 0.004, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"]}, "dimensions": {"width": 0.2234, "height": 0.2234, "depth": 0.016, "units": "world", "confidence": 0.75}, "transform": {"position": [-0.1557, -0.0162, 0.4488], "rotation": [0, 0, 0], "scale": [0.2482, 0.2482, 0.2482]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rim-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "frame-metal"}}, "material": "frame-metal", "materialLayers": ["frame-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rim-round-wire", "kind": "bevel", "description": "Thin round silver wire rim", "region": [0.41, 0.232, 0.19, 0.095], "evidenceRef": "face-landmarks", "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "rim-r", "dominantAlbedo": "rgba(144, 147, 152, 1.0)", "secondaryAlbedo": "rgba(58, 61, 60, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.6, "roughnessEstimate": 0.671, "metalnessEstimate": 1.0, "highlightEvidence": "broad, gradually-fading highlight — supports high roughness/diffuse response", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-rim.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.453}}};
  node_rim_r_5.add(mesh_rim_r_5);
  meshes["rim-r"] = mesh_rim_r_5;
  colliders["rim-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["rim-r"] ??= [];
  destructionGroups["rim-r"].push(node_rim_r_5);

  const endpoint_temple_r_6 = makeAttachmentEndpoint(null);
  const node_temple_r_6 = new THREE.Group();
  node_temple_r_6.name = "Temple arm, subject-right (viewer-left)__pivot";
  node_temple_r_6.scale.set(1, 1, 1);
  if (endpoint_temple_r_6) {
    node_temple_r_6.position.copy(endpoint_temple_r_6.start);
    node_temple_r_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_temple_r_6.position.set(-0.26739999999999997, -0.006199999999999999, 0.43879999999999997);
    node_temple_r_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_temple_r_6.userData.sculptComponent = {"id": "temple-r", "name": "Temple arm, subject-right (viewer-left)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "tapered-sweep", "topologyClass": "assembled-solid", "topologyRationale": "Wire arm from the rim back over the ear.", "geometryDescriptor": {"topologyIntent": "Temple arm, subject-right (viewer-left)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0.0, 0.0, 0.0], "rx": 0.011, "rz": 0.011}, {"position": [-0.0478, 0.0062, -0.1046], "rx": 0.009, "rz": 0.009}, {"position": [-0.1003, -0.0129, -0.3242], "rx": 0.007, "rz": 0.007}, {"position": [-0.1146, -0.0224, -0.4579], "rx": 0.0055, "rz": 0.0055}], "radialSegments": 8, "capEnds": true}}, "parent": "head", "attachment": {"parentSocket": "rim-r-hinge", "localStart": [0.0, 0.0, 0.0], "localEnd": [-0.1146, -0.0224, -0.4579], "contactType": "rests-on-ear", "embedDepth": 0.005, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"]}, "dimensions": {"width": 0.2, "height": 0.02, "depth": 0.5, "units": "world", "confidence": 0.75}, "transform": {"position": [-0.26739999999999997, -0.006199999999999999, 0.43879999999999997], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "temple-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "frame-metal"}}, "material": "frame-metal", "materialLayers": ["frame-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "temple-arm", "kind": "linework", "description": "Metal temple arm to the ear", "region": [0.36, 0.26, 0.26, 0.03], "evidenceRef": "face-landmarks", "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "rim-r", "dominantAlbedo": "rgba(144, 147, 152, 1.0)", "secondaryAlbedo": "rgba(58, 61, 60, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.6, "roughnessEstimate": 0.671, "metalnessEstimate": 1.0, "highlightEvidence": "broad, gradually-fading highlight — supports high roughness/diffuse response", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-rim.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.453}}};
  node_temple_r_6.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "temple-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "frame-metal"}};
  (nodes["head"] ?? root).add(node_temple_r_6);
  nodes["temple-r"] = node_temple_r_6;
  const mesh_temple_r_6Geometry = endpoint_temple_r_6
    ? new THREE.CylinderGeometry(endpoint_temple_r_6.endRadius, endpoint_temple_r_6.baseRadius, endpoint_temple_r_6.length, 32, 12)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.0, 0.0, 0.0], "rx": 0.011, "rz": 0.011}, {"position": [-0.0478, 0.0062, -0.1046], "rx": 0.009, "rz": 0.009}, {"position": [-0.1003, -0.0129, -0.3242], "rx": 0.007, "rz": 0.007}, {"position": [-0.1146, -0.0224, -0.4579], "rx": 0.0055, "rz": 0.0055}], "radialSegments": 8, "capEnds": true});
  if (!endpoint_temple_r_6) {
    mesh_temple_r_6Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_temple_r_6 = new THREE.Mesh(
    mesh_temple_r_6Geometry,
    materialMap["frame-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_temple_r_6.name = "Temple arm, subject-right (viewer-left)";
  if (endpoint_temple_r_6) {
    mesh_temple_r_6.position.copy(endpoint_temple_r_6.midpoint);
    mesh_temple_r_6.quaternion.copy(endpoint_temple_r_6.quaternion);
  }
  mesh_temple_r_6.castShadow = options.castShadow ?? true;
  mesh_temple_r_6.receiveShadow = options.receiveShadow ?? true;
  mesh_temple_r_6.userData.sculptComponent = {"id": "temple-r", "name": "Temple arm, subject-right (viewer-left)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "tapered-sweep", "topologyClass": "assembled-solid", "topologyRationale": "Wire arm from the rim back over the ear.", "geometryDescriptor": {"topologyIntent": "Temple arm, subject-right (viewer-left)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0.0, 0.0, 0.0], "rx": 0.011, "rz": 0.011}, {"position": [-0.0478, 0.0062, -0.1046], "rx": 0.009, "rz": 0.009}, {"position": [-0.1003, -0.0129, -0.3242], "rx": 0.007, "rz": 0.007}, {"position": [-0.1146, -0.0224, -0.4579], "rx": 0.0055, "rz": 0.0055}], "radialSegments": 8, "capEnds": true}}, "parent": "head", "attachment": {"parentSocket": "rim-r-hinge", "localStart": [0.0, 0.0, 0.0], "localEnd": [-0.1146, -0.0224, -0.4579], "contactType": "rests-on-ear", "embedDepth": 0.005, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"]}, "dimensions": {"width": 0.2, "height": 0.02, "depth": 0.5, "units": "world", "confidence": 0.75}, "transform": {"position": [-0.26739999999999997, -0.006199999999999999, 0.43879999999999997], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "temple-r", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "frame-metal"}}, "material": "frame-metal", "materialLayers": ["frame-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "temple-arm", "kind": "linework", "description": "Metal temple arm to the ear", "region": [0.36, 0.26, 0.26, 0.03], "evidenceRef": "face-landmarks", "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "rim-r", "dominantAlbedo": "rgba(144, 147, 152, 1.0)", "secondaryAlbedo": "rgba(58, 61, 60, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.6, "roughnessEstimate": 0.671, "metalnessEstimate": 1.0, "highlightEvidence": "broad, gradually-fading highlight — supports high roughness/diffuse response", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-rim.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.453}}};
  node_temple_r_6.add(mesh_temple_r_6);
  meshes["temple-r"] = mesh_temple_r_6;
  colliders["temple-r"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["temple-r"] ??= [];
  destructionGroups["temple-r"].push(node_temple_r_6);

  const attachment_lens_l_7 = {"parentSocket": "eye-socket-l", "localStart": [0.1557, -0.0162, 0.4428], "localEnd": [0.1557, -0.0162, 0.4548], "contactType": "held-in-rim", "embedDepth": 0.004, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"], "baseRadius": 0.1083, "endRadius": 0.1083};
  const endpoint_lens_l_7 = makeAttachmentEndpoint(attachment_lens_l_7);
  const node_lens_l_7 = new THREE.Group();
  node_lens_l_7.name = "Lens, subject-left (viewer-right)__pivot";
  node_lens_l_7.scale.set(1, 1, 1);
  if (endpoint_lens_l_7) {
    node_lens_l_7.position.copy(endpoint_lens_l_7.start);
    node_lens_l_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lens_l_7.position.set(0.1557, -0.0162, 0.4488);
    node_lens_l_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_lens_l_7.userData.sculptComponent = {"id": "lens-l", "name": "Lens, subject-left (viewer-right)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Flat dark glass disc held in front of the eye.", "geometryDescriptor": {"topologyIntent": "Lens, subject-left (viewer-right)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentSocket": "eye-socket-l", "localStart": [0.1557, -0.0162, 0.4428], "localEnd": [0.1557, -0.0162, 0.4548], "contactType": "held-in-rim", "embedDepth": 0.004, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"], "baseRadius": 0.1083, "endRadius": 0.1083}, "dimensions": {"width": 0.2234, "height": 0.012, "depth": 0.2234, "units": "world", "confidence": 0.75}, "transform": {"position": [0.1557, -0.0162, 0.4488], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "lens-glass"}}, "material": "lens-glass", "materialLayers": ["lens-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "lens-l", "dominantAlbedo": "rgba(58, 49, 48, 1.0)", "secondaryAlbedo": "rgba(33, 30, 34, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.6, "roughnessEstimate": 0.196, "metalnessEstimate": 0.0, "highlightEvidence": "sharp, tight specular hotspot — supports low roughness/high specularity", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-lens-l.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.429}}};
  node_lens_l_7.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "lens-glass"}};
  (nodes["head"] ?? root).add(node_lens_l_7);
  nodes["lens-l"] = node_lens_l_7;
  const mesh_lens_l_7Geometry = endpoint_lens_l_7
    ? new THREE.CylinderGeometry(endpoint_lens_l_7.endRadius, endpoint_lens_l_7.baseRadius, endpoint_lens_l_7.length, 32, 12)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 16);
  if (!endpoint_lens_l_7) {
    mesh_lens_l_7Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lens_l_7 = new THREE.Mesh(
    mesh_lens_l_7Geometry,
    materialMap["lens-glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_l_7.name = "Lens, subject-left (viewer-right)";
  if (endpoint_lens_l_7) {
    mesh_lens_l_7.position.copy(endpoint_lens_l_7.midpoint);
    mesh_lens_l_7.quaternion.copy(endpoint_lens_l_7.quaternion);
  }
  mesh_lens_l_7.castShadow = options.castShadow ?? true;
  mesh_lens_l_7.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_l_7.userData.sculptComponent = {"id": "lens-l", "name": "Lens, subject-left (viewer-right)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Flat dark glass disc held in front of the eye.", "geometryDescriptor": {"topologyIntent": "Lens, subject-left (viewer-right)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals"}, "parent": "head", "attachment": {"parentSocket": "eye-socket-l", "localStart": [0.1557, -0.0162, 0.4428], "localEnd": [0.1557, -0.0162, 0.4548], "contactType": "held-in-rim", "embedDepth": 0.004, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"], "baseRadius": 0.1083, "endRadius": 0.1083}, "dimensions": {"width": 0.2234, "height": 0.012, "depth": 0.2234, "units": "world", "confidence": 0.75}, "transform": {"position": [0.1557, -0.0162, 0.4488], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "lens-glass"}}, "material": "lens-glass", "materialLayers": ["lens-glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "lens-l", "dominantAlbedo": "rgba(58, 49, 48, 1.0)", "secondaryAlbedo": "rgba(33, 30, 34, 1.0)", "materialClass": "glass", "materialClassConfidence": 0.6, "roughnessEstimate": 0.196, "metalnessEstimate": 0.0, "highlightEvidence": "sharp, tight specular hotspot — supports low roughness/high specularity", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-lens-l.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.429}}};
  node_lens_l_7.add(mesh_lens_l_7);
  meshes["lens-l"] = mesh_lens_l_7;
  colliders["lens-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["lens-l"] ??= [];
  destructionGroups["lens-l"].push(node_lens_l_7);

  const endpoint_rim_l_8 = makeAttachmentEndpoint(null);
  const node_rim_l_8 = new THREE.Group();
  node_rim_l_8.name = "Wire rim, subject-left (viewer-right)__pivot";
  node_rim_l_8.scale.set(1, 1, 1);
  if (endpoint_rim_l_8) {
    node_rim_l_8.position.copy(endpoint_rim_l_8.start);
    node_rim_l_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rim_l_8.position.set(0.1557, -0.0162, 0.4488);
    node_rim_l_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_rim_l_8.userData.sculptComponent = {"id": "rim-l", "name": "Wire rim, subject-left (viewer-right)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Thin round wire loop around each lens.", "geometryDescriptor": {"topologyIntent": "Wire rim, subject-left (viewer-right)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.072}, "parent": "head", "attachment": {"parentSocket": "lens-l-edge", "localStart": [0.1557, -0.0162, 0.4488], "localEnd": [0.1557, -0.0162, 0.4568], "contactType": "rigid-weld", "embedDepth": 0.004, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"]}, "dimensions": {"width": 0.2234, "height": 0.2234, "depth": 0.016, "units": "world", "confidence": 0.75}, "transform": {"position": [0.1557, -0.0162, 0.4488], "rotation": [0, 0, 0], "scale": [0.2482, 0.2482, 0.2482]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rim-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "frame-metal"}}, "material": "frame-metal", "materialLayers": ["frame-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rim-round-wire", "kind": "bevel", "description": "Thin round silver wire rim", "region": [0.41, 0.232, 0.19, 0.095], "evidenceRef": "face-landmarks", "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "rim-r", "dominantAlbedo": "rgba(144, 147, 152, 1.0)", "secondaryAlbedo": "rgba(58, 61, 60, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.6, "roughnessEstimate": 0.671, "metalnessEstimate": 1.0, "highlightEvidence": "broad, gradually-fading highlight — supports high roughness/diffuse response", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-rim.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.453}}};
  node_rim_l_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rim-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "frame-metal"}};
  (nodes["head"] ?? root).add(node_rim_l_8);
  nodes["rim-l"] = node_rim_l_8;
  const mesh_rim_l_8Geometry = endpoint_rim_l_8
    ? new THREE.CylinderGeometry(endpoint_rim_l_8.endRadius, endpoint_rim_l_8.baseRadius, endpoint_rim_l_8.length, 32, 12)
    : new THREE.TorusGeometry(0.45, 0.0324, 24, 96);
  if (!endpoint_rim_l_8) {
    mesh_rim_l_8Geometry.scale(0.2482, 0.2482, 0.2482);
  }
  const mesh_rim_l_8 = new THREE.Mesh(
    mesh_rim_l_8Geometry,
    materialMap["frame-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rim_l_8.name = "Wire rim, subject-left (viewer-right)";
  if (endpoint_rim_l_8) {
    mesh_rim_l_8.position.copy(endpoint_rim_l_8.midpoint);
    mesh_rim_l_8.quaternion.copy(endpoint_rim_l_8.quaternion);
  }
  mesh_rim_l_8.castShadow = options.castShadow ?? true;
  mesh_rim_l_8.receiveShadow = options.receiveShadow ?? true;
  mesh_rim_l_8.userData.sculptComponent = {"id": "rim-l", "name": "Wire rim, subject-left (viewer-right)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Thin round wire loop around each lens.", "geometryDescriptor": {"topologyIntent": "Wire rim, subject-left (viewer-right)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "torusTubeRatio": 0.072}, "parent": "head", "attachment": {"parentSocket": "lens-l-edge", "localStart": [0.1557, -0.0162, 0.4488], "localEnd": [0.1557, -0.0162, 0.4568], "contactType": "rigid-weld", "embedDepth": 0.004, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"]}, "dimensions": {"width": 0.2234, "height": 0.2234, "depth": 0.016, "units": "world", "confidence": 0.75}, "transform": {"position": [0.1557, -0.0162, 0.4488], "rotation": [0, 0, 0], "scale": [0.2482, 0.2482, 0.2482]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rim-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "frame-metal"}}, "material": "frame-metal", "materialLayers": ["frame-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rim-round-wire", "kind": "bevel", "description": "Thin round silver wire rim", "region": [0.41, 0.232, 0.19, 0.095], "evidenceRef": "face-landmarks", "confidence": 0.85}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "rim-r", "dominantAlbedo": "rgba(144, 147, 152, 1.0)", "secondaryAlbedo": "rgba(58, 61, 60, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.6, "roughnessEstimate": 0.671, "metalnessEstimate": 1.0, "highlightEvidence": "broad, gradually-fading highlight — supports high roughness/diffuse response", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-rim.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.453}}};
  node_rim_l_8.add(mesh_rim_l_8);
  meshes["rim-l"] = mesh_rim_l_8;
  colliders["rim-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["rim-l"] ??= [];
  destructionGroups["rim-l"].push(node_rim_l_8);

  const endpoint_temple_l_9 = makeAttachmentEndpoint(null);
  const node_temple_l_9 = new THREE.Group();
  node_temple_l_9.name = "Temple arm, subject-left (viewer-right)__pivot";
  node_temple_l_9.scale.set(1, 1, 1);
  if (endpoint_temple_l_9) {
    node_temple_l_9.position.copy(endpoint_temple_l_9.start);
    node_temple_l_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_temple_l_9.position.set(0.26739999999999997, -0.006199999999999999, 0.43879999999999997);
    node_temple_l_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_temple_l_9.userData.sculptComponent = {"id": "temple-l", "name": "Temple arm, subject-left (viewer-right)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "tapered-sweep", "topologyClass": "assembled-solid", "topologyRationale": "Wire arm from the rim back over the ear.", "geometryDescriptor": {"topologyIntent": "Temple arm, subject-left (viewer-right)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0.0, 0.0, 0.0], "rx": 0.011, "rz": 0.011}, {"position": [0.0478, 0.0062, -0.1046], "rx": 0.009, "rz": 0.009}, {"position": [0.1003, -0.0129, -0.3242], "rx": 0.007, "rz": 0.007}, {"position": [0.1146, -0.0224, -0.4579], "rx": 0.0055, "rz": 0.0055}], "radialSegments": 8, "capEnds": true}}, "parent": "head", "attachment": {"parentSocket": "rim-l-hinge", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.1146, -0.0224, -0.4579], "contactType": "rests-on-ear", "embedDepth": 0.005, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"]}, "dimensions": {"width": 0.2, "height": 0.02, "depth": 0.5, "units": "world", "confidence": 0.75}, "transform": {"position": [0.26739999999999997, -0.006199999999999999, 0.43879999999999997], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "temple-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "frame-metal"}}, "material": "frame-metal", "materialLayers": ["frame-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "temple-arm", "kind": "linework", "description": "Metal temple arm to the ear", "region": [0.36, 0.26, 0.26, 0.03], "evidenceRef": "face-landmarks", "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "rim-r", "dominantAlbedo": "rgba(144, 147, 152, 1.0)", "secondaryAlbedo": "rgba(58, 61, 60, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.6, "roughnessEstimate": 0.671, "metalnessEstimate": 1.0, "highlightEvidence": "broad, gradually-fading highlight — supports high roughness/diffuse response", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-rim.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.453}}};
  node_temple_l_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "temple-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "frame-metal"}};
  (nodes["head"] ?? root).add(node_temple_l_9);
  nodes["temple-l"] = node_temple_l_9;
  const mesh_temple_l_9Geometry = endpoint_temple_l_9
    ? new THREE.CylinderGeometry(endpoint_temple_l_9.endRadius, endpoint_temple_l_9.baseRadius, endpoint_temple_l_9.length, 32, 12)
    : buildTaperedSweepGeometry({"stations": [{"position": [0.0, 0.0, 0.0], "rx": 0.011, "rz": 0.011}, {"position": [0.0478, 0.0062, -0.1046], "rx": 0.009, "rz": 0.009}, {"position": [0.1003, -0.0129, -0.3242], "rx": 0.007, "rz": 0.007}, {"position": [0.1146, -0.0224, -0.4579], "rx": 0.0055, "rz": 0.0055}], "radialSegments": 8, "capEnds": true});
  if (!endpoint_temple_l_9) {
    mesh_temple_l_9Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_temple_l_9 = new THREE.Mesh(
    mesh_temple_l_9Geometry,
    materialMap["frame-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_temple_l_9.name = "Temple arm, subject-left (viewer-right)";
  if (endpoint_temple_l_9) {
    mesh_temple_l_9.position.copy(endpoint_temple_l_9.midpoint);
    mesh_temple_l_9.quaternion.copy(endpoint_temple_l_9.quaternion);
  }
  mesh_temple_l_9.castShadow = options.castShadow ?? true;
  mesh_temple_l_9.receiveShadow = options.receiveShadow ?? true;
  mesh_temple_l_9.userData.sculptComponent = {"id": "temple-l", "name": "Temple arm, subject-left (viewer-right)", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "tapered-sweep", "topologyClass": "assembled-solid", "topologyRationale": "Wire arm from the rim back over the ear.", "geometryDescriptor": {"topologyIntent": "Temple arm, subject-left (viewer-right)", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [0.0, 0.0, 0.0], "rx": 0.011, "rz": 0.011}, {"position": [0.0478, 0.0062, -0.1046], "rx": 0.009, "rz": 0.009}, {"position": [0.1003, -0.0129, -0.3242], "rx": 0.007, "rz": 0.007}, {"position": [0.1146, -0.0224, -0.4579], "rx": 0.0055, "rz": 0.0055}], "radialSegments": 8, "capEnds": true}}, "parent": "head", "attachment": {"parentSocket": "rim-l-hinge", "localStart": [0.0, 0.0, 0.0], "localEnd": [0.1146, -0.0224, -0.4579], "contactType": "rests-on-ear", "embedDepth": 0.005, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"]}, "dimensions": {"width": 0.2, "height": 0.02, "depth": 0.5, "units": "world", "confidence": 0.75}, "transform": {"position": [0.26739999999999997, -0.006199999999999999, 0.43879999999999997], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "temple-l", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "frame-metal"}}, "material": "frame-metal", "materialLayers": ["frame-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "temple-arm", "kind": "linework", "description": "Metal temple arm to the ear", "region": [0.36, 0.26, 0.26, 0.03], "evidenceRef": "face-landmarks", "confidence": 0.7}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "rim-r", "dominantAlbedo": "rgba(144, 147, 152, 1.0)", "secondaryAlbedo": "rgba(58, 61, 60, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.6, "roughnessEstimate": 0.671, "metalnessEstimate": 1.0, "highlightEvidence": "broad, gradually-fading highlight — supports high roughness/diffuse response", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-rim.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.453}}};
  node_temple_l_9.add(mesh_temple_l_9);
  meshes["temple-l"] = mesh_temple_l_9;
  colliders["temple-l"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["temple-l"] ??= [];
  destructionGroups["temple-l"].push(node_temple_l_9);

  const endpoint_bridge_10 = makeAttachmentEndpoint(null);
  const node_bridge_10 = new THREE.Group();
  node_bridge_10.name = "Bridge bar__pivot";
  node_bridge_10.scale.set(1, 1, 1);
  if (endpoint_bridge_10) {
    node_bridge_10.position.copy(endpoint_bridge_10.start);
    node_bridge_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bridge_10.position.set(0.0, 0.0, 0.0);
    node_bridge_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_bridge_10.userData.sculptComponent = {"id": "bridge", "name": "Bridge bar", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "tapered-sweep", "topologyClass": "assembled-solid", "topologyRationale": "Straight metal bar joining the rims above the nose.", "geometryDescriptor": {"topologyIntent": "Bridge bar", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [-0.04900000000000001, 0.05380000000000001, 0.4488], "rx": 0.011, "rz": 0.011}, {"position": [0, 0.0688, 0.4608], "rx": 0.006, "rz": 0.006}, {"position": [0.04900000000000001, 0.05380000000000001, 0.4488], "rx": 0.011, "rz": 0.011}], "radialSegments": 8, "capEnds": true}}, "parent": "head", "attachment": {"parentSocket": "rim-r-inner", "localStart": [-0.049, 0.0538, 0.4488], "localEnd": [0.049, 0.0538, 0.4488], "contactType": "rigid-weld", "embedDepth": 0.004, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"]}, "dimensions": {"width": 0.1, "height": 0.02, "depth": 0.02, "units": "world", "confidence": 0.75}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bridge", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "frame-metal"}}, "material": "frame-metal", "materialLayers": ["frame-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bridge-bar", "kind": "linework", "description": "Straight metal bridge bar above the nose", "region": [0.485, 0.255, 0.045, 0.02], "evidenceRef": "face-landmarks", "confidence": 0.8}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "rim-r", "dominantAlbedo": "rgba(144, 147, 152, 1.0)", "secondaryAlbedo": "rgba(58, 61, 60, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.6, "roughnessEstimate": 0.671, "metalnessEstimate": 1.0, "highlightEvidence": "broad, gradually-fading highlight — supports high roughness/diffuse response", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-rim.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.453}, "samplingNotes": "Bridge wire is ~3px wide at 2000px so its own crop is dominated by skin; it is the same silver wire as the rims, so the rim crop recipe is reused."}};
  node_bridge_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bridge", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "frame-metal"}};
  (nodes["head"] ?? root).add(node_bridge_10);
  nodes["bridge"] = node_bridge_10;
  const mesh_bridge_10Geometry = endpoint_bridge_10
    ? new THREE.CylinderGeometry(endpoint_bridge_10.endRadius, endpoint_bridge_10.baseRadius, endpoint_bridge_10.length, 32, 12)
    : buildTaperedSweepGeometry({"stations": [{"position": [-0.04900000000000001, 0.05380000000000001, 0.4488], "rx": 0.011, "rz": 0.011}, {"position": [0, 0.0688, 0.4608], "rx": 0.006, "rz": 0.006}, {"position": [0.04900000000000001, 0.05380000000000001, 0.4488], "rx": 0.011, "rz": 0.011}], "radialSegments": 8, "capEnds": true});
  if (!endpoint_bridge_10) {
    mesh_bridge_10Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_bridge_10 = new THREE.Mesh(
    mesh_bridge_10Geometry,
    materialMap["frame-metal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bridge_10.name = "Bridge bar";
  if (endpoint_bridge_10) {
    mesh_bridge_10.position.copy(endpoint_bridge_10.midpoint);
    mesh_bridge_10.quaternion.copy(endpoint_bridge_10.quaternion);
  }
  mesh_bridge_10.castShadow = options.castShadow ?? true;
  mesh_bridge_10.receiveShadow = options.receiveShadow ?? true;
  mesh_bridge_10.userData.sculptComponent = {"id": "bridge", "name": "Bridge bar", "level": "meso", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "tapered-sweep", "topologyClass": "assembled-solid", "topologyRationale": "Straight metal bar joining the rims above the nose.", "geometryDescriptor": {"topologyIntent": "Bridge bar", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [-0.04900000000000001, 0.05380000000000001, 0.4488], "rx": 0.011, "rz": 0.011}, {"position": [0, 0.0688, 0.4608], "rx": 0.006, "rz": 0.006}, {"position": [0.04900000000000001, 0.05380000000000001, 0.4488], "rx": 0.011, "rz": 0.011}], "radialSegments": 8, "capEnds": true}}, "parent": "head", "attachment": {"parentSocket": "rim-r-inner", "localStart": [-0.049, 0.0538, 0.4488], "localEnd": [0.049, 0.0538, 0.4488], "contactType": "rigid-weld", "embedDepth": 0.004, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"]}, "dimensions": {"width": 0.1, "height": 0.02, "depth": 0.02, "units": "world", "confidence": 0.75}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bridge", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "frame-metal"}}, "material": "frame-metal", "materialLayers": ["frame-metal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bridge-bar", "kind": "linework", "description": "Straight metal bridge bar above the nose", "region": [0.485, 0.255, 0.045, 0.02], "evidenceRef": "face-landmarks", "confidence": 0.8}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "rim-r", "dominantAlbedo": "rgba(144, 147, 152, 1.0)", "secondaryAlbedo": "rgba(58, 61, 60, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.6, "roughnessEstimate": 0.671, "metalnessEstimate": 1.0, "highlightEvidence": "broad, gradually-fading highlight — supports high roughness/diffuse response", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-rim.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.453}, "samplingNotes": "Bridge wire is ~3px wide at 2000px so its own crop is dominated by skin; it is the same silver wire as the rims, so the rim crop recipe is reused."}};
  node_bridge_10.add(mesh_bridge_10);
  meshes["bridge"] = mesh_bridge_10;
  colliders["bridge"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["bridge"] ??= [];
  destructionGroups["bridge"].push(node_bridge_10);

  const endpoint_chain_11 = makeAttachmentEndpoint(null);
  const node_chain_11 = new THREE.Group();
  node_chain_11.name = "Gold chain__pivot";
  node_chain_11.scale.set(1, 1, 1);
  if (endpoint_chain_11) {
    node_chain_11.position.copy(endpoint_chain_11.start);
    node_chain_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_chain_11.position.set(0.0, 0.0, 0.0);
    node_chain_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_chain_11.userData.sculptComponent = {"id": "chain", "name": "Gold chain", "level": "micro", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "tapered-sweep", "topologyClass": "assembled-solid", "topologyRationale": "Thin curb chain draped in a V over the turtleneck, seated on the chest surface.", "geometryDescriptor": {"topologyIntent": "Gold chain", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [-0.3881, -0.0931, 0.198], "rx": 0.007, "rz": 0.007}, {"position": [-0.3763, -0.1349, 0.212], "rx": 0.013, "rz": 0.013}, {"position": [-0.3623, -0.1858, 0.224], "rx": 0.013, "rz": 0.013}, {"position": [-0.3527, -0.2233, 0.228], "rx": 0.013, "rz": 0.013}, {"position": [-0.3435, -0.2599, 0.232], "rx": 0.013, "rz": 0.013}, {"position": [-0.3332, -0.3016, 0.234], "rx": 0.013, "rz": 0.013}, {"position": [-0.3217, -0.3464, 0.236], "rx": 0.013, "rz": 0.013}, {"position": [-0.3069, -0.3973, 0.24], "rx": 0.013, "rz": 0.013}, {"position": [-0.292, -0.445, 0.244], "rx": 0.013, "rz": 0.013}, {"position": [-0.2801, -0.4789, 0.246], "rx": 0.013, "rz": 0.013}, {"position": [-0.2688, -0.5066, 0.248], "rx": 0.013, "rz": 0.013}, {"position": [-0.2566, -0.5328, 0.25], "rx": 0.013, "rz": 0.013}, {"position": [-0.2439, -0.5558, 0.252], "rx": 0.013, "rz": 0.013}, {"position": [-0.2304, -0.5758, 0.254], "rx": 0.013, "rz": 0.013}, {"position": [-0.216, -0.5925, 0.258], "rx": 0.013, "rz": 0.013}, {"position": [-0.2011, -0.6055, 0.26], "rx": 0.013, "rz": 0.013}, {"position": [-0.1851, -0.6169, 0.262], "rx": 0.013, "rz": 0.013}, {"position": [-0.1667, -0.6299, 0.264], "rx": 0.013, "rz": 0.013}, {"position": [-0.148, -0.6414, 0.266], "rx": 0.013, "rz": 0.013}, {"position": [-0.1314, -0.6482, 0.268], "rx": 0.013, "rz": 0.013}, {"position": [-0.114, -0.6534, 0.27], "rx": 0.013, "rz": 0.013}, {"position": [-0.0923, -0.661, 0.272], "rx": 0.013, "rz": 0.013}, {"position": [-0.0709, -0.6656, 0.272], "rx": 0.013, "rz": 0.013}, {"position": [-0.0558, -0.661, 0.272], "rx": 0.013, "rz": 0.013}, {"position": [-0.0401, -0.6534, 0.27], "rx": 0.013, "rz": 0.013}, {"position": [-0.0169, -0.648, 0.27], "rx": 0.013, "rz": 0.013}, {"position": [0.0077, -0.6412, 0.268], "rx": 0.013, "rz": 0.013}, {"position": [0.0296, -0.6321, 0.266], "rx": 0.013, "rz": 0.013}, {"position": [0.0494, -0.6169, 0.262], "rx": 0.013, "rz": 0.013}, {"position": [0.0655, -0.5893, 0.26], "rx": 0.013, "rz": 0.013}, {"position": [0.0803, -0.5556, 0.256], "rx": 0.013, "rz": 0.013}, {"position": [0.0963, -0.5234, 0.252], "rx": 0.013, "rz": 0.013}, {"position": [0.1112, -0.4818, 0.25], "rx": 0.013, "rz": 0.013}, {"position": [0.1232, -0.4148, 0.246], "rx": 0.013, "rz": 0.013}, {"position": [0.1329, -0.3461, 0.244], "rx": 0.013, "rz": 0.013}, {"position": [0.1396, -0.2989, 0.246], "rx": 0.013, "rz": 0.013}, {"position": [0.1452, -0.2595, 0.248], "rx": 0.013, "rz": 0.013}, {"position": [0.1513, -0.2266, 0.25], "rx": 0.013, "rz": 0.013}, {"position": [0.1575, -0.1853, 0.252], "rx": 0.013, "rz": 0.013}, {"position": [0.1645, -0.1035, 0.246], "rx": 0.013, "rz": 0.013}, {"position": [0.1703, -0.031, 0.226], "rx": 0.007, "rz": 0.007}], "radialSegments": 8, "capEnds": true}}, "parent": "torso", "attachment": {"parentSocket": "neck-base", "localStart": [-0.3881, -0.0931, 0.198], "localEnd": [0.1703, -0.031, 0.226], "contactType": "drapes-on-chest", "embedDepth": 0.006, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"]}, "dimensions": {"width": 0.6, "height": 0.7, "depth": 0.05, "units": "world", "confidence": 0.75}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chain", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "chain-gold"}}, "material": "chain-gold", "materialLayers": ["chain-gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "link-row", "kind": "fastener", "description": "Curb chain links along the V drape (projected link pattern)", "region": [0.37, 0.5, 0.19, 0.22], "evidenceRef": "face-landmarks", "confidence": 0.8}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "chain", "dominantAlbedo": "rgba(168, 152, 122, 1.0)", "secondaryAlbedo": "rgba(101, 86, 58, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.6, "roughnessEstimate": 0.207, "metalnessEstimate": 1.0, "highlightEvidence": "sharp, tight specular hotspot — supports low roughness/high specularity", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-chain.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.359}}};
  node_chain_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chain", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "chain-gold"}};
  (nodes["torso"] ?? root).add(node_chain_11);
  nodes["chain"] = node_chain_11;
  const mesh_chain_11Geometry = endpoint_chain_11
    ? new THREE.CylinderGeometry(endpoint_chain_11.endRadius, endpoint_chain_11.baseRadius, endpoint_chain_11.length, 32, 12)
    : buildTaperedSweepGeometry({"stations": [{"position": [-0.3881, -0.0931, 0.198], "rx": 0.007, "rz": 0.007}, {"position": [-0.3763, -0.1349, 0.212], "rx": 0.013, "rz": 0.013}, {"position": [-0.3623, -0.1858, 0.224], "rx": 0.013, "rz": 0.013}, {"position": [-0.3527, -0.2233, 0.228], "rx": 0.013, "rz": 0.013}, {"position": [-0.3435, -0.2599, 0.232], "rx": 0.013, "rz": 0.013}, {"position": [-0.3332, -0.3016, 0.234], "rx": 0.013, "rz": 0.013}, {"position": [-0.3217, -0.3464, 0.236], "rx": 0.013, "rz": 0.013}, {"position": [-0.3069, -0.3973, 0.24], "rx": 0.013, "rz": 0.013}, {"position": [-0.292, -0.445, 0.244], "rx": 0.013, "rz": 0.013}, {"position": [-0.2801, -0.4789, 0.246], "rx": 0.013, "rz": 0.013}, {"position": [-0.2688, -0.5066, 0.248], "rx": 0.013, "rz": 0.013}, {"position": [-0.2566, -0.5328, 0.25], "rx": 0.013, "rz": 0.013}, {"position": [-0.2439, -0.5558, 0.252], "rx": 0.013, "rz": 0.013}, {"position": [-0.2304, -0.5758, 0.254], "rx": 0.013, "rz": 0.013}, {"position": [-0.216, -0.5925, 0.258], "rx": 0.013, "rz": 0.013}, {"position": [-0.2011, -0.6055, 0.26], "rx": 0.013, "rz": 0.013}, {"position": [-0.1851, -0.6169, 0.262], "rx": 0.013, "rz": 0.013}, {"position": [-0.1667, -0.6299, 0.264], "rx": 0.013, "rz": 0.013}, {"position": [-0.148, -0.6414, 0.266], "rx": 0.013, "rz": 0.013}, {"position": [-0.1314, -0.6482, 0.268], "rx": 0.013, "rz": 0.013}, {"position": [-0.114, -0.6534, 0.27], "rx": 0.013, "rz": 0.013}, {"position": [-0.0923, -0.661, 0.272], "rx": 0.013, "rz": 0.013}, {"position": [-0.0709, -0.6656, 0.272], "rx": 0.013, "rz": 0.013}, {"position": [-0.0558, -0.661, 0.272], "rx": 0.013, "rz": 0.013}, {"position": [-0.0401, -0.6534, 0.27], "rx": 0.013, "rz": 0.013}, {"position": [-0.0169, -0.648, 0.27], "rx": 0.013, "rz": 0.013}, {"position": [0.0077, -0.6412, 0.268], "rx": 0.013, "rz": 0.013}, {"position": [0.0296, -0.6321, 0.266], "rx": 0.013, "rz": 0.013}, {"position": [0.0494, -0.6169, 0.262], "rx": 0.013, "rz": 0.013}, {"position": [0.0655, -0.5893, 0.26], "rx": 0.013, "rz": 0.013}, {"position": [0.0803, -0.5556, 0.256], "rx": 0.013, "rz": 0.013}, {"position": [0.0963, -0.5234, 0.252], "rx": 0.013, "rz": 0.013}, {"position": [0.1112, -0.4818, 0.25], "rx": 0.013, "rz": 0.013}, {"position": [0.1232, -0.4148, 0.246], "rx": 0.013, "rz": 0.013}, {"position": [0.1329, -0.3461, 0.244], "rx": 0.013, "rz": 0.013}, {"position": [0.1396, -0.2989, 0.246], "rx": 0.013, "rz": 0.013}, {"position": [0.1452, -0.2595, 0.248], "rx": 0.013, "rz": 0.013}, {"position": [0.1513, -0.2266, 0.25], "rx": 0.013, "rz": 0.013}, {"position": [0.1575, -0.1853, 0.252], "rx": 0.013, "rz": 0.013}, {"position": [0.1645, -0.1035, 0.246], "rx": 0.013, "rz": 0.013}, {"position": [0.1703, -0.031, 0.226], "rx": 0.007, "rz": 0.007}], "radialSegments": 8, "capEnds": true});
  if (!endpoint_chain_11) {
    mesh_chain_11Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_chain_11 = new THREE.Mesh(
    mesh_chain_11Geometry,
    materialMap["chain-gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_chain_11.name = "Gold chain";
  if (endpoint_chain_11) {
    mesh_chain_11.position.copy(endpoint_chain_11.midpoint);
    mesh_chain_11.quaternion.copy(endpoint_chain_11.quaternion);
  }
  mesh_chain_11.castShadow = options.castShadow ?? true;
  mesh_chain_11.receiveShadow = options.receiveShadow ?? true;
  mesh_chain_11.userData.sculptComponent = {"id": "chain", "name": "Gold chain", "level": "micro", "role": "shell", "importance": 0.8, "confidence": 0.75, "primitive": "tapered-sweep", "topologyClass": "assembled-solid", "topologyRationale": "Thin curb chain draped in a V over the turtleneck, seated on the chest surface.", "geometryDescriptor": {"topologyIntent": "Gold chain", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "camera-projected from referenceCamera (runtime bake, see lookDevTargets.projection)", "normalStrategy": "smooth vertex normals", "taperedSweep": {"stations": [{"position": [-0.3881, -0.0931, 0.198], "rx": 0.007, "rz": 0.007}, {"position": [-0.3763, -0.1349, 0.212], "rx": 0.013, "rz": 0.013}, {"position": [-0.3623, -0.1858, 0.224], "rx": 0.013, "rz": 0.013}, {"position": [-0.3527, -0.2233, 0.228], "rx": 0.013, "rz": 0.013}, {"position": [-0.3435, -0.2599, 0.232], "rx": 0.013, "rz": 0.013}, {"position": [-0.3332, -0.3016, 0.234], "rx": 0.013, "rz": 0.013}, {"position": [-0.3217, -0.3464, 0.236], "rx": 0.013, "rz": 0.013}, {"position": [-0.3069, -0.3973, 0.24], "rx": 0.013, "rz": 0.013}, {"position": [-0.292, -0.445, 0.244], "rx": 0.013, "rz": 0.013}, {"position": [-0.2801, -0.4789, 0.246], "rx": 0.013, "rz": 0.013}, {"position": [-0.2688, -0.5066, 0.248], "rx": 0.013, "rz": 0.013}, {"position": [-0.2566, -0.5328, 0.25], "rx": 0.013, "rz": 0.013}, {"position": [-0.2439, -0.5558, 0.252], "rx": 0.013, "rz": 0.013}, {"position": [-0.2304, -0.5758, 0.254], "rx": 0.013, "rz": 0.013}, {"position": [-0.216, -0.5925, 0.258], "rx": 0.013, "rz": 0.013}, {"position": [-0.2011, -0.6055, 0.26], "rx": 0.013, "rz": 0.013}, {"position": [-0.1851, -0.6169, 0.262], "rx": 0.013, "rz": 0.013}, {"position": [-0.1667, -0.6299, 0.264], "rx": 0.013, "rz": 0.013}, {"position": [-0.148, -0.6414, 0.266], "rx": 0.013, "rz": 0.013}, {"position": [-0.1314, -0.6482, 0.268], "rx": 0.013, "rz": 0.013}, {"position": [-0.114, -0.6534, 0.27], "rx": 0.013, "rz": 0.013}, {"position": [-0.0923, -0.661, 0.272], "rx": 0.013, "rz": 0.013}, {"position": [-0.0709, -0.6656, 0.272], "rx": 0.013, "rz": 0.013}, {"position": [-0.0558, -0.661, 0.272], "rx": 0.013, "rz": 0.013}, {"position": [-0.0401, -0.6534, 0.27], "rx": 0.013, "rz": 0.013}, {"position": [-0.0169, -0.648, 0.27], "rx": 0.013, "rz": 0.013}, {"position": [0.0077, -0.6412, 0.268], "rx": 0.013, "rz": 0.013}, {"position": [0.0296, -0.6321, 0.266], "rx": 0.013, "rz": 0.013}, {"position": [0.0494, -0.6169, 0.262], "rx": 0.013, "rz": 0.013}, {"position": [0.0655, -0.5893, 0.26], "rx": 0.013, "rz": 0.013}, {"position": [0.0803, -0.5556, 0.256], "rx": 0.013, "rz": 0.013}, {"position": [0.0963, -0.5234, 0.252], "rx": 0.013, "rz": 0.013}, {"position": [0.1112, -0.4818, 0.25], "rx": 0.013, "rz": 0.013}, {"position": [0.1232, -0.4148, 0.246], "rx": 0.013, "rz": 0.013}, {"position": [0.1329, -0.3461, 0.244], "rx": 0.013, "rz": 0.013}, {"position": [0.1396, -0.2989, 0.246], "rx": 0.013, "rz": 0.013}, {"position": [0.1452, -0.2595, 0.248], "rx": 0.013, "rz": 0.013}, {"position": [0.1513, -0.2266, 0.25], "rx": 0.013, "rz": 0.013}, {"position": [0.1575, -0.1853, 0.252], "rx": 0.013, "rz": 0.013}, {"position": [0.1645, -0.1035, 0.246], "rx": 0.013, "rz": 0.013}, {"position": [0.1703, -0.031, 0.226], "rx": 0.007, "rz": 0.007}], "radialSegments": 8, "capEnds": true}}, "parent": "torso", "attachment": {"parentSocket": "neck-base", "localStart": [-0.3881, -0.0931, 0.198], "localEnd": [0.1703, -0.031, 0.226], "contactType": "drapes-on-chest", "embedDepth": 0.006, "gapTolerance": 0.01, "evidenceRefs": ["face-landmarks", "full-object"]}, "dimensions": {"width": 0.6, "height": 0.7, "depth": 0.05, "units": "world", "confidence": 0.75}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": false}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "chain", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "chain-gold"}}, "material": "chain-gold", "materialLayers": ["chain-gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "link-row", "kind": "fastener", "description": "Curb chain links along the V drape (projected link pattern)", "region": [0.37, 0.5, 0.19, 0.22], "evidenceRef": "face-landmarks", "confidence": 0.8}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["face-landmarks", "full-object"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"componentId": "chain", "dominantAlbedo": "rgba(168, 152, 122, 1.0)", "secondaryAlbedo": "rgba(101, 86, 58, 1.0)", "materialClass": "metal", "materialClassConfidence": 0.6, "roughnessEstimate": 0.207, "metalnessEstimate": 1.0, "highlightEvidence": "sharp, tight specular hotspot — supports low roughness/high specularity", "sourceCropPath": "C:\\devs\\my-portfolio\\.img2threejs\\crops\\crop-chain.png", "labClusterMeta": {"clusterCount": 3, "dominantClusterSharePct": 0.359}}};
  node_chain_11.add(mesh_chain_11);
  meshes["chain"] = mesh_chain_11;
  colliders["chain"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "box proxy"};
  destructionGroups["chain"] ??= [];
  destructionGroups["chain"].push(node_chain_11);
  // repetition system "eyewear-mirror-pair" describes 6 parts that are already built individually; not instanced.

  // PLAN_1.5 WS-C slice 1: bone hierarchy from spec.rig. Model-space joints are
  // converted to parent-local offsets here. Nothing is bound yet (rig.bound === false).
  const bones: Record<string, THREE.Bone> = {};
  const boneOrder: string[] = [];
  const bone_torso = new THREE.Bone();
  bone_torso.name = "torso";
  bone_torso.position.set(-0.05, -1.55, -0.1);
  root.add(bone_torso);
  bones["torso"] = bone_torso;
  boneOrder.push("torso");
  const bone_spine_upper = new THREE.Bone();
  bone_spine_upper.name = "spine-upper";
  bone_spine_upper.position.set(0.0, 0.7000000000000001, 0.0);
  bone_torso.add(bone_spine_upper);
  bones["spine-upper"] = bone_spine_upper;
  boneOrder.push("spine-upper");
  const bone_neck = new THREE.Bone();
  bone_neck.name = "neck";
  bone_neck.position.set(0.0, 0.6499999999999999, 0.0);
  bone_spine_upper.add(bone_neck);
  bones["neck"] = bone_neck;
  boneOrder.push("neck");
  const bone_head = new THREE.Bone();
  bone_head.name = "head";
  bone_head.position.set(0.0, 0.5, 0.020000000000000004);
  bone_neck.add(bone_head);
  bones["head"] = bone_head;
  boneOrder.push("head");
  // The bones are now in REST position. updateMatrixWorld() before constructing the
  // Skeleton is load-bearing: calculateInverses() reads each bone's CURRENT world matrix,
  // and those inverses are what cancel the rest pose during skinning. Constructed before
  // this call it captures identity matrices, the rest pose never cancels, and every
  // vertex is displaced by its bone's offset at rest. Measured, not assumed --
  // scratchpad/bind_experiment.mjs read (0, 3, 0) for a vertex authored at (0, 2, 0).
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(boneOrder.map((id) => bones[id]));
  const boneIndexOf = new Map<string, number>(boneOrder.map((id, i) => [id, i]));

  // ---- PLAN_1.5 §4 weight function: ONE function over the complete bone set. No
  // mesh-id or vertex-index branching -- only positions, segment endpoints and the
  // envelope radius derived per §4.3. Ported from forge/stage5_rig/emit_rig.py, which
  // measured max |sum(w) - 1| = 2.98e-8 on executed geometry.
  const BONE_JOINT: Record<string, number[]> = {"torso": [-0.05, -1.55, -0.1], "spine-upper": [-0.05, -0.85, -0.1], "neck": [-0.05, -0.2, -0.1], "head": [-0.05, 0.3, -0.08]};
  const BONE_TIP: Record<string, number[]> = {"torso": [-0.05, -0.85, -0.1], "spine-upper": [-0.05, -0.2, -0.1], "neck": [-0.05, 0.3, -0.08], "head": [-0.04, 1.25, 0.0]};
  const BONE_ENVELOPE: Record<string, number> = {"torso": 0.6, "spine-upper": 0.6, "neck": 0.6, "head": 0.6};
  const _closest = new THREE.Vector3();
  const distanceToSegment = (p: THREE.Vector3, s: number[], e: number[]): number => {
    const ab = [e[0] - s[0], e[1] - s[1], e[2] - s[2]];
    const ap = [p.x - s[0], p.y - s[1], p.z - s[2]];
    const abLenSq = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const t = abLenSq > 1e-12
      ? THREE.MathUtils.clamp((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / abLenSq, 0, 1)
      : 0;
    _closest.set(s[0] + ab[0] * t, s[1] + ab[1] * t, s[2] + ab[2] * t);
    return p.distanceTo(_closest);
  };
  const computeVertexWeights = (p: THREE.Vector3) => {
    const scored = boneOrder.map((id) => {
      const d = distanceToSegment(p, BONE_JOINT[id], BONE_TIP[id]);
      const u = d / BONE_ENVELOPE[id];
      const falloff = Math.max(0, 1 - u * u);
      return { id, d, w: falloff * falloff };
    });
    scored.sort((a, b) => b.w - a.w);
    const kept = scored.slice(0, 4);
    const total = kept.reduce((sum, c) => sum + c.w, 0);
    const indices = [0, 0, 0, 0];
    const weights = [0, 0, 0, 0];
    if (total > 0) {
      for (let slot = 0; slot < kept.length; slot++) {
        indices[slot] = boneIndexOf.get(kept[slot].id) ?? 0;
        weights[slot] = kept[slot].w / total;
      }
      return { indices, weights, fallback: false };
    }
    // Mandatory zero-sum fallback (PLAN_1.5 §4 / ADR-8). Without it three.js's own
    // normalizeSkinWeights() rewrites an all-zero vertex to (1,0,0,0) against bone 0
    // regardless of distance, which spikes stray vertices toward the hips. Instead:
    // ignore the envelope and pin weight 1.0 to the absolutely nearest bone.
    let nearest = boneOrder[0];
    let nearestDistance = Infinity;
    for (const id of boneOrder) {
      const d = distanceToSegment(p, BONE_JOINT[id], BONE_TIP[id]);
      if (d < nearestDistance) { nearestDistance = d; nearest = id; }
    }
    indices[0] = boneIndexOf.get(nearest) ?? 0;
    weights[0] = 1;
    return { indices, weights, fallback: true };
  };

  // ---- Bake to model space, weight, and bind.
  //
  // The arrangement below was chosen by measurement, not derivation, because the same
  // geometry can be skinned four plausible ways and three of them are wrong. With a
  // vertex authored at model-space (0, 2, 0) fully weighted to a bone at (0, 1, 0) and
  // that bone rotated +90 degrees about X (correct answer: (0, 1, 1)):
  //
  //   pivot transform kept, bind identity     -> rest pose already wrong, no deformation
  //   pivot transform kept, bind matrixWorld  -> (0, 1.5, 0.5): HALF the correct swing,
  //                                              because the pivot applies on top of skinning
  //   geometry baked, pivot bypassed          -> (0, 1, 1): correct
  //   no pivot at all                         -> (0, 1, 1): correct, and identical
  //
  // The last two agreeing is the finding: what matters is that the mesh's own world
  // transform is identity and its geometry lives in the skeleton's space. So each skinned
  // mesh gets its world matrix folded into its vertex data and is reparented to `root`
  // with an identity transform. Meshes are leaves -- components are added to their pivot
  // Group, never to another mesh -- so reparenting one moves nothing else.
  // Pivots back to REST for the bake: the geometry that lands in the buffer must be
  // the same rest pose the skeleton's inverse bind matrices cancel, not the pose.
  nodes["head"]?.rotation.set(0, 0, 0);
  root.updateMatrixWorld(true);
  const skinnedMeshNames: string[] = [];
  let boundCount = 0;
  for (const boneId of boneOrder) {
    const mesh = meshes[boneId];
    if (!mesh) continue;
    const position = mesh.geometry.getAttribute('position');
    if (!position) continue;
    mesh.updateWorldMatrix(true, false);
    // applyMatrix4 mutates the vertex buffer in place and is NOT idempotent: running it
    // twice on one geometry applies the world matrix squared, and every component lands
    // somewhere it has no reason to be -- the model reads as blown apart rather than
    // wrong. Throw rather than skip, because a silent skip would leave a mesh in the
    // wrong space and the failure would resurface later as a subtler misplacement.
    if (mesh.geometry.userData.worldBaked) {
      throw new Error(
        `geometry for '${boneId}' is already world-baked; baking twice squares the ` +
        'world matrix and scatters the parts. Build a fresh factory instead of re-binding.'
      );
    }
    mesh.geometry.applyMatrix4(mesh.matrixWorld);
    mesh.geometry.userData.worldBaked = true;
    root.add(mesh);
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrixWorld(true);
    // Vertices are model-space now, which is the space the weight function measures in,
    // so no per-vertex matrix multiply is needed any more.
    const count = position.count;
    const skinIndices = new Uint16Array(count * 4);
    const skinWeights = new Float32Array(count * 4);
    const vertex = new THREE.Vector3();
    for (let v = 0; v < count; v++) {
      vertex.fromBufferAttribute(position, v);
      const { indices, weights } = computeVertexWeights(vertex);
      for (let slot = 0; slot < 4; slot++) {
        skinIndices[v * 4 + slot] = indices[slot];
        skinWeights[v * 4 + slot] = weights[slot];
      }
    }
    mesh.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    mesh.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    skinnedMeshNames.push(boneId);
    const skinned = mesh as THREE.SkinnedMesh;
    if (!skinned.isSkinnedMesh) continue;
    // bindMode is left at its default (AttachedBindMode). The bones live under `root`
    // rather than under any one mesh because a single Skeleton is shared by every skinned
    // mesh and cannot be parented under all of them; with root and each mesh at identity
    // the bone world matrices are the same either way.
    skinned.bind(skeleton, new THREE.Matrix4());
    // A SkinnedMesh's boundingSphere is computed from its REST vertex data and is not
    // recomputed when bones move, so a posed limb that swings outside its rest bounds gets
    // culled and vanishes -- worse, it vanishes only from certain camera angles, which
    // reads as a geometry bug rather than a culling one. Disabling the test outright is
    // chosen over recomputing bounds every frame because these are small, always-onscreen
    // character parts where the test saves nothing. Recorded in userData.rig so a consumer
    // that DOES need culling knows it has to supply its own bounds.
    skinned.frustumCulled = false;
    boundCount += 1;
  }

  // Pose restored on the pivots. The skinned meshes no longer hang off them -- they
  // were reparented to `root` -- so this drives only the non-skinned descendants
  // (ear shells, eye cavities), which have no bone of their own and would otherwise
  // stay at rest while the head they sit on turns. The bones get the same rotations
  // applied separately, so nothing is posed twice.
  nodes["head"]?.rotation.set(0.0, 0.13962634015954636, -0.10471975511965978);
  root.updateMatrixWorld(true);

  // The authored pose, moved from the pivots onto the bones (see _rig_pose_lines). Set
  // AFTER bind() so that the rest pose -- not this one -- is what the skeleton's inverse
  // bind matrices cancel.
  bone_head.rotation.set(0.0, 0.13962634015954636, -0.10471975511965978);
  root.updateMatrixWorld(true);
  skeleton.update();
  root.userData.rig = { bones, skeleton, boneOrder, boneIndexOf, skinAttributes: skinnedMeshNames, bound: skinnedMeshNames.length > 0 && boundCount === skinnedMeshNames.length, frustumCulled: false, cullingNote: 'skinned meshes set frustumCulled = false; bone motion does not update a SkinnedMesh boundingSphere, so a consumer that needs culling must recompute bounds per frame' };

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."], "projection": {"camera": "camera.json", "albedo": "albedo-delit-soft.png", "bakes": ["bake-bust-surface.json", "bake-hair.json"], "components": ["torso", "turtleneck-collar", "head", "hair", "lens-r", "lens-l", "rim-r", "rim-l", "bridge", "chain"], "visibility": "depth test from the reference camera; hidden surfaces fall back to the material colour", "confidence": {"face-front": 0.8, "hair-front": 0.7, "torso-front": 0.75, "sides": 0.45, "rear": 0.2}}};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createEleandrePortraitBustLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Eleandre portrait bust look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"id": "key", "type": "directional", "role": "key", "observed": true, "direction": "from camera-right, slightly above", "color": "#fff6ee", "intensity": 2.2, "softness": "large soft source", "evidence": "viewer-right cheek and wall are brighter; soft shadow under the nose falls to viewer-left"}, {"id": "fill", "type": "hemisphere", "role": "fill", "observed": true, "skyColor": "#ffffff", "groundColor": "#6b6f70", "intensity": 1.1, "evidence": "shadow side of the face keeps detail; low contrast studio fill"}, {"id": "rim", "type": "directional", "role": "rim", "observed": false, "direction": "from behind, camera-left", "color": "#e2b75c", "intensity": 1.6, "evidence": "authored, not in the photo: separates the dark hair and clothes from the page background"}, {"id": "exposure", "type": "tone-mapping", "role": "exposure", "observed": false, "toneMapping": "NeutralToneMapping", "exposure": 1.0, "evidence": "keep skin mid-tones where the photo has them; no filmic crush on the black clothes"}, {"id": "contact-shadow", "type": "shadow", "role": "contact", "observed": true, "castShadow": ["head", "hair", "lens-r", "lens-l", "chain"], "receiveShadow": ["head", "torso"], "evidence": "contact shadow and ambient occlusion: soft shadow under the chin onto the collar and under the lens rims; no ground plane (bust floats on the page)"}, {"id": "environment", "type": "environment", "role": "reflections", "observed": true, "description": "neutral grey studio room", "evidence": "lenses reflect a light grey interior"}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."], "projection": {"camera": "camera.json", "albedo": "albedo-delit-soft.png", "bakes": ["bake-bust-surface.json", "bake-hair.json"], "components": ["torso", "turtleneck-collar", "head", "hair", "lens-r", "lens-l", "rim-r", "rim-l", "bridge", "chain"], "visibility": "depth test from the reference camera; hidden surfaces fall back to the material colour", "confidence": {"face-front": 0.8, "hair-front": 0.7, "torso-front": 0.75, "sides": 0.45, "rear": 0.2}}};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createEleandrePortraitBustEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameEleandrePortraitBustCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createEleandrePortraitBustPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureEleandrePortraitBustRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createEleandrePortraitBustInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}

/** Бокс: центр, полуразмеры. */
export interface Box {
  center: [number, number, number];
  half: [number, number, number];
}

const FACES: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function boxGeometry(boxes: readonly Box[]): {
  positions: number[];
  normals: number[];
  indices: number[];
} {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const { center, half } of boxes) {
    for (const n of FACES) {
      const axis = n.findIndex((v) => v !== 0);
      const [u, w] = [0, 1, 2].filter((a) => a !== axis) as [number, number];
      const base = positions.length / 3;
      for (const [su, sw] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        const at = (a: number): number => center[a] ?? 0;
        const size = (a: number): number => half[a] ?? 0;
        const p = [0, 0, 0];
        p[axis] = at(axis) + (n[axis] ?? 0) * size(axis);
        p[u] = at(u) + su * size(u);
        p[w] = at(w) + sw * size(w);
        positions.push(...p);
        normals.push(...n);
      }
      // Обход против часовой стрелки со стороны нормали.
      const flip = (n[axis] ?? 0) * (axis === 1 ? -1 : 1) < 0;
      indices.push(...(flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]).map((i) => base + i));
    }
  }
  return { positions, normals, indices };
}

const pad4 = (n: number): number => (n + 3) & ~3;

/** glTF 2.0 в бинарном виде: одна сетка из боксов, один материал. */
export function writeGlb(
  name: string,
  boxes: readonly Box[],
  color: [number, number, number],
): Uint8Array {
  const { positions, normals, indices } = boxGeometry(boxes);
  const posBytes = positions.length * 4;
  const indexBytes = indices.length * 2;
  const bin = new Uint8Array(pad4(posBytes * 2 + indexBytes));
  const view = new DataView(bin.buffer);
  positions.forEach((v, i) => view.setFloat32(i * 4, v, true));
  normals.forEach((v, i) => view.setFloat32(posBytes + i * 4, v, true));
  indices.forEach((v, i) => view.setUint16(posBytes * 2 + i * 2, v, true));
  const min = [0, 1, 2].map((a) => Math.min(...positions.filter((_, i) => i % 3 === a)));
  const max = [0, 1, 2].map((a) => Math.max(...positions.filter((_, i) => i % 3 === a)));
  const gltf = {
    asset: { version: '2.0', generator: 'duskmarch asset-formats' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [
      { name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] },
    ],
    materials: [
      {
        name: `${name}-material`,
        pbrMetallicRoughness: {
          baseColorFactor: [...color.map((c) => Math.round((c / 255) * 1000) / 1000), 1],
          metallicFactor: 0,
          roughnessFactor: 0.9,
        },
      },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: posBytes, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: posBytes * 2, byteLength: indexBytes, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
  };
  const jsonText = JSON.stringify(gltf);
  const jsonBytes = new Uint8Array(pad4(jsonText.length)).fill(0x20);
  for (let i = 0; i < jsonText.length; i++) jsonBytes[i] = jsonText.charCodeAt(i);
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, jsonBytes.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.length;
  v.setUint32(binStart, bin.length, true);
  v.setUint32(binStart + 4, 0x004e4942, true);
  out.set(bin, binStart + 8);
  return out;
}

export interface GlbSummary {
  version: number;
  json: {
    meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
    buffers: { byteLength: number }[];
  };
  binBytes: number;
}

/** Проверка GLB: заголовок, блоки JSON и BIN, длина буфера. */
export function readGlb(bytes: Uint8Array): GlbSummary {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 28 || v.getUint32(0, true) !== 0x46546c67)
    throw new Error('GLB: нет магии glTF');
  const version = v.getUint32(4, true);
  if (version !== 2) throw new Error(`GLB: версия ${version}`);
  if (v.getUint32(8, true) !== bytes.length) throw new Error('GLB: длина не совпадает');
  const jsonLength = v.getUint32(12, true);
  if (v.getUint32(16, true) !== 0x4e4f534a) throw new Error('GLB: первый блок не JSON');
  const json = JSON.parse(
    String.fromCharCode(...bytes.subarray(20, 20 + jsonLength)),
  ) as GlbSummary['json'];
  const binStart = 20 + jsonLength;
  const binBytes = v.getUint32(binStart, true);
  if (v.getUint32(binStart + 4, true) !== 0x004e4942) throw new Error('GLB: нет блока BIN');
  if (json.buffers[0]?.byteLength !== binBytes) throw new Error('GLB: длина буфера не совпадает');
  return { version, json, binBytes };
}

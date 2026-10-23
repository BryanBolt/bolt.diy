// Générateur de QR code minimal (mode octets, correction M, versions 1 à 10, masque 0..7 évalué).
// Suffisant pour une URL courte de salon. Aucune dépendance.

const EC_CODEWORDS_M = [0, 10, 16, 26, 36, 48, 64, 72, 88, 110, 130];
const EC_BLOCKS_M = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const ALIGN_POS: number[][] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
function gfMul(a: number, b: number): number { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }

function rsGenerator(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const ng = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= gfMul(g[j], EXP[i]); }
    g = ng;
  }
  return g;
}
function rsEncode(data: number[], n: number): number[] {
  const gen = rsGenerator(n);
  const res = new Array(n).fill(0);
  for (const d of data) {
    const f = d ^ res[0];
    res.shift(); res.push(0);
    if (f) for (let j = 0; j < n; j++) res[j] ^= gfMul(gen[j + 1], f);
  }
  return res;
}

export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  let ver = 1;
  while (ver <= 10) {
    const cap = TOTAL_CODEWORDS[ver] - EC_CODEWORDS_M[ver];
    const headerBits = 4 + (ver < 10 ? 8 : 16);
    if (Math.ceil((headerBits + bytes.length * 8) / 8) <= cap) break;
    ver++;
  }
  if (ver > 10) throw new Error('texte trop long pour ce QR');
  const size = ver * 4 + 17;
  const dataCap = TOTAL_CODEWORDS[ver] - EC_CODEWORDS_M[ver];
  // flux de bits
  const bits: number[] = [];
  const push = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, dataCap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < dataCap; pad ^= 0xec ^ 0x11) data.push(pad);
  // blocs
  const nb = EC_BLOCKS_M[ver];
  const ecPer = EC_CODEWORDS_M[ver] / nb;
  const short = Math.floor(dataCap / nb);
  const longBlocks = dataCap % nb;
  const blocks: number[][] = [];
  const ecs: number[][] = [];
  let off = 0;
  for (let b = 0; b < nb; b++) {
    const len = short + (b >= nb - longBlocks ? 1 : 0);
    const d = data.slice(off, off + len);
    off += len;
    blocks.push(d);
    ecs.push(rsEncode(d, ecPer));
  }
  const seq: number[] = [];
  for (let i = 0; i < short + 1; i++) for (const b of blocks) if (i < b.length) seq.push(b[i]);
  for (let i = 0; i < ecPer; i++) for (const e of ecs) seq.push(e[i]);
  // matrice
  const m: (boolean | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));
  const set = (x: number, y: number, v: boolean) => { if (x >= 0 && y >= 0 && x < size && y < size) m[y][x] = v; };
  const finder = (cx: number, cy: number) => {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
      const on = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      set(cx + dx, cy + dy, on);
    }
  };
  finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
  for (let i = 8; i < size - 8; i++) { if (m[6][i] === null) m[6][i] = i % 2 === 0; if (m[i][6] === null) m[i][6] = i % 2 === 0; }
  const ap = ALIGN_POS[ver];
  for (const ay of ap) for (const ax of ap) {
    if (m[ay][ax] !== null) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // zones de format réservées
  for (let i = 0; i < 9; i++) { if (m[8][i] === null) m[8][i] = false; if (m[i][8] === null) m[i][8] = false; }
  for (let i = size - 8; i < size; i++) { if (m[8][i] === null) m[8][i] = false; if (m[i][8] === null) m[i][8] = false; }
  m[size - 8][8] = true;
  const reserved = m.map((row) => row.map((v) => v !== null));
  // placement des données
  let bi = 0;
  const total = seq.length * 8;
  let up = true;
  for (let x = size - 1; x > 0; x -= 2) {
    if (x === 6) x--;
    for (let k = 0; k < size; k++) {
      const y = up ? size - 1 - k : k;
      for (const dx of [0, -1]) {
        const xx = x + dx;
        if (m[y][xx] !== null) continue;
        const bit = bi < total ? (seq[bi >> 3] >> (7 - (bi & 7))) & 1 : 0;
        m[y][xx] = bit === 1;
        bi++;
      }
    }
    up = !up;
  }
  const masks = [
    (x: number, y: number) => (x + y) % 2 === 0,
    (_x: number, y: number) => y % 2 === 0,
    (x: number) => x % 3 === 0,
    (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mk = 0; mk < 8; mk++) {
    const grid = m.map((row, y) => row.map((v, x) => (reserved[y][x] ? !!v : !!v !== masks[mk](x, y))));
    writeFormat(grid, mk, size);
    const score = penalty(grid, size);
    if (score < bestScore) { bestScore = score; best = grid; }
  }
  return best!;
}

function writeFormat(g: boolean[][], mask: number, size: number): void {
  const data = (0b00 << 3) | mask; // niveau M = 00
  let v = data << 10;
  const gen = 0b10100110111;
  for (let i = 14; i >= 10; i--) if ((v >> i) & 1) v ^= gen << (i - 10);
  const f = ((data << 10) | v) ^ 0b101010000010010;
  const bit = (i: number) => ((f >> i) & 1) === 1;
  for (let i = 0; i < 6; i++) g[8][i] = bit(14 - i);
  g[8][7] = bit(8); g[8][8] = bit(7); g[7][8] = bit(6);
  for (let i = 0; i < 6; i++) g[5 - i][8] = bit(5 - i);
  for (let i = 0; i < 8; i++) g[size - 1 - i][8] = bit(14 - i);
  for (let i = 0; i < 8; i++) g[8][size - 8 + i] = bit(7 - i);
}

function penalty(g: boolean[][], n: number): number {
  let p = 0;
  for (let y = 0; y < n; y++) {
    let run = 1;
    for (let x = 1; x < n; x++) { if (g[y][x] === g[y][x - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
  }
  for (let x = 0; x < n; x++) {
    let run = 1;
    for (let y = 1; y < n; y++) { if (g[y][x] === g[y - 1][x]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
  }
  let dark = 0;
  for (const row of g) for (const v of row) if (v) dark++;
  p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return p;
}

export function drawQr(canvas: HTMLCanvasElement, text: string, px = 160): void {
  const m = qrMatrix(text);
  const n = m.length;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = px * dpr;
  canvas.height = px * dpr;
  canvas.style.width = `${px}px`;
  canvas.style.height = `${px}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cell = px / (n + 4);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#111';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) ctx.fillRect((x + 2) * cell, (y + 2) * cell, cell + 0.5, cell + 0.5);
}

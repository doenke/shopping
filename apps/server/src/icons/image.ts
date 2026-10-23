import sharp from 'sharp';

/**
 * Post-processing of generated pictures (see docs/konzept/10-icons-plan.md):
 * remove the flat key-colour background, crop to the object, centre it in the
 * safe area and export the 512 px master plus the 192 px app icon.
 */

/** Background colour the generators are asked for; rarely found in food. */
export const KEY_COLOR = { r: 255, g: 0, b: 255 } as const;
export const KEY_COLOR_HEX = '#FF00FF';

export const MASTER_SIZE = 512;
export const THUMB_SIZE = 192;
/** Longest side of the object inside the 512 canvas (safe area 448, fill ~85 %). */
const OBJECT_SIZE = 392;

export interface IconChecks {
  /** The background was flat and could be removed cleanly. */
  background: boolean;
  /** The object does not touch the picture edge (nothing cut off). */
  complete: boolean;
  /** The object is big enough to be something (not just a speck). */
  size: boolean;
}

export interface ProcessedIcon {
  image: Buffer;
  thumb: Buffer;
  checks: IconChecks;
}

type Rgb = { r: number; g: number; b: number };

function dist(data: Buffer, i: number, c: Rgb): number {
  const dr = data[i]! - c.r;
  const dg = data[i + 1]! - c.g;
  const db = data[i + 2]! - c.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

export async function processIcon(input: Buffer): Promise<ProcessedIcon> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const px = w * h;

  // Border pixels tell us what the background looks like.
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);

  const alreadyTransparent = median(border.map((p) => data[p * 4 + 3]!)) < 16;
  let background = true;

  if (!alreadyTransparent) {
    const bg: Rgb = {
      r: median(border.map((p) => data[p * 4]!)),
      g: median(border.map((p) => data[p * 4 + 1]!)),
      b: median(border.map((p) => data[p * 4 + 2]!)),
    };
    const uniform = border.filter((p) => dist(data, p * 4, bg) < 40).length / border.length;
    background = uniform > 0.85;
    const saturated = Math.max(bg.r, bg.g, bg.b) - Math.min(bg.r, bg.g, bg.b) > 150;
    const magenta = bg.r > 180 && bg.b > 180 && bg.g < 90;

    const tol = 48;
    const isBg = (i: number) => {
      if (dist(data, i, bg) < tol) return true;
      // Soft shadows on the magenta background are darker magenta.
      if (!magenta) return false;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      return r > 140 && b > 140 && g < 0.45 * Math.min(r, b) && Math.abs(r - b) < 60;
    };

    // Flood fill from the border: only background connected to the edge is removed.
    const mask = new Uint8Array(px);
    const stack: number[] = [];
    for (const p of border) {
      if (!mask[p] && isBg(p * 4)) {
        mask[p] = 1;
        stack.push(p);
      }
    }
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      const next = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const n of next) {
        if (n >= 0 && !mask[n] && isBg(n * 4)) {
          mask[n] = 1;
          stack.push(n);
        }
      }
    }
    // Enclosed holes (between grapes, inside a handle): only for a vivid key colour,
    // where an exact match cannot be part of the food.
    if (saturated) {
      for (let p = 0; p < px; p++) if (!mask[p] && dist(data, p * 4, bg) < 24) mask[p] = 1;
    }

    for (let p = 0; p < px; p++) {
      const i = p * 4;
      if (mask[p]) {
        data[i + 3] = 0;
        continue;
      }
      // Anti-aliased edge: partly background coloured pixels become partly transparent,
      // and the background colour is taken out of them (no magenta fringe).
      const x = p % w;
      const nearBg = (x > 0 && mask[p - 1]) || (x < w - 1 && mask[p + 1]) || (p >= w && mask[p - w]) || (p + w < px && mask[p + w]);
      if (!nearBg) continue;
      const d = dist(data, i, bg);
      const a = Math.min(1, Math.max(0.15, (d - 20) / 90));
      if (a < 1) {
        data[i] = Math.round(Math.min(255, Math.max(0, (data[i]! - (1 - a) * bg.r) / a)));
        data[i + 1] = Math.round(Math.min(255, Math.max(0, (data[i + 1]! - (1 - a) * bg.g) / a)));
        data[i + 2] = Math.round(Math.min(255, Math.max(0, (data[i + 2]! - (1 - a) * bg.b) / a)));
        data[i + 3] = Math.round(a * data[i + 3]!);
      }
    }
  }

  // Bounding box of the object.
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]! > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('Das Bild ist leer.');
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const margin = Math.max(2, Math.round(Math.min(w, h) * 0.005));
  const checks: IconChecks = {
    background,
    complete: minX > margin && minY > margin && maxX < w - 1 - margin && maxY < h - 1 - margin,
    size: (bw * bh) / px > 0.04,
  };

  const object = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: minX, top: minY, width: bw, height: bh })
    .resize(OBJECT_SIZE, OBJECT_SIZE, { fit: 'inside', kernel: 'lanczos3' })
    .png()
    .toBuffer({ resolveWithObject: true });
  const master = await sharp({
    create: { width: MASTER_SIZE, height: MASTER_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: object.data,
        left: Math.round((MASTER_SIZE - object.info.width) / 2),
        top: Math.round((MASTER_SIZE - object.info.height) / 2),
      },
    ])
    .png()
    .toBuffer();

  const [image, thumb] = await Promise.all([
    sharp(master).webp({ quality: 92, alphaQuality: 100, effort: 5 }).toBuffer(),
    sharp(master).resize(THUMB_SIZE, THUMB_SIZE, { kernel: 'lanczos3' }).webp({ quality: 85, alphaQuality: 100, effort: 5 }).toBuffer(),
  ]);
  return { image, thumb, checks };
}

/**
 * Turns an approved icon into a style reference for the generator: on the key
 * colour, like the pictures it is asked to produce, and below 512 px (Cloudflare limit).
 */
export async function referenceImage(master: Buffer, size = 448): Promise<Buffer> {
  return sharp(master)
    .resize(size, size)
    .flatten({ background: KEY_COLOR })
    .png()
    .toBuffer();
}

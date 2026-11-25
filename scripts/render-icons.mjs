import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function png(size, pixels) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    pixels.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function draw(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const blend = (x, y, red, green, blue, alpha = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const index = (y * size + x) * 4;
    const source = alpha / 255;
    const dest = pixels[index + 3] / 255;
    const out = source + dest * (1 - source);
    if (!out) return;
    pixels[index] = (red * source + pixels[index] * dest * (1 - source)) / out;
    pixels[index + 1] = (green * source + pixels[index + 1] * dest * (1 - source)) / out;
    pixels[index + 2] = (blue * source + pixels[index + 2] * dest * (1 - source)) / out;
    pixels[index + 3] = out * 255;
  };
  const fill = (paint, color) => {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (paint(x + 0.5, y + 0.5)) blend(x, y, ...color);
      }
    }
  };
  const center = size / 2;
  const radius = size * 0.22;
  const inPlate = (x, y) => {
    const dx = Math.max(radius - x, 0, x - (size - radius));
    const dy = Math.max(radius - y, 0, y - (size - radius));
    return dx * dx + dy * dy <= radius * radius && x >= 0 && y >= 0 && x <= size && y <= size;
  };
  fill(inPlate, [14, 36, 74, 255]);

  const face = size * 0.3;
  fill((x, y) => Math.hypot(x - center, y - center) <= face, [244, 247, 251, 255]);
  fill((x, y) => {
    const dx = x - center;
    const dy = y - center;
    const distance = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    return distance <= face + size * 0.045 && distance >= face - size * 0.015 && angle > -1.35 && angle < -0.15;
  }, [240, 168, 40, 255]);

  const stroke = (x0, y0, x1, y1, width, color) => {
    const length = Math.hypot(x1 - x0, y1 - y0) || 1;
    const steps = Math.ceil(length * 4);
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      for (let yy = Math.floor(y - width); yy <= Math.ceil(y + width); yy += 1) {
        for (let xx = Math.floor(x - width); xx <= Math.ceil(x + width); xx += 1) {
          if (Math.hypot(xx + 0.5 - x, yy + 0.5 - y) <= width) blend(xx, yy, ...color);
        }
      }
    }
  };

  const hand = [14, 36, 74, 255];
  const weight = Math.max(size <= 16 ? 1.6 : 1, size * (size <= 16 ? 0.09 : 0.035));
  stroke(center, center, center, center - face * 0.62, weight, hand);
  const angle = (120 * Math.PI) / 180;
  stroke(
    center,
    center,
    center + Math.sin(angle) * face * 0.42,
    center - Math.cos(angle) * face * 0.42,
    Math.max(weight, size * (size <= 16 ? 0.11 : 0.045)),
    hand,
  );
  fill((x, y) => Math.hypot(x - center, y - center) <= Math.max(1.2, size * 0.045), [240, 168, 40, 255]);
  return pixels;
}

function downsample(source, sourceSize, size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = sourceSize / size;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let count = 0;
      const x0 = Math.floor(x * scale);
      const x1 = Math.floor((x + 1) * scale);
      const y0 = Math.floor(y * scale);
      const y1 = Math.floor((y + 1) * scale);
      for (let yy = y0; yy < y1; yy += 1) {
        for (let xx = x0; xx < x1; xx += 1) {
          const index = (yy * sourceSize + xx) * 4;
          const weight = source[index + 3] / 255;
          red += source[index] * weight;
          green += source[index + 1] * weight;
          blue += source[index + 2] * weight;
          alpha += weight;
          count += 1;
        }
      }
      const index = (y * size + x) * 4;
      if (!alpha) continue;
      pixels[index] = red / alpha;
      pixels[index + 1] = green / alpha;
      pixels[index + 2] = blue / alpha;
      pixels[index + 3] = (alpha / count) * 255;
    }
  }
  return pixels;
}

mkdirSync(root, { recursive: true });
const large = draw(128);
writeFileSync(join(root, "icon128.png"), png(128, large));
writeFileSync(join(root, "icon16.png"), png(16, draw(16)));
for (const size of [32, 48]) {
  writeFileSync(join(root, `icon${size}.png`), png(size, downsample(large, 128, size)));
}

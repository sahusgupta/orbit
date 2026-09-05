import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paethPredictor(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

export function decodeRgbaPng(filePath) {
  const source = fs.readFileSync(filePath);
  assert.ok(source.subarray(0, 8).equals(pngSignature), `${filePath} must be a PNG file`);

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const compressed = [];

  while (offset < source.length) {
    const length = source.readUInt32BE(offset);
    const type = source.toString('ascii', offset + 4, offset + 8);
    const data = source.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      compressed.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  assert.equal(bitDepth, 8, `${filePath} must use 8-bit channels`);
  assert.equal(colorType, 6, `${filePath} must use RGBA pixels`);
  assert.equal(interlace, 0, `${filePath} must be non-interlaced for deterministic verification`);
  assert.ok(width > 0 && height > 0 && compressed.length > 0, `${filePath} has an incomplete PNG payload`);

  const bytesPerPixel = 4;
  const rowLength = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(compressed));
  assert.equal(inflated.length, height * (rowLength + 1), `${filePath} has an unexpected pixel payload size`);
  const pixels = Buffer.alloc(width * height * bytesPerPixel);

  for (let row = 0; row < height; row += 1) {
    const sourceRow = row * (rowLength + 1);
    const targetRow = row * rowLength;
    const filter = inflated[sourceRow];
    assert.ok(filter >= 0 && filter <= 4, `${filePath} uses an unsupported PNG row filter`);
    for (let column = 0; column < rowLength; column += 1) {
      const raw = inflated[sourceRow + 1 + column];
      const left = column >= bytesPerPixel ? pixels[targetRow + column - bytesPerPixel] : 0;
      const above = row > 0 ? pixels[targetRow - rowLength + column] : 0;
      const upperLeft = row > 0 && column >= bytesPerPixel
        ? pixels[targetRow - rowLength + column - bytesPerPixel]
        : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? above
            : filter === 3 ? Math.floor((left + above) / 2)
              : paethPredictor(left, above, upperLeft);
      pixels[targetRow + column] = (raw + predictor) & 0xff;
    }
  }

  return { width, height, pixels };
}

export function alphaAt(image, x, y) {
  return image.pixels[((y * image.width + x) * 4) + 3];
}

export function verifyPlayerAssets() {
  const iconPath = path.join(repositoryRoot, 'player-app', 'assets', 'icon.png');
  const splashPath = path.join(repositoryRoot, 'player-app', 'assets', 'splash-icon-transparent.png');
  const icon = decodeRgbaPng(iconPath);
  const splash = decodeRgbaPng(splashPath);

  assert.deepEqual([icon.width, icon.height], [1024, 1024], 'The App Store icon must be exactly 1024 by 1024 pixels');
  for (let index = 3; index < icon.pixels.length; index += 4) {
    assert.equal(icon.pixels[index], 255, 'The App Store icon must be fully opaque');
  }

  assert.deepEqual([splash.width, splash.height], [1254, 1254], 'The reviewed splash artwork dimensions changed unexpectedly');
  for (const [x, y] of [[0, 0], [splash.width - 1, 0], [0, splash.height - 1], [splash.width - 1, splash.height - 1]]) {
    assert.equal(alphaAt(splash, x, y), 0, 'Every splash corner must be transparent');
  }
  assert.ok(splash.pixels.some((value, index) => index % 4 === 3 && value === 0), 'Splash artwork must include transparent pixels');
  assert.ok(splash.pixels.some((value, index) => index % 4 === 3 && value === 255), 'Splash artwork must retain opaque brand artwork');
  assert.notDeepEqual(fs.readFileSync(iconPath), fs.readFileSync(splashPath), 'Icon and splash artwork must remain distinct');

  const appJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'player-app', 'app.json'), 'utf8'));
  assert.equal(appJson.expo.icon, './assets/icon.png');
  assert.equal(appJson.expo.splash.image, './assets/splash-icon-transparent.png');
  assert.equal(appJson.expo.splash.backgroundColor, '#060C1A');
  console.log('Orbit Player assets passed: opaque 1024px icon and transparent branded splash.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verifyPlayerAssets();

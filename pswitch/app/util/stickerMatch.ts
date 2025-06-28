// Based on https://github.com/mapbox/pixelmatch/blob/main/index.js,
// but will be modified to return more quickly if it's not a match
// and to ignore certain colors that appear in the background

type ImageArray = Uint8Array | Uint8ClampedArray;
type Color = [number, number, number];
type Rect = [x: number, y: number, w: number, h: number];

export default function stickerMatch(
  image1: ImageArray,
  image2: ImageArray,
  output: ImageArray | null,
  width: number,
  height: number,
  {
    threshold = 0.1,
    alpha = 0.1,
    aaColor = [255, 255, 0],
    diffColor = [255, 0, 0],
    includeAA = false,
    diffColorAlt = null,
    diffMask = false,
    exclusions = [],
  }: {
    threshold?: number;
    alpha?: number;
    aaColor?: readonly [number, number, number];
    diffColor?: readonly [number, number, number];
    includeAA?: boolean;
    diffColorAlt?: readonly [number, number, number] | null;
    diffMask?: boolean;
    exclusions: ReadonlyArray<readonly [number, number, number, number]>;

  },
) {
  if (!isPixelData(image1) || !isPixelData(image2) || (output && !isPixelData(output))) {
    throw new Error('Image data: Uint8Array, Uint8ClampedArray or Buffer expected.');
  }

  if (image1.length !== image2.length || (output && output.length !== image1.length)) {
    throw new Error('Image sizes do not match.');
  }

  if (image1.length !== width * height * 4) {
    throw new Error('Image data size does not match width/height.');
  }

  const length = width * height;
  const a32 = new Uint32Array(image1.buffer, image1.byteOffset, length);
  const b32 = new Uint32Array(image2.buffer, image2.byteOffset, length);

  // maximum acceptable square distance between two colors;
  // 35215 is the maximum possible value for the YIQ difference metric
  const maxDelta = 35215 * threshold * threshold;
  const [aaR, aaG, aaB] = aaColor;
  const [diffR, diffG, diffB] = diffColor;
  const [altR, altG, altB] = diffColorAlt ?? diffColor;
  let diff = 0;

  // compare each pixel of one image against the other one
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {

      const i = y * width + x;
      const pos = i * 4;

      const excluded = exclusions.some(([rectX, rectY, rectW, rectH]) => {
        return (x >= rectX && x < rectX + rectW) && (y >= rectY && y < rectY + rectH);
      })
      if (excluded) {
        if (output) {
          drawGrayPixel(image1, pos, alpha, output)
        }
        continue;
      }

      // squared YUV distance between colors at this pixel position, negative if the img2 pixel is darker
      const delta = a32[i] === b32[i] ? 0 : colorDelta(image1, image2, pos, pos, false);

      // the color difference is above the threshold
      if (Math.abs(delta) > maxDelta) {
        // check it's a real rendering difference or just anti-aliasing
        const isExcludedAA = !includeAA && (antialiased(image1, x, y, width, height, a32, b32) || antialiased(image2, x, y, width, height, b32, a32));
        if (isExcludedAA) {
          // one of the pixels is anti-aliasing; draw as yellow and do not count as difference
          // note that we do not include such pixels in a mask
          if (output && !diffMask) drawPixel(output, pos, aaR, aaG, aaB);

        } else {
          // found substantial difference not caused by anti-aliasing; draw it as such
          if (output) {
            if (delta < 0) {
              drawPixel(output, pos, altR, altG, altB);
            } else {
              drawPixel(output, pos, diffR, diffG, diffB);
            }
          }
          diff++;
        }

      } else if (output && !diffMask) {
        // pixels are similar; draw background as grayscale image blended with white
        drawGrayPixel(image1, pos, alpha, output);
      }
    }
  }

  // return the number of different pixels
  return diff;
}

function isPixelData(array: ImageArray) {
  // work around instanceof Uint8Array not working properly in some Jest environments
  return ArrayBuffer.isView(array) && array.BYTES_PER_ELEMENT === 1;
}



/**
 * Check if a pixel is likely a part of anti-aliasing;
 * based on "Anti-aliased Pixel and Intensity Slope Detector" paper by V. Vysniauskas, 2009
 */
function antialiased(
  img: ImageArray,
  x1: number,
  y1: number,
  width: number,
  height: number,
  a32: Uint32Array,
  b32: Uint32Array
) {
  const x0 = Math.max(x1 - 1, 0);
  const y0 = Math.max(y1 - 1, 0);
  const x2 = Math.min(x1 + 1, width - 1);
  const y2 = Math.min(y1 + 1, height - 1);
  const pos = y1 * width + x1;
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0;
  let min = 0;
  let max = 0;
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;

  // go through 8 adjacent pixels
  for (let x = x0; x <= x2; x++) {
    for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) continue;

      // brightness delta between the center pixel and adjacent one
      const delta = colorDelta(img, img, pos * 4, (y * width + x) * 4, true);

      // count the number of equal, darker and brighter adjacent pixels
      if (delta === 0) {
        zeroes++;
        // if found more than 2 equal siblings, it's definitely not anti-aliasing
        if (zeroes > 2) return false;

        // remember the darkest pixel
      } else if (delta < min) {
        min = delta;
        minX = x;
        minY = y;

        // remember the brightest pixel
      } else if (delta > max) {
        max = delta;
        maxX = x;
        maxY = y;
      }
    }
  }

  // if there are no both darker and brighter pixels among siblings, it's not anti-aliasing
  if (min === 0 || max === 0) {
    return false;
  }

  // if either the darkest or the brightest pixel has 3+ equal siblings in both images
  // (definitely not anti-aliased), this pixel is anti-aliased
  return (hasManySiblings(a32, minX, minY, width, height) && hasManySiblings(b32, minX, minY, width, height)) ||
    (hasManySiblings(a32, maxX, maxY, width, height) && hasManySiblings(b32, maxX, maxY, width, height));
}

/**
 * Check if a pixel has 3+ adjacent pixels of the same color.
 */
function hasManySiblings(img: Uint32Array, x1: number, y1: number, width: number, height: number) {
  const x0 = Math.max(x1 - 1, 0);
  const y0 = Math.max(y1 - 1, 0);
  const x2 = Math.min(x1 + 1, width - 1);
  const y2 = Math.min(y1 + 1, height - 1);
  const val = img[y1 * width + x1];
  let zeroes = x1 === x0 || x1 === x2 || y1 === y0 || y1 === y2 ? 1 : 0;

  // go through 8 adjacent pixels
  for (let x = x0; x <= x2; x++) {
    for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) {
        continue;
      }
      zeroes += +(val === img[y * width + x]);
      if (zeroes > 2) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Calculate color difference according to the paper "Measuring perceived color difference
 * using YIQ NTSC transmission color space in mobile applications" by Y. Kotsarenko and F. Ramos
 */
function colorDelta(img1: ImageArray, img2: ImageArray, k: number, m: number, yOnly: boolean = false) {
  const r1 = img1[k];
  const g1 = img1[k + 1];
  const b1 = img1[k + 2];
  const a1 = img1[k + 3];
  const r2 = img2[m];
  const g2 = img2[m + 1];
  const b2 = img2[m + 2];
  const a2 = img2[m + 3];

  let dr = r1 - r2;
  let dg = g1 - g2;
  let db = b1 - b2;
  const da = a1 - a2;

  if (dr === 0 && dg === 0 && db === 0 && da === 0) {
    return 0
  };

  if (a1 < 255 || a2 < 255) { // blend pixels with background
    const rb = 48 + 159 * (k % 2);
    const gb = 48 + 159 * ((k / 1.618033988749895 | 0) % 2);
    const bb = 48 + 159 * ((k / 2.618033988749895 | 0) % 2);
    dr = (r1 * a1 - r2 * a2 - rb * da) / 255;
    dg = (g1 * a1 - g2 * a2 - gb * da) / 255;
    db = (b1 * a1 - b2 * a2 - bb * da) / 255;
  }

  const y = dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223;

  if (yOnly) {
    return y; // brightness difference only
  }

  const i = dr * 0.59597799 - dg * 0.27417610 - db * 0.32180189;
  const q = dr * 0.21147017 - dg * 0.52261711 + db * 0.31114694;

  const delta = 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q;

  // encode whether the pixel lightens or darkens in the sign
  return y > 0 ? -delta : delta;
}

/**
 * @param {Uint8Array | Uint8ClampedArray} output
 * @param {number} pos
 * @param {number} r
 * @param {number} g
 * @param {number} b
 */
function drawPixel(output: ImageArray, pos: number, r: number, g: number, b: number) {
  output[pos + 0] = r;
  output[pos + 1] = g;
  output[pos + 2] = b;
  output[pos + 3] = 255;
}

/**
 * @param {Uint8Array | Uint8ClampedArray} img
 * @param {number} i
 * @param {number} alpha
 * @param {Uint8Array | Uint8ClampedArray} output
 */
function drawGrayPixel(image: ImageArray, i: number, alpha: number, output: ImageArray) {
  const val = 255 + (image[i] * 0.29889531 + image[i + 1] * 0.58662247 + image[i + 2] * 0.11448223 - 255) * alpha * image[i + 3] / 255;
  drawPixel(output, i, val, val, val);
}
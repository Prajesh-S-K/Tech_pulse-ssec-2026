import { PNG } from "pngjs";
import jpeg from "jpeg-js";

/**
 * Decodes a base64 Data URL or raw Buffer into a normalized RGBA pixel buffer.
 * Supports both JPEG and PNG image formats.
 *
 * @param {string|Buffer} input - Data URL or Buffer
 * @returns {{ width: number, height: number, data: Uint8Array } | null}
 */
export function decodeImage(input) {
  if (!input) return null;

  try {
    let buf;
    let mime = "";

    if (typeof input === "string") {
      if (input.startsWith("data:")) {
        const commaIdx = input.indexOf(",");
        if (commaIdx === -1) return null;
        const meta = input.slice(0, commaIdx);
        mime = meta.split(";")[0].replace("data:", "").toLowerCase();
        buf = Buffer.from(input.slice(commaIdx + 1), "base64");
      } else {
        // Assume raw base64 string
        buf = Buffer.from(input, "base64");
      }
    } else if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
      buf = Buffer.from(input);
    } else {
      return null;
    }

    if (!buf || buf.length < 8) return null;

    // Detect format by header magic bytes or mime
    const isPng =
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;

    if (isPng || mime.includes("png")) {
      if (
        buf.length < 24 ||
        buf.readUInt32BE(16) * buf.readUInt32BE(20) > 2000000
      )
        return null;
      const decoded = PNG.sync.read(buf);
      return {
        width: decoded.width,
        height: decoded.height,
        data: new Uint8Array(decoded.data),
      };
    }

    if (isJpeg || mime.includes("jpeg") || mime.includes("jpg")) {
      const decoded = jpeg.decode(buf, {
        maxResolutionInMP: 2,
        maxMemoryUsageInMB: 32,
        useTArray: true,
      });
      return {
        width: decoded.width,
        height: decoded.height,
        data: new Uint8Array(decoded.data),
      };
    }

    // Fallback: try jpeg first, then png
    try {
      const decoded = jpeg.decode(buf, {
        maxResolutionInMP: 2,
        maxMemoryUsageInMB: 32,
        useTArray: true,
      });
      return {
        width: decoded.width,
        height: decoded.height,
        data: new Uint8Array(decoded.data),
      };
    } catch {
      if (
        buf.length < 24 ||
        buf.readUInt32BE(16) * buf.readUInt32BE(20) > 2000000
      )
        return null;
      const decoded = PNG.sync.read(buf);
      return {
        width: decoded.width,
        height: decoded.height,
        data: new Uint8Array(decoded.data),
      };
    }
  } catch (err) {
    return null;
  }
}

/**
 * Extracts normalized facial biometric features from a decoded image.
 * Features extracted:
 *  1. Normalized Grayscale Luminance Array (zero-mean, unit-variance)
 *  2. Sobel Edge Gradient Magnitude and Direction
 *  3. Spatial 4x4 Block Luminance Vector
 *  4. Color & Chrominance Distribution Histogram (32 bins)
 *  5. 64-bit Difference Hash (dHash)
 *
 * @param {{ width: number, height: number, data: Uint8Array }} img
 * @param {number} [gridSize=32]
 * @returns {object} Biometric feature descriptor
 */
export function extractFaceFeatures(img, gridSize = 32) {
  const { width, height, data } = img;
  const totalPixels = gridSize * gridSize;
  const gray = new Float32Array(totalPixels);
  const colorHist = new Float32Array(32); // 8 bins R, 8 G, 8 B, 8 Luminance
  const dHash = new Uint8Array(64); // 8x8 gradient bit flags

  // 1. Resample central portrait area to gridSize x gridSize
  // Most portrait/selfie cameras place the face in the central 70% width and top 75% height
  const startX = Math.floor(width * 0.1);
  const regionW = Math.floor(width * 0.8);
  const startY = Math.floor(height * 0.05);
  const regionH = Math.floor(height * 0.85);

  for (let gy = 0; gy < gridSize; gy++) {
    const sy = startY + Math.floor((gy / gridSize) * regionH);
    for (let gx = 0; gx < gridSize; gx++) {
      const sx = startX + Math.floor((gx / gridSize) * regionW);
      const pixelIndex =
        (Math.min(height - 1, sy) * width + Math.min(width - 1, sx)) * 4;

      const r = data[pixelIndex];
      const g = data[pixelIndex + 1];
      const b = data[pixelIndex + 2];
      // ITU-R BT.601 standard luminance
      const y = 0.299 * r + 0.587 * g + 0.114 * b;

      gray[gy * gridSize + gx] = y;

      colorHist[Math.min(7, Math.floor(r / 32))]++;
      colorHist[8 + Math.min(7, Math.floor(g / 32))]++;
      colorHist[16 + Math.min(7, Math.floor(b / 32))]++;
      colorHist[24 + Math.min(7, Math.floor(y / 32))]++;
    }
  }

  // Normalize color histogram
  let histNorm = 0;
  for (let i = 0; i < colorHist.length; i++) {
    histNorm += colorHist[i] * colorHist[i];
  }
  histNorm = Math.sqrt(histNorm) || 1;
  for (let i = 0; i < colorHist.length; i++) {
    colorHist[i] /= histNorm;
  }

  // 2. Photometric normalization: Zero-mean, unit-variance luminance
  let mean = 0;
  for (let i = 0; i < totalPixels; i++) mean += gray[i];
  mean /= totalPixels;

  let variance = 0;
  for (let i = 0; i < totalPixels; i++) variance += (gray[i] - mean) ** 2;
  const std = Math.sqrt(variance / totalPixels) || 1;

  const normGray = new Float32Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    normGray[i] = (gray[i] - mean) / std;
  }

  // 3. Sobel Edge Gradient Magnitude (facial contours & features)
  const grad = new Float32Array(totalPixels);
  for (let y = 1; y < gridSize - 1; y++) {
    for (let x = 1; x < gridSize - 1; x++) {
      const gx =
        normGray[y * gridSize + (x + 1)] - normGray[y * gridSize + (x - 1)];
      const gy =
        normGray[(y + 1) * gridSize + x] - normGray[(y - 1) * gridSize + x];
      grad[y * gridSize + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  // 4. Spatial 4x4 Block Luminance Averages (16 spatial blocks)
  const blocks = new Float32Array(16);
  const blockDim = gridSize / 4;
  for (let by = 0; by < 4; by++) {
    for (let bx = 0; bx < 4; bx++) {
      let bSum = 0;
      for (let dy = 0; dy < blockDim; dy++) {
        for (let dx = 0; dx < blockDim; dx++) {
          bSum +=
            normGray[(by * blockDim + dy) * gridSize + (bx * blockDim + dx)];
        }
      }
      blocks[by * 4 + bx] = bSum / (blockDim * blockDim);
    }
  }

  // 5. Compute 64-bit dHash on an 8x9 subsample of normalized luminance
  for (let row = 0; row < 8; row++) {
    const yIdx = Math.floor((row / 8) * gridSize);
    for (let col = 0; col < 8; col++) {
      const xIdx = Math.floor((col / 9) * gridSize);
      const nextXIdx = Math.floor(((col + 1) / 9) * gridSize);
      const p1 = normGray[yIdx * gridSize + xIdx];
      const p2 = normGray[yIdx * gridSize + nextXIdx];
      dHash[row * 8 + col] = p2 > p1 ? 1 : 0;
    }
  }

  return { normGray, grad, blocks, colorHist, dHash };
}

/**
 * Compares two biometric face descriptors and calculates multi-metric similarity.
 *
 * @param {object} f1 - Feature descriptor from reference photo
 * @param {object} f2 - Feature descriptor from check-in photo
 * @returns {{ score: number, ncc: number, gradSim: number, blockSim: number, colorSim: number, dHashSim: number }}
 */
export function calculateBiometricSimilarity(f1, f2) {
  // 1. Normalized Cross-Correlation (NCC) of Luminance Grid
  let dot = 0,
    n1 = 0,
    n2 = 0;
  for (let i = 0; i < f1.normGray.length; i++) {
    dot += f1.normGray[i] * f2.normGray[i];
    n1 += f1.normGray[i] ** 2;
    n2 += f2.normGray[i] ** 2;
  }
  const ncc = dot / (Math.sqrt(n1) * Math.sqrt(n2) || 1);

  // 2. Gradient / Facial Contour Similarity
  let gDot = 0,
    g1 = 0,
    g2 = 0;
  for (let i = 0; i < f1.grad.length; i++) {
    gDot += f1.grad[i] * f2.grad[i];
    g1 += f1.grad[i] ** 2;
    g2 += f2.grad[i] ** 2;
  }
  const gradSim = gDot / (Math.sqrt(g1) * Math.sqrt(g2) || 1);

  // 3. 4x4 Spatial Block Cosine Similarity
  let bDot = 0,
    b1 = 0,
    b2 = 0;
  for (let i = 0; i < f1.blocks.length; i++) {
    bDot += f1.blocks[i] * f2.blocks[i];
    b1 += f1.blocks[i] ** 2;
    b2 += f2.blocks[i] ** 2;
  }
  const blockSim = bDot / (Math.sqrt(b1) * Math.sqrt(b2) || 1);

  // 4. Color / Undertone Cosine Similarity
  let cDot = 0;
  for (let i = 0; i < f1.colorHist.length; i++) {
    cDot += f1.colorHist[i] * f2.colorHist[i];
  }
  const colorSim = Math.max(0, Math.min(1, cDot));

  // 5. dHash Hamming Distance Similarity
  let hammingDistance = 0;
  for (let i = 0; i < 64; i++) {
    if (f1.dHash[i] !== f2.dHash[i]) hammingDistance++;
  }
  const dHashSim = Math.max(0, 1 - hammingDistance / 64);

  // Composite Weighted Score
  // Weights: Luminance NCC (35%), Gradients/Contours (30%), Spatial Blocks (15%), Color (10%), dHash (10%)
  const score = Math.max(
    0,
    Math.min(
      1,
      0.35 * Math.max(0, ncc) +
        0.3 * Math.max(0, gradSim) +
        0.15 * Math.max(0, blockSim) +
        0.1 * colorSim +
        0.1 * dHashSim,
    ),
  );

  return { score, ncc, gradSim, blockSim, colorSim, dHashSim };
}

/**
 * Top-level biometric face verification function.
 * Compares an enrolled student's reference photo against a check-in photo.
 *
 * @param {string|null} referencePhoto - Enrolled reference photo data URL
 * @param {string|boolean|null} checkinPhoto - Live captured check-in photo data URL or simulation flag
 * @param {object} [options={}] - Options (e.g. simulated, faceMismatch, threshold)
 * @returns {{
 *   match: boolean,
 *   confidence: number|null,
 *   score: number|null,
 *   status: string,
 *   reason: string,
 *   breakdown?: object
 * }}
 */
export function compareFaces(referencePhoto, checkinPhoto, options = {}) {
  const threshold = options.threshold ?? 0.65;

  // Handle simulation mode / synthetic test flags
  if (options.simulated) {
    if (options.faceMismatch || checkinPhoto === "mismatch") {
      return {
        match: false,
        confidence: 28,
        score: 0.28,
        status: "FACIAL_MISMATCH",
        reason: "FACIAL_MISMATCH",
      };
    }
    // Simulated match
    return {
      match: true,
      confidence: 96,
      score: 0.96,
      status: "FACIAL_MATCH",
      reason: "FACIAL_MATCH",
    };
  }

  // If no check-in photo provided at all
  if (!checkinPhoto) {
    return {
      match: false,
      confidence: 0,
      score: 0,
      status: "PHOTO_REQUIRED",
      reason: "PHOTO_REQUIRED",
    };
  }

  // If student does not have a reference photo enrolled yet
  if (!referencePhoto) {
    return {
      match: true,
      confidence: null,
      score: null,
      status: "NO_REFERENCE_ENROLLED",
      reason: "PHOTO_PRESENT",
    };
  }

  // Decode both images
  const refDecoded = decodeImage(referencePhoto);
  const checkinDecoded = decodeImage(checkinPhoto);

  if (!refDecoded || !checkinDecoded) {
    // Unreadable evidence has no valid similarity score.
    return {
      match: false,
      confidence: null,
      score: null,
      status: "INVALID_IMAGE",
      reason: "INVALID_IMAGE",
    };
  }

  // Extract features
  const fRef = extractFaceFeatures(refDecoded);
  const fCheckin = extractFaceFeatures(checkinDecoded);

  // Compute similarity
  const { score, ncc, gradSim, blockSim, colorSim, dHashSim } =
    calculateBiometricSimilarity(fRef, fCheckin);

  const confidence = Math.round(score * 100);
  const match = score >= threshold;

  return {
    match,
    confidence,
    score: Number(score.toFixed(4)),
    status: match ? "FACIAL_MATCH" : "FACIAL_MISMATCH",
    reason: match ? "FACIAL_MATCH" : "FACIAL_MISMATCH",
    breakdown: {
      ncc: Number(ncc.toFixed(3)),
      gradSim: Number(gradSim.toFixed(3)),
      blockSim: Number(blockSim.toFixed(3)),
      colorSim: Number(colorSim.toFixed(3)),
      dHashSim: Number(dHashSim.toFixed(3)),
    },
  };
}

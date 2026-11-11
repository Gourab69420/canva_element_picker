// Offscreen Document: Real-ESRGAN AI Super-Resolution Engine
// Runs locally inside the Chrome Extension origin via ONNX Runtime Web

let session = null;
let sessionLoading = null;

async function getInferenceSession() {
  if (session) return session;
  if (sessionLoading) return sessionLoading;

  sessionLoading = (async () => {
    try {
      ort.env.wasm.wasmPaths = chrome.runtime.getURL('lib/');
      // Use single-threaded WASM to run rock-solid without requiring SharedArrayBuffer / COOP headers
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;

      const modelUrl = chrome.runtime.getURL('models/realesrgan_x4.onnx');

      // Attempt WebGPU first if supported, then fall back to WASM
      const providers = [];
      if (navigator.gpu) {
        providers.push('webgpu');
      }
      providers.push('wasm');

      try {
        session = await ort.InferenceSession.create(modelUrl, {
          executionProviders: providers,
          graphOptimizationLevel: 'all'
        });
        console.log('[Artwork Inserter AI] Real-ESRGAN initialized with providers:', providers);
        return session;
      } catch (gpuErr) {
        console.warn('[Artwork Inserter AI] WebGPU initialization failed, falling back to pure WASM:', gpuErr);
        session = await ort.InferenceSession.create(modelUrl, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all'
        });
        console.log('[Artwork Inserter AI] Real-ESRGAN initialized with WASM provider');
        return session;
      }
    } finally {
      sessionLoading = null;
    }
  })();

  return sessionLoading;
}

// Listen for upscale requests from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen' || message.action !== 'RUN_AI_UPSCALE') {
    return false;
  }

  runRealESRGAN(message.dataUrl)
    .then(result => {
      sendResponse({ success: true, ...result });
    })
    .catch(err => {
      console.error('[Artwork Inserter AI] Upscale error:', err);
      sendResponse({ success: false, error: err.message || String(err) });
    });

  return true; // Keep message channel open for async response
});

async function runRealESRGAN(dataUrl) {
  const sess = await getInferenceSession();

  // 1. Load image
  const img = await new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image into memory'));
    image.src = dataUrl;
  });

  let sw = img.naturalWidth || img.width;
  let sh = img.naturalHeight || img.height;

  // Protect memory: clamp max input dimension to 1024px
  let workingImg = img;
  if (sw > 1024 || sh > 1024) {
    const downscale = Math.min(1024 / sw, 1024 / sh);
    const fitW = Math.round(sw * downscale);
    const fitH = Math.round(sh * downscale);
    const fitCanvas = document.createElement('canvas');
    fitCanvas.width = fitW;
    fitCanvas.height = fitH;
    const fitCtx = fitCanvas.getContext('2d');
    fitCtx.drawImage(img, 0, 0, fitW, fitH);
    workingImg = fitCanvas;
    sw = fitW;
    sh = fitH;
  }

  // 2. Read source pixels
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = sw;
  srcCanvas.height = sh;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  srcCtx.drawImage(workingImg, 0, 0);
  const srcImageData = srcCtx.getImageData(0, 0, sw, sh);
  const srcPixels = srcImageData.data;

  // Check for alpha channel transparency
  let hasAlpha = false;
  for (let i = 3; i < srcPixels.length; i += 4) {
    if (srcPixels[i] < 250) {
      hasAlpha = true;
      break;
    }
  }

  const scale = 4;
  const dw = sw * scale;
  const dh = sh * scale;
  const dstPixels = new Uint8ClampedArray(dw * dh * 4);

  // 3. Tile processing (256x256 tiles with 12px overlap margin to prevent seam lines)
  const tileSize = 256;
  const pad = 12;
  const numTilesX = Math.ceil(sw / tileSize);
  const numTilesY = Math.ceil(sh / tileSize);

  for (let ty = 0; ty < numTilesY; ty++) {
    for (let tx = 0; tx < numTilesX; tx++) {
      const x0 = tx * tileSize;
      const y0 = ty * tileSize;
      const x1 = Math.min(sw, x0 + tileSize);
      const y1 = Math.min(sh, y0 + tileSize);

      // Expand tile with padding
      const px0 = Math.max(0, x0 - pad);
      const py0 = Math.max(0, y0 - pad);
      const px1 = Math.min(sw, x1 + pad);
      const py1 = Math.min(sh, y1 + pad);

      const tw = px1 - px0;
      const th = py1 - py0;

      // Build Float32 RGB tensor: shape [1, 3, th, tw], normalized to [0, 1]
      const planeSize = th * tw;
      const tensorData = new Float32Array(3 * planeSize);
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const sIdx = ((py0 + y) * sw + (px0 + x)) * 4;
          const dIdx = y * tw + x;
          tensorData[dIdx] = srcPixels[sIdx] / 255.0;                   // R
          tensorData[planeSize + dIdx] = srcPixels[sIdx + 1] / 255.0;   // G
          tensorData[planeSize * 2 + dIdx] = srcPixels[sIdx + 2] / 255.0;// B
        }
      }

      const inputTensor = new ort.Tensor('float32', tensorData, [1, 3, th, tw]);
      const results = await sess.run({ input: inputTensor });
      const outFloats = results.output.data;

      const outTileW = tw * scale;
      const outTileH = th * scale;
      const outPlaneSize = outTileW * outTileH;

      // Crop the padding margins from output
      const cropLeft = (x0 - px0) * scale;
      const cropTop = (y0 - py0) * scale;
      const copyW = (x1 - x0) * scale;
      const copyH = (y1 - y0) * scale;

      for (let cy = 0; cy < copyH; cy++) {
        for (let cx = 0; cx < copyW; cx++) {
          const tIdx = (cropTop + cy) * outTileW + (cropLeft + cx);
          const outIdx = ((y0 * scale + cy) * dw + (x0 * scale + cx)) * 4;

          const r = Math.min(255, Math.max(0, Math.round(outFloats[tIdx] * 255.0)));
          const g = Math.min(255, Math.max(0, Math.round(outFloats[outPlaneSize + tIdx] * 255.0)));
          const b = Math.min(255, Math.max(0, Math.round(outFloats[outPlaneSize * 2 + tIdx] * 255.0)));

          dstPixels[outIdx] = r;
          dstPixels[outIdx + 1] = g;
          dstPixels[outIdx + 2] = b;
          dstPixels[outIdx + 3] = 255;
        }
      }
    }
  }

  // 4. Smoothly preserve alpha channel if graphic had transparency
  if (hasAlpha) {
    const alphaCanvas = document.createElement('canvas');
    alphaCanvas.width = dw;
    alphaCanvas.height = dh;
    const aCtx = alphaCanvas.getContext('2d');
    aCtx.imageSmoothingEnabled = true;
    aCtx.imageSmoothingQuality = 'high';
    aCtx.drawImage(srcCanvas, 0, 0, dw, dh);
    const alphaData = aCtx.getImageData(0, 0, dw, dh).data;
    for (let i = 3; i < dstPixels.length; i += 4) {
      dstPixels[i] = alphaData[i];
    }
  }

  // 5. Draw output to canvas and export high-res PNG DataURL
  const outCanvas = document.createElement('canvas');
  outCanvas.width = dw;
  outCanvas.height = dh;
  const outCtx = outCanvas.getContext('2d');
  const outImageData = new ImageData(dstPixels, dw, dh);
  outCtx.putImageData(outImageData, 0, 0);

  const upscaledDataUrl = outCanvas.toDataURL('image/png');
  return {
    upscaledDataUrl,
    origW: sw,
    origH: sh,
    outW: dw,
    outH: dh
  };
}

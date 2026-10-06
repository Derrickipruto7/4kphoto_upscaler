/* ==========================================================
   Upres — client-side 4K photo upscaler
   No server, no upload: everything runs in the browser.

   Primary pipeline: a real AI super-resolution model (ESRGAN,
   via TensorFlow.js + UpscalerJS) reconstructs detail at 4x,
   then the result is fit into a 3840x2160 frame.

   If the model can't load (offline, CDN blocked, no WebGL),
   this automatically falls back to high-quality canvas
   resampling + sharpening so the tool still works.
   ========================================================== */

const TARGET_W = 3840;
const TARGET_H = 2160;

const dropzone   = document.getElementById('dropzone');
const fileInput  = document.getElementById('fileInput');
const dzTitle    = document.getElementById('dzTitle');
const dzSub      = document.getElementById('dzSub');
const pixelGrid  = document.getElementById('pixelGrid');
const resultArea = document.getElementById('resultArea');
const beforeImg  = document.getElementById('beforeImg');
const afterImg   = document.getElementById('afterImg');
const afterClip  = document.getElementById('afterClip');
const handle     = document.getElementById('handle');
const compare    = document.getElementById('compare');
const origDims   = document.getElementById('origDims');
const newDims    = document.getElementById('newDims');
const statusText = document.getElementById('statusText');
const downloadBtn= document.getElementById('downloadBtn');
const resetBtn   = document.getElementById('resetBtn');

// Build the 8x8 signature pixel grid once
for (let i = 0; i < 64; i++) {
  const span = document.createElement('span');
  pixelGrid.appendChild(span);
}

// ---------- AI model setup ----------
// UpscalerJS loads three UMD globals from the script tags in index.html:
//   tf (TensorFlow.js), ESRGANSlim (the model package), Upscaler (the runner)
let upscalerInstance = null;
let upscalerReady = null; // promise, so concurrent calls share one load

function getUpscaler() {
  if (upscalerReady) return upscalerReady;

  upscalerReady = new Promise((resolve) => {
    try {
      const hasGlobals =
        typeof Upscaler !== 'undefined' &&
        typeof ESRGANSlim !== 'undefined' &&
        ESRGANSlim.x4;

      if (!hasGlobals) {
        console.warn('Upres: AI model scripts not found, will use fallback resampling.');
        resolve(null);
        return;
      }

      upscalerInstance = new Upscaler({ model: ESRGANSlim.x4 });
      resolve(upscalerInstance);
    } catch (err) {
      console.warn('Upres: failed to initialize AI model, will use fallback resampling.', err);
      resolve(null);
    }
  });

  return upscalerReady;
}

// Warm the model up in the background as soon as the page loads, so the
// first real upscale doesn't pay the full load cost.
window.addEventListener('load', () => { getUpscaler(); });

// ---------- Upload wiring ----------
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});

['dragenter', 'dragover'].forEach(evt =>
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); })
);
['dragleave', 'drop'].forEach(evt =>
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); })
);
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

resetBtn.addEventListener('click', () => {
  resultArea.hidden = true;
  fileInput.value = '';
  setStatus('Idle');
  dzTitle.textContent = 'Drop a photo here, or click to choose one';
  dzSub.textContent = 'JPG or PNG · processed locally · original stays private';
  pixelGrid.classList.remove('busy');
});

function setStatus(text) { statusText.textContent = text; }

// ---------- Main pipeline ----------
async function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    dzSub.textContent = 'That doesn\'t look like an image — try a JPG or PNG.';
    return;
  }

  pixelGrid.classList.add('busy');
  dzTitle.textContent = 'Working on it…';
  dzSub.textContent = 'Loading the AI model (first run only), this can take a moment';
  setStatus('Loading model');

  const img = await loadImage(file);
  origDims.textContent = `${img.naturalWidth} × ${img.naturalHeight}px`;

  let finalCanvas;

  const upscaler = await getUpscaler();

  if (upscaler) {
    try {
      setStatus('Running AI upscale');
      dzSub.textContent = 'Reconstructing detail with the AI model';

      // UpscalerJS returns a data URL of the 4x-upscaled image
      const upscaledSrc = await upscaler.upscale(img);
      const upscaledImg = await loadImageFromSrc(upscaledSrc);

      setStatus('Framing');
      finalCanvas = fitToFrame(upscaledImg);

      setStatus('Final grade');
      finalCanvas = finalGrade(finalCanvas);
    } catch (err) {
      console.warn('Upres: AI upscale failed, falling back to resampling.', err);
      finalCanvas = await fallbackPipeline(img);
    }
  } else {
    finalCanvas = await fallbackPipeline(img);
  }

  const w = finalCanvas.width;
  const h = finalCanvas.height;

  newDims.textContent = `${w} × ${h}px`;
  beforeImg.src = img.src;
  afterImg.src = finalCanvas.toDataURL('image/png');
  afterImg.onload = () => {
    // keep the "after" image visually full-size behind the clip mask
    afterClip.style.setProperty('--compare-w', compare.clientWidth + 'px');
    afterImg.style.width = compare.clientWidth + 'px';
  };

  downloadBtn.href = finalCanvas.toDataURL('image/png');
  downloadBtn.download = buildFilename(file.name);

  setStatus('Done');
  pixelGrid.classList.remove('busy');
  resultArea.hidden = false;
  resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Resampling-only fallback, used if the AI model can't load
async function fallbackPipeline(img) {
  setStatus('Resampling');
  dzSub.textContent = 'AI model unavailable — resampling and sharpening locally instead';
  const { canvas: resized } = resampleTo4K(img);

  setStatus('Sharpening');
  const sharpened = applyHighPassSharpen(resized);

  setStatus('Final grade');
  return finalGrade(sharpened);
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function loadImageFromSrc(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Fit an (already AI-upscaled) image inside a 3840x2160 frame, scaling
// down if it overshoots, up a little with canvas if it undershoots —
// never cropping, always preserving aspect ratio.
function fitToFrame(img) {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const scale = Math.min(TARGET_W / srcW, TARGET_H / srcH);
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

// Fallback-only: fit the image inside a 3840x2160 frame via plain canvas
// resampling, upscaling if it's smaller, downscaling if it's larger.
function resampleTo4K(img) {
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const scale = Math.min(TARGET_W / srcW, TARGET_H / srcH);
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // For large upscale factors, step through intermediate sizes —
  // a single huge jump softens more than a couple of doubling steps.
  let stepW = srcW, stepH = srcH;
  const growth = scale > 1 ? scale : 1;

  if (growth > 2) {
    let curCanvas = document.createElement('canvas');
    curCanvas.width = stepW;
    curCanvas.height = stepH;
    curCanvas.getContext('2d').drawImage(img, 0, 0);

    while ((stepW * 2) < w && (stepH * 2) < h) {
      const nextW = stepW * 2;
      const nextH = stepH * 2;
      const nextCanvas = document.createElement('canvas');
      nextCanvas.width = nextW;
      nextCanvas.height = nextH;
      const nctx = nextCanvas.getContext('2d');
      nctx.imageSmoothingEnabled = true;
      nctx.imageSmoothingQuality = 'high';
      nctx.drawImage(curCanvas, 0, 0, nextW, nextH);
      curCanvas = nextCanvas;
      stepW = nextW; stepH = nextH;
    }
    ctx.drawImage(curCanvas, 0, 0, w, h);
  } else {
    ctx.drawImage(img, 0, 0, w, h);
  }

  return { canvas, w, h };
}

// Fallback-only: high-pass sharpen, blending a blurred overlay copy back
// onto the image to punch up edge contrast lost in plain resampling.
function applyHighPassSharpen(sourceCanvas) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');

  octx.drawImage(sourceCanvas, 0, 0);

  octx.save();
  octx.filter = 'blur(1.6px)';
  octx.globalCompositeOperation = 'overlay';
  octx.globalAlpha = 0.45;
  octx.drawImage(sourceCanvas, 0, 0);
  octx.restore();

  return out;
}

// Small final contrast/saturation lift for a bit more perceived "pop".
// Kept light since the AI pass already adds real sharpness/detail.
function finalGrade(sourceCanvas) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.filter = 'contrast(1.04) saturate(1.04)';
  ctx.drawImage(sourceCanvas, 0, 0);
  return out;
}

function buildFilename(originalName) {
  const base = originalName.replace(/\.[^.]+$/, '');
  return `${base || 'photo'}-upres-4k.png`;
}

// ---------- Before/after compare slider ----------
let dragging = false;

function setSlider(clientX) {
  const rect = compare.getBoundingClientRect();
  let pct = ((clientX - rect.left) / rect.width) * 100;
  pct = Math.max(0, Math.min(100, pct));
  afterClip.style.width = pct + '%';
  handle.style.left = pct + '%';
}

handle.addEventListener('pointerdown', (e) => {
  dragging = true;
  handle.setPointerCapture(e.pointerId);
});
window.addEventListener('pointermove', (e) => {
  if (dragging) setSlider(e.clientX);
});
window.addEventListener('pointerup', () => { dragging = false; });

compare.addEventListener('click', (e) => {
  if (e.target === handle || handle.contains(e.target)) return;
  setSlider(e.clientX);
});

window.addEventListener('resize', () => {
  if (!resultArea.hidden) {
    afterImg.style.width = compare.clientWidth + 'px';
  }
});

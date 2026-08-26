# Upres — turn any photo into 4K, in the browser

A small, dependency-free website that takes a photo and outputs a 4K-framed,
sharpened version of it — entirely client-side. No upload, no backend, no
build step. Open `index.html` or deploy the folder as-is (e.g. GitHub Pages).

## What it actually does

Being upfront about this, since "4K" and "upscale" get thrown around loosely:

1. **Resample** — the photo is scaled (up or down) so its long edge fits a
   3840×2160 frame, using the browser's high-quality bicubic-like image
   smoothing. Large upscales are done in a couple of doubling steps rather
   than one huge jump, which holds up better than a single stretch.
2. **Sharpen** — a high-pass overlay (blurred copy blended back on top) is
   composited over the resampled image using canvas blend modes, no
   per-pixel loop, to recover edge contrast that resampling softens.
3. **Grade** — a small contrast/saturation lift for extra perceived clarity.

This is **not** an AI super-resolution model. It won't invent detail that
wasn't in the original photo the way a trained model (ESRGAN, Real-ESRGAN,
SwinIR, etc.) can. What it will do: consistently produce a correctly sized,
crisper-looking 4K image from anything you throw at it, instantly, for free,
with zero server cost and zero privacy concerns (the file never leaves the
tab).

## Files

```
index.html    Page structure and content
style.css     Design system (dark, technical, blue accent)
script.js     Upload handling, canvas resize/sharpen pipeline, compare slider
README.md     This file
```

## Running it

No install, no dependencies, no build tooling:

```bash
git clone <your-repo-url>
cd 4k-photo-upscaler
# just open index.html in a browser, or serve it:
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Deploying to GitHub Pages

1. Push this folder to a GitHub repository.
2. Repo Settings → Pages → Source → deploy from the `main` branch, root folder.
3. Your site will be live at `https://<username>.github.io/<repo-name>/`.

## Swapping in a real ML upscaler (optional)

If you want genuine AI super-resolution instead of resample+sharpen, the
integration point is `handleFile()` in `script.js`. Replace the
`resampleTo4K` / `applyHighPassSharpen` calls with a call to:

- A hosted API (e.g. Replicate's Real-ESRGAN endpoint, or your own model
  served behind an endpoint), sending the image as base64/multipart, or
- An in-browser model via [onnxruntime-web](https://github.com/microsoft/onnxruntime)
  or [tensorflow.js](https://www.tensorflow.org/js), running a lightweight
  super-resolution model fully client-side, keeping the "no server" property.

Either approach is a larger lift (model hosting/licensing for the API route,
bundle size and WASM/WebGL setup for the in-browser route) — worth doing if
image quality needs to go beyond what resampling can offer.

## Browser support

Uses `Canvas 2D`, `filter`/`globalCompositeOperation` canvas properties, and
Pointer Events — supported in all current evergreen browsers (Chrome,
Firefox, Safari, Edge).

## License

MIT — do whatever you like with it.

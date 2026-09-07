const ua = navigator.userAgent.toLowerCase();

export const isSmartPhone = /iphone|ipod|ipad|android|blackberry|webos/.test(ua);

export const hasTouch = 'ontouchstart' in window;

// Render resolution multiplier. Phones report a devicePixelRatio of 2–3; without it
// the WebGL buffers render at CSS-pixel size and the browser upscales them, which is
// why the visuals look soft on mobile. Capped at 2 — the retina sweet spot where the
// image reads as sharp while fill cost (which grows with the square of the ratio)
// stays affordable on mobile GPUs at 60fps.
export function pixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, 2);
}

// Size a raw-WebGL canvas for a high-DPI display: the CSS box stays in layout pixels
// (so the canvas still fills the viewport) while the backing store renders at device
// pixels (so the image is crisp). Three.js handles this internally via setPixelRatio.
export function fitCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): void {
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
}

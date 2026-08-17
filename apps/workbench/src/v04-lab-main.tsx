const prototype = CanvasRenderingContext2D.prototype;
const putImageData = prototype.putImageData;
const fillRect = prototype.fillRect;
const clearRect = prototype.clearRect;
const canvas = document.createElement('canvas');
canvas.width = 1280;
canvas.height = 560;
const context = canvas.getContext('2d');
if (!context || context.canvas !== canvas || canvas.width !== 1280 || canvas.height !== 560) throw new Error('invalid native canvas capability');
if (typeof putImageData !== 'function' || typeof fillRect !== 'function' || typeof clearRect !== 'function') throw new Error('invalid native canvas capability');
const nativeCanvas2D = Object.freeze({ canvas, context, putImageData, fillRect, clearRect });

async function loadCanvasScan() {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/canvas-scan.iife.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('canvas scan load failed'));
    document.head.append(script);
  });
}

async function main() {
  await loadCanvasScan();
  const { createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { V04Lab } = await import('./V04Lab');
  createRoot(document.getElementById('root')!).render(createElement(V04Lab, { nativeCanvas2D }));
}

void main();

// Fixture for the sampled path. `captureEvery` can only be set at start, and
// start must run before any canvas takes a 2D context, so this needs an entry
// of its own rather than a mode inside the main demo.
//
// It covers the interaction the unsampled demo cannot reach: work measured in
// windows sampling does not report, episode grouping at a gap wider than three
// raw window indices, and the sampling rate travelling in the artifact.
import { start } from 'canvas-scan';

const CAPTURE_EVERY = 3;
start({ captureEvery: CAPTURE_EVERY });

const canvas = document.createElement('canvas');
canvas.id = 'sampled-canvas';
canvas.width = 400;
canvas.height = 200;
document.getElementById('root')!.append(canvas);
const context = canvas.getContext('2d')!;

// Every frame draws the same commands, so a reported window that compares
// `same` is meaningful and the windows in between are known to be identical.
function drawFrame(): void {
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < 40; index++) {
    context.fillStyle = `hsl(${index * 9}, 60%, 50%)`;
    context.fillRect((index % 20) * 20, Math.floor(index / 20) * 20, 16, 16);
  }
}

let framesLeft = 0;
// Drawing on every animation frame while sampling is on makes every reported
// window `unknown` with `uncaptured-raster`, because raster work landed in
// windows nothing hashed. An application that redraws more slowly than the
// display leaves the skipped windows idle, which is the case where a sampled
// comparison still means something — so the cadence is adjustable.
let drawEvery = 1;
let tick = 0;
function loop(): void {
  if (framesLeft > 0) {
    if (tick % drawEvery === 0) {
      framesLeft--;
      drawFrame();
    }
    tick++;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// The harness drives these rather than a person, so they are plain functions
// on the window instead of controls.
Object.assign(window, {
  __SAMPLING_FIXTURE__: {
    captureEvery: CAPTURE_EVERY,
    draw(frames: number, every = 1) { drawEvery = Math.max(1, every); tick = 0; framesLeft = frames; },
    canvasId: canvas.id,
  },
});

const note = document.createElement('p');
note.textContent = `Sampling fixture — canvas-scan started with captureEvery: ${CAPTURE_EVERY}.`;
document.getElementById('root')!.prepend(note);

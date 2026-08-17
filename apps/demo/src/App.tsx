import { useRef, useState } from 'react';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawsPerFrame, setDrawsPerFrame] = useState(4);
  const [busy, setBusy] = useState(false);

  async function replayInteraction() {
    const context = canvas.current!.getContext('2d')!;
    setBusy(true);
    try {
      for (let frame = 0; frame < 8; frame++) {
        context.clearRect(0, 0, 400, 150);
        context.fillStyle = '#2563eb';
        for (let draw = 0; draw < drawsPerFrame; draw++) {
          context.fillRect(80, 35, 240, 80);
        }
        await nextFrame();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>canvas-scan v0.5 investigation demo</h1>
      <p>
        canvas-scan is already loaded before React. Use the overlay with this
        selected-canvas interaction. No setup is hidden.
      </p>
      <canvas id="ritual-canvas" ref={canvas} width={400} height={150} />
      <p>
        <button
          data-demo-action="replay-interaction"
          disabled={busy}
          onClick={() => void replayInteraction()}
        >
          {busy ? 'Replaying interaction…' : 'Replay interaction'}
        </button>{' '}
        <button
          data-demo-action="apply-candidate-change"
          disabled={busy || drawsPerFrame === 2}
          onClick={() => setDrawsPerFrame(2)}
        >
          {drawsPerFrame === 2 ? 'Candidate change applied' : 'Apply candidate change'}
        </button>
      </p>
      <p aria-live="polite">
        Application mode: {drawsPerFrame === 4 ? 'baseline, four draws per frame' : 'candidate, two draws per frame'}.
      </p>
      <ol>
        <li data-ritual-step="early-load">
          Confirm that canvas-scan is already loaded before React.
        </li>
        <li data-ritual-step="baseline">
          In the overlay, select <strong>Start recording</strong>. Select
          <strong> Replay interaction</strong>, then select <strong>Stop recording</strong>.
        </li>
        <li data-ritual-step="explanation-start">
          Open the repeated-draw-work finding. Select <strong>Explain next interaction</strong>.
        </li>
        <li data-ritual-step="explanation-result">
          Select <strong>Replay interaction</strong>, then select <strong>Stop recording</strong>.
          Read the result and select
          <strong> Copy explanation JSON</strong> when you need the artifact.
        </li>
        <li data-ritual-step="baseline-selection">
          Select <strong>Keep as baseline</strong> on that finding.
        </li>
        <li data-ritual-step="candidate">
          Select <strong>Apply candidate change</strong>. Select <strong>Start recording</strong>,
          <strong> Replay interaction</strong>, and <strong>Stop recording</strong>.
        </li>
        <li data-ritual-step="pairing">
          Open the same finding type. Select <strong>Compare with baseline</strong>.
          The finding pair is explicit.
        </li>
        <li data-ritual-step="comparison-copy">
          Review the measured pair, then select <strong>Copy comparison JSON</strong>.
        </li>
      </ol>
      <p>
        Detail covers only the selected canvas. JSON excludes raw values, page text,
        pixels, and raw application and argument URLs. It also excludes application objects
        and source content. Sanitized selected-callsite evidence can include
        generated script paths and mapped source paths. A result can be an honest unknown.
        One pair does not prove improvement.
      </p>
    </main>
  );
}

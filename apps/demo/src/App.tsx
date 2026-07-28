import { useEffect, useRef, useState } from 'react';

function RafChart() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!;
    let raf = 0;
    const draw = (t: number) => {
      ctx.clearRect(0, 0, 400, 150);
      ctx.strokeStyle = '#2563eb';
      ctx.beginPath();
      for (let x = 0; x <= 400; x += 4) {
        const y = 75 + 50 * Math.sin(x / 40 + t / 300);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas id="raf-chart" ref={ref} width={400} height={150} />;
}

function EffectChart({ value, nonce }: { value: number; nonce: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!;
    ctx.clearRect(0, 0, 400, 150);
    ctx.fillStyle = '#16a34a';
    for (let i = 0; i < 8; i++) {
      const h = 20 + ((value * 37 + i * 53) % 120);
      ctx.fillRect(i * 50 + 5, 150 - h, 40, h);
    }
  }, [value, nonce]); // nonce re-runs the effect with an unchanged command stream
  return <canvas id="effect-chart" ref={ref} width={400} height={150} />;
}

export function App() {
  const [value, setValue] = useState(1);
  const [nonce, setNonce] = useState(0);
  return (
    <main>
      <h1>canvas-scan demo</h1>
      <RafChart />
      <EffectChart value={value} nonce={nonce} />
      <p>
        <button onClick={() => setValue((v) => v + 1)}>change data</button>{' '}
        <button onClick={() => setNonce((n) => n + 1)}>redraw the same thing</button>
      </p>
    </main>
  );
}

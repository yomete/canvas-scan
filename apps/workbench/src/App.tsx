import { useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import { Layer, Rect, Stage, Star } from 'react-konva';
import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

function makeStars() {
  return Array.from({ length: 10 }, (_, i) => ({
    id: `star-${i}`,
    x: 30 + ((i * 97) % 360),
    y: 30 + ((i * 61) % 240),
    rotation: (i * 36) % 180,
  }));
}

function KonvaSection() {
  const [stars] = useState(makeStars);
  const rectRef = useRef<Konva.Rect>(null);
  useEffect(() => {
    const rect = rectRef.current;
    if (!rect) return;
    const anim = new Konva.Animation((frame) => {
      rect.rotation(((frame?.time ?? 0) / 20) % 360);
    }, rect.getLayer());
    anim.start();
    return () => {
      anim.stop();
    };
  }, []);
  return (
    <div id="konva-stage">
      <Stage width={420} height={300}>
        <Layer>
          {stars.map((s) => (
            <Star
              key={s.id}
              id={s.id}
              x={s.x}
              y={s.y}
              numPoints={5}
              innerRadius={12}
              outerRadius={24}
              fill="#89b717"
              rotation={s.rotation}
              shadowBlur={6}
              draggable
            />
          ))}
        </Layer>
        <Layer>
          <Rect
            ref={rectRef}
            x={210}
            y={150}
            width={50}
            height={50}
            offsetX={25}
            offsetY={25}
            fill="#e8443e"
          />
        </Layer>
      </Stage>
    </div>
  );
}

function ChartSection() {
  const [values, setValues] = useState([12, 19, 3, 5, 2, 3]);
  const data = {
    labels: LABELS,
    datasets: [
      {
        label: 'series A',
        data: values,
        borderColor: '#2563eb',
        backgroundColor: '#93c5fd',
      },
    ],
  };
  return (
    <div style={{ width: 480 }}>
      <Line data={data} />
      <p>
        <button id="rerender-same" onClick={() => setValues((v) => [...v])}>
          rerender same data
        </button>{' '}
        <button
          id="randomize"
          onClick={() => setValues((v) => v.map((n, i) => ((n * 7 + i * 13) % 25) + 1))}
        >
          change data
        </button>
      </p>
    </div>
  );
}

export function App() {
  return (
    <main>
      <h1>canvas-scan dogfood workbench</h1>
      <KonvaSection />
      <ChartSection />
    </main>
  );
}

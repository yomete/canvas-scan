import 'canvas-scan/auto'; // must stay the first import — hook before react-dom
import { createRoot } from 'react-dom/client';
import { App } from './App';

// M0 fixture deliberately omits <StrictMode>: dev double-invoked effects would
// double-fire draws and obscure the tracer signal (HANDOFF.md, StrictMode pitfall).
createRoot(document.getElementById('root')!).render(<App />);

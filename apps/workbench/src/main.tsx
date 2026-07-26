import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// StrictMode is deliberately ON here (unlike apps/demo): the dogfood run
// observes the double-fired physical draws real dev setups produce.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

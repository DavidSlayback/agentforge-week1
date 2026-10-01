import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { RenderErrorBoundary } from './components/RenderErrorBoundary.tsx';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
// Each card has its own boundary (Card.tsx); this one only catches a throw outside the cards
// (header, landing), so the page says so instead of going blank.
createRoot(root).render(
  <StrictMode>
    <RenderErrorBoundary
      fallback={
        <main>
          <p className="state state-error" role="alert">
            The dashboard could not be displayed (RENDER_ERROR). Reload the page.
          </p>
        </main>
      }
    >
      <App fetcher={(input, init) => fetch(input, init)} />
    </RenderErrorBoundary>
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { BackendClient } from './api/backend.js';
import { App } from './app.js';
import './styles.css';

const root = document.querySelector('#root');
if (!root) throw new Error('Application root element is missing');

const backend = new BackendClient('');

createRoot(root).render(
  <StrictMode>
    <App backend={backend} />
  </StrictMode>,
);

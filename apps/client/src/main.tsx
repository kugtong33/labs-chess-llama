import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { GatewayClient } from './api/client.js';
import { App } from './app.js';
import './styles.css';

const root = document.querySelector('#root');
if (!root) throw new Error('Application root element is missing');

const configuredGatewayUrl: unknown = import.meta.env.VITE_GATEWAY_URL;
const gateway = new GatewayClient(
  typeof configuredGatewayUrl === 'string' ? configuredGatewayUrl : '',
);

createRoot(root).render(
  <StrictMode>
    <App gateway={gateway} />
  </StrictMode>,
);

import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  createBrowserRouter,
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from 'react-router-dom';

import type { GatewayApi } from './api/client.js';
import { createGatewayQueryClient, GatewayProvider } from './api/queries.js';
import { Layout } from './components/layout.js';

export interface AppProps {
  gateway: GatewayApi;
  initialEntries?: string[];
  queryClient?: QueryClient;
}

const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <PlayPlaceholder /> },
      { path: 'games/:id', element: <PlayPlaceholder /> },
      { path: 'history', element: <RoutePlaceholder title="History" /> },
      { path: 'settings', element: <RoutePlaceholder title="Settings" /> },
    ],
  },
];

export function App({ gateway, initialEntries, queryClient }: AppProps) {
  const [client] = useState(() => queryClient ?? createGatewayQueryClient());
  const [router] = useState(() =>
    initialEntries
      ? createMemoryRouter(routes, { initialEntries })
      : createBrowserRouter(routes),
  );

  return (
    <GatewayProvider gateway={gateway}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </GatewayProvider>
  );
}

function PlayPlaceholder() {
  return (
    <section className="hero" aria-labelledby="play-title">
      <p className="eyebrow">Your machine. Your model. Your move.</p>
      <h1 id="play-title">Play chess with a local language model.</h1>
      <p className="hero-copy">
        Stockfish finds credible candidates. llama.cpp chooses a move and tells
        you why—without sending your game anywhere.
      </p>
      <div className="architecture-card" aria-label="Hybrid AI architecture">
        <span>Position</span>
        <span aria-hidden="true">→</span>
        <span>Stockfish shortlist</span>
        <span aria-hidden="true">→</span>
        <span>llama.cpp choice</span>
      </div>
    </section>
  );
}

function RoutePlaceholder({ title }: { title: string }) {
  return (
    <section className="route-placeholder">
      <p className="eyebrow">Local game workspace</p>
      <h1>{title}</h1>
      <p>This workspace is ready for your persisted local chess data.</p>
    </section>
  );
}

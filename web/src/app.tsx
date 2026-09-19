import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import {
  createBrowserRouter,
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from 'react-router-dom';

import type { BackendApi } from './api/backend.js';
import { BackendProvider, createBackendQueryClient } from './api/queries.js';
import { Layout } from './components/layout.js';

const PlayRoute = lazy(() =>
  import('./routes/play.js').then((module) => ({ default: module.PlayRoute })),
);
const HistoryRoute = lazy(() =>
  import('./routes/history.js').then((module) => ({
    default: module.HistoryRoute,
  })),
);
const SettingsRoute = lazy(() =>
  import('./routes/settings.js').then((module) => ({
    default: module.SettingsRoute,
  })),
);

export interface AppProps {
  backend: BackendApi;
  initialEntries?: string[];
  queryClient?: QueryClient;
}

const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: route(<PlayRoute />) },
      { path: 'games/:id', element: route(<PlayRoute />) },
      { path: 'history', element: route(<HistoryRoute />) },
      { path: 'settings', element: route(<SettingsRoute />) },
    ],
  },
];

export function App({ backend, initialEntries, queryClient }: AppProps) {
  const [client] = useState(() => queryClient ?? createBackendQueryClient());
  const [router] = useState(() =>
    initialEntries
      ? createMemoryRouter(routes, { initialEntries })
      : createBrowserRouter(routes),
  );

  return (
    <BackendProvider backend={backend}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </BackendProvider>
  );
}

function route(element: ReactNode) {
  return (
    <Suspense fallback={<p role="status">Loading workspace…</p>}>
      {element}
    </Suspense>
  );
}

import {
  QueryClient,
  useQuery,
  type QueryClientConfig,
} from '@tanstack/react-query';
import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from 'react';

import {
  BackendConnectionError,
  BackendProblemError,
  type BackendApi,
} from './backend.js';

export const backendKeys = {
  all: ['backend'] as const,
  health: () => [...backendKeys.all, 'health'] as const,
  games: () => [...backendKeys.all, 'games'] as const,
  game: (id: string) => [...backendKeys.games(), id] as const,
  decisions: (id: string) => [...backendKeys.game(id), 'decisions'] as const,
  settings: () => [...backendKeys.all, 'settings'] as const,
};

const BackendContext = createContext<BackendApi | undefined>(undefined);

export function BackendProvider({
  backend,
  children,
}: {
  backend: BackendApi;
  children: ReactNode;
}) {
  return createElement(BackendContext.Provider, { value: backend }, children);
}

export function useBackend(): BackendApi {
  const backend = useContext(BackendContext);
  if (!backend) throw new Error('BackendProvider is missing');
  return backend;
}

export function createBackendQueryClient(
  overrides: QueryClientConfig = {},
): QueryClient {
  return new QueryClient({
    ...overrides,
    defaultOptions: {
      ...overrides.defaultOptions,
      queries: {
        staleTime: 5_000,
        refetchOnWindowFocus: false,
        ...overrides.defaultOptions?.queries,
        retry: backendRetry,
      },
      mutations: {
        retry: false,
        ...overrides.defaultOptions?.mutations,
      },
    },
  });
}

export function useHealth() {
  const backend = useBackend();
  return useQuery({
    queryKey: backendKeys.health(),
    queryFn: ({ signal }) => backend.health(signal),
    staleTime: 2_000,
    refetchInterval: (query) => {
      return healthPollInterval(query.state.data?.status);
    },
  });
}

export function useGames() {
  const backend = useBackend();
  return useQuery({
    queryKey: backendKeys.games(),
    queryFn: ({ signal }) => backend.listGames(signal),
  });
}

export function useGame(id: string) {
  const backend = useBackend();
  return useQuery({
    queryKey: backendKeys.game(id),
    queryFn: ({ signal }) => backend.getGame(id, signal),
    enabled: id.length > 0,
  });
}

export function useDecisions(id: string) {
  const backend = useBackend();
  return useQuery({
    queryKey: backendKeys.decisions(id),
    queryFn: ({ signal }) => backend.getDecisions(id, signal),
    enabled: id.length > 0,
  });
}

export function useSettings() {
  const backend = useBackend();
  return useQuery({
    queryKey: backendKeys.settings(),
    queryFn: ({ signal }) => backend.getSettings(signal),
  });
}

export function backendRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (error instanceof BackendConnectionError) return true;
  return error instanceof BackendProblemError && error.status === 503;
}

export function healthPollInterval(
  status: 'ready' | 'loading' | 'degraded' | undefined,
): number | false {
  if (status === 'loading') return 1_000;
  if (status === 'degraded') return 5_000;
  return false;
}

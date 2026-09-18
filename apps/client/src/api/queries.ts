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
  GatewayConnectionError,
  GatewayProblemError,
  type GatewayApi,
} from './client.js';

export const gatewayKeys = {
  all: ['gateway'] as const,
  health: () => [...gatewayKeys.all, 'health'] as const,
  games: () => [...gatewayKeys.all, 'games'] as const,
  game: (id: string) => [...gatewayKeys.games(), id] as const,
  decisions: (id: string) => [...gatewayKeys.game(id), 'decisions'] as const,
  settings: () => [...gatewayKeys.all, 'settings'] as const,
};

const GatewayContext = createContext<GatewayApi | undefined>(undefined);

export function GatewayProvider({
  gateway,
  children,
}: {
  gateway: GatewayApi;
  children: ReactNode;
}) {
  return createElement(GatewayContext.Provider, { value: gateway }, children);
}

export function useGateway(): GatewayApi {
  const gateway = useContext(GatewayContext);
  if (!gateway) throw new Error('GatewayProvider is missing');
  return gateway;
}

export function createGatewayQueryClient(
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
        retry: gatewayRetry,
      },
      mutations: {
        retry: false,
        ...overrides.defaultOptions?.mutations,
      },
    },
  });
}

export function useHealth() {
  const gateway = useGateway();
  return useQuery({
    queryKey: gatewayKeys.health(),
    queryFn: ({ signal }) => gateway.health(signal),
    staleTime: 2_000,
    refetchInterval: (query) => {
      return healthPollInterval(query.state.data?.status);
    },
  });
}

export function useGames() {
  const gateway = useGateway();
  return useQuery({
    queryKey: gatewayKeys.games(),
    queryFn: ({ signal }) => gateway.listGames(signal),
  });
}

export function useGame(id: string) {
  const gateway = useGateway();
  return useQuery({
    queryKey: gatewayKeys.game(id),
    queryFn: ({ signal }) => gateway.getGame(id, signal),
    enabled: id.length > 0,
  });
}

export function useDecisions(id: string) {
  const gateway = useGateway();
  return useQuery({
    queryKey: gatewayKeys.decisions(id),
    queryFn: ({ signal }) => gateway.getDecisions(id, signal),
    enabled: id.length > 0,
  });
}

export function useSettings() {
  const gateway = useGateway();
  return useQuery({
    queryKey: gatewayKeys.settings(),
    queryFn: ({ signal }) => gateway.getSettings(signal),
  });
}

export function gatewayRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (error instanceof GatewayConnectionError) return true;
  return error instanceof GatewayProblemError && error.status === 503;
}

export function healthPollInterval(
  status: 'ready' | 'loading' | 'degraded' | undefined,
): number | false {
  if (status === 'loading') return 1_000;
  if (status === 'degraded') return 5_000;
  return false;
}

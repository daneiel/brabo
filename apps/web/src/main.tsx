import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import './index.css';
import { router } from './router';
import { initKeycloak } from './lib/keycloak';
import { ToastProvider } from './components/ui/ToastProvider';
import { logger } from './lib/logger';
import { ApiError } from './lib/api-client';

/**
 * Captura global de erro (Fase 5, item 6).
 *
 * Não existia nada disto: erro de rede era tratado pontualmente por quem
 * chamava, e exceção de render ou promise rejeitada não deixava rastro nenhum.
 * Agora toda falha vira uma linha JSON — e, quando vem de uma requisição à api,
 * carrega o `trace_id` dela, que é o que liga o erro do browser ao span de
 * servidor no Grafana.
 */
function logFailure(scope: string, error: unknown): void {
  if (error instanceof ApiError) {
    logger.errorWithTrace(`${scope}: ${error.message}`, error.traceId, {
      status: error.status,
    });
    return;
  }

  logger.error(`${scope}: ${String(error)}`, {
    stack: error instanceof Error ? error.stack : undefined,
  });
}

const queryClient = new QueryClient({
  // Os dois caches são os únicos ganchos que veem TODA falha de dado da app —
  // um try/catch por chamada deixaria passar o que o react-query engole.
  queryCache: new QueryCache({
    onError: (error) => logFailure('query', error),
  }),
  mutationCache: new MutationCache({
    onError: (error) => logFailure('mutation', error),
  }),
});

// Exceção de render que escapa e promise rejeitada sem catch: sem estes dois,
// o sintoma é uma tela em branco sem nenhum registro.
window.addEventListener('error', (event) =>
  logFailure('window.error', event.error ?? event.message),
);
window.addEventListener('unhandledrejection', (event) =>
  logFailure('unhandledrejection', event.reason),
);

// `login-required` redireciona o browser inteiro pro Keycloak quando não
// autenticado — nesse caso a promise nunca resolve com `true` aqui (a
// navegação já saiu desta página), então só renderizamos quando de fato
// autenticado.
initKeycloak().then((authenticated) => {
  if (!authenticated) return;

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
});

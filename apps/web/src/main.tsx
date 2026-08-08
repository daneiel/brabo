import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
// As fontes vêm antes: `index.css` já as referencia por `var(--font-*)`.
import './fonts.css';
import './index.css';
import { router } from './router';
import { restaurarSessao } from './lib/auth';
import { ToastProvider } from './components/ui/ToastProvider';
import { logger } from './lib/logger';
import { ApiError } from './lib/api-client';
import { deveRetentar } from './lib/query-policy';

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
  defaultOptions: {
    // 4xx não se retenta (ver `query-policy.ts`). O default do TanStack são 3
    // tentativas para QUALQUER erro, e contra o rate limit da api isso
    // quadruplicava o tráfego exatamente quando o servidor pedia menos.
    queries: { retry: deveRetentar },
  },
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

/**
 * Tenta reconstruir a sessão ANTES do primeiro render (Fase 7a — o corte).
 *
 * O access token vive em memória e some no reload; quem sobrevive é o cookie
 * `httpOnly` do refresh, e `restaurarSessao()` é o que o troca por um token
 * novo. Sem esperar por ele, o `beforeLoad` das rotas protegidas veria "sem
 * sessão" no primeiro tique e jogaria o usuário para o login a cada F5 —
 * mesmo com a sessão inteiramente válida.
 *
 * O resultado é ignorado de propósito: quem decide para onde ir é o router.
 * Aqui só se garante que a resposta já chegou.
 */
void restaurarSessao().finally(() => {
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

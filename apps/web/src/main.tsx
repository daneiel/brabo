import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import './index.css';
import { router } from './router';
import { initKeycloak } from './lib/keycloak';
import { ToastProvider } from './components/ui/ToastProvider';

const queryClient = new QueryClient();

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

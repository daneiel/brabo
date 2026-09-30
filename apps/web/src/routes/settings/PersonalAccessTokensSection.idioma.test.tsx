import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import settingsEn from '../../locales/en/settings.json';
import settingsPtBR from '../../locales/pt-BR/settings.json';
import { ToastProvider } from '../../components/ui/ToastProvider';
import { PersonalAccessTokensSection } from './PersonalAccessTokensSection';

/**
 * AT-289: a sub-lista de admin (RN-427) era a única parte desta seção com
 * texto FIXO em pt-BR — título, subtítulo, cabeçalhos, estado e o rótulo do
 * botão de revogar. Em `en` (o idioma default) a pessoa via a seção em inglês
 * e, logo abaixo, a sub-lista em português. Este arquivo prova a sub-lista
 * nos DOIS idiomas, e que nenhuma frase do outro idioma vaza.
 */
const listPersonalAccessTokens = vi.fn();
const listAllPersonalAccessTokens = vi.fn();

vi.mock('../../lib/api-client', () => ({
  listPersonalAccessTokens: (...args: unknown[]) => listPersonalAccessTokens(...args),
  issuePersonalAccessToken: vi.fn(),
  revokePersonalAccessToken: vi.fn(),
  listAllPersonalAccessTokens: (...args: unknown[]) => listAllPersonalAccessTokens(...args),
  revokePersonalAccessTokenAsMaintainer: vi.fn(),
}));

vi.mock('../../lib/hooks', () => ({
  useCurrentWorkspaceWithRole: () => ({ data: { role: 'maintainer' } }),
}));

function montar(lng: 'en' | 'pt-BR') {
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    resources: { en: { settings: settingsEn }, 'pt-BR': { settings: settingsPtBR } },
    lng,
    fallbackLng: 'en',
    defaultNS: 'settings',
    ns: ['settings'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <PersonalAccessTokensSection projectId="proj-1" />
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const tokenDeOutro = {
  id: 'pat-2',
  name: 'ci',
  projectId: 'proj-1',
  userId: 'user-2',
  userEmail: 'outro@brabo.dev',
  createdAt: '2026-08-10T00:00:00.000Z',
  expiresAt: null,
  revokedAt: null,
  lastUsedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  listPersonalAccessTokens.mockResolvedValue([]);
  listAllPersonalAccessTokens.mockResolvedValue([tokenDeOutro]);
});

describe('PersonalAccessTokensSection — sub-lista de admin nos dois idiomas (AT-289)', () => {
  it('em en, a sub-lista sai inteira em inglês, sem frase em pt-BR', async () => {
    montar('en');

    expect(await screen.findByText('All project tokens')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Revoke ci (outro@brabo.dev)' })).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.queryByText('Todos os tokens do projeto')).not.toBeInTheDocument();
    expect(screen.queryByText('Dono')).not.toBeInTheDocument();
    expect(screen.queryByText('ativo')).not.toBeInTheDocument();
  });

  it('em pt-BR, a mesma sub-lista sai em português, sem frase em inglês', async () => {
    montar('pt-BR');

    expect(await screen.findByText('Todos os tokens do projeto')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Revogar ci (outro@brabo.dev)' })).toBeInTheDocument();
    expect(screen.getByText('Dono')).toBeInTheDocument();
    expect(screen.queryByText('All project tokens')).not.toBeInTheDocument();
    expect(screen.queryByText('Owner')).not.toBeInTheDocument();
  });
});

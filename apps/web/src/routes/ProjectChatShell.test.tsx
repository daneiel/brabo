import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import sessionsPtBR from '../locales/pt-BR/sessions.json';
import { ProjectChatShell } from './ProjectChatShell';

// Instância isolada de i18next, mesmo padrão de `AccountPage.test.tsx`: o
// componente usa `useTranslation('sessions')` e as asserções abaixo já
// existiam em pt-BR, então a instância de teste fica em pt-BR (o inglês é
// coberto pelos próprios JSON de recurso, não por este teste).
function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: { 'pt-BR': { sessions: sessionsPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'sessions',
    ns: ['sessions'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

// Os dois caminhos de dados de verdade não são o assunto deste teste — já
// têm suite própria (`ProjectSessionsTab.test.tsx`, `ProjectRagTab.test.tsx`)
// que monta cada um sozinho, sem este shell no meio. Aqui só importa QUAL
// dos dois está montado, e que a lógica de nenhum dos dois foi tocada.
vi.mock('./ProjectSessionsTab', () => ({
  ProjectChatTab: ({ projectId }: { projectId: string }) => (
    <div>painel de conversar ({projectId})</div>
  ),
}));
vi.mock('./ProjectRagTab', () => ({
  ProjectRagTab: ({ projectId }: { projectId: string }) => (
    <div>painel de buscar ({projectId})</div>
  ),
}));

function montarComUrl(busca: string) {
  window.history.pushState({}, '', `/projects/proj-1${busca}`);
  const i18n = novaInstanciaI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <ProjectChatShell projectId="proj-1" />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  window.history.pushState({}, '', '/projects/proj-1');
});

afterEach(() => {
  window.history.pushState({}, '', '/');
});

describe('ProjectChatShell — fusão de UI entre Chat e Chat RAG (PROGRAMA de abas agrupadas, Onda 1)', () => {
  it('sem `?tab=` na URL, abre no segmento "Conversar" — o caminho mais comum', () => {
    montarComUrl('');

    expect(screen.getByText('painel de conversar (proj-1)')).toBeInTheDocument();
    expect(screen.queryByText(/painel de buscar/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Conversar' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('`?tab=sessions` (o alias do Chat de antes) também abre em "Conversar"', () => {
    montarComUrl('?tab=sessions');

    expect(screen.getByText('painel de conversar (proj-1)')).toBeInTheDocument();
  });

  it('`?tab=rag` (o link antigo da aba que existia sozinha) abre direto em "Buscar"', () => {
    montarComUrl('?tab=rag');

    expect(screen.getByText('painel de buscar (proj-1)')).toBeInTheDocument();
    expect(screen.queryByText(/painel de conversar/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Buscar' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('clicar no controle segmentado alterna qual painel está montado, sem depender da URL de novo', async () => {
    const usuario = userEvent.setup();
    montarComUrl('');

    expect(screen.getByText('painel de conversar (proj-1)')).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(screen.getByText('painel de buscar (proj-1)')).toBeInTheDocument();
    expect(screen.queryByText(/painel de conversar/)).toBeNull();

    await usuario.click(screen.getByRole('button', { name: 'Conversar' }));
    expect(screen.getByText('painel de conversar (proj-1)')).toBeInTheDocument();
    expect(screen.queryByText(/painel de buscar/)).toBeNull();
  });
});

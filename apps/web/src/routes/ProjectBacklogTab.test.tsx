import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import { ProjectBacklogTab } from './ProjectBacklogTab';
import { ToastProvider } from '../components/ui/ToastProvider';
import type { Epic, Story } from '../lib/api-types';
import backlogEn from '../locales/en/backlog.json';
import backlogPtBR from '../locales/pt-BR/backlog.json';

const listBacklog = vi.fn();
const getCoverage = vi.fn();
const promoteStories = vi.fn();
const returnStory = vi.fn();

vi.mock('../lib/api-client', () => ({
  listBacklog: (...args: unknown[]) => listBacklog(...args),
  getCoverage: (...args: unknown[]) => getCoverage(...args),
  promoteStories: (...args: unknown[]) => promoteStories(...args),
  returnStory: (...args: unknown[]) => returnStory(...args),
}));

function story(over: Partial<Story> = {}): Story {
  return {
    id: 'story-1',
    epicId: 'epic-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    title: 'Cadastrar usuário',
    description: '',
    rf: ['formulário de cadastro'],
    rnf: [],
    businessRuleIds: ['evt-r1'],
    dod: ['testes passando'],
    dor: ['aceite claro'],
    status: 'draft',
    proposedReady: true,
    returnedReason: null,
    returnedAt: null,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    tasks: [],
    ...over,
  };
}

function epic(stories: Story[]): Epic {
  return {
    id: 'epic-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    title: 'Cadastro',
    description: '',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    stories,
  };
}

// Instância própria de i18next, isolada da global (mesmo padrão do
// AccountPage.test.tsx) — `lng: 'pt-BR'` porque as asserções abaixo checam
// o texto ATUAL em português, que é o que já estava hardcoded antes da
// extração.
function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: {
      en: { backlog: backlogEn },
      'pt-BR': { backlog: backlogPtBR },
    },
    lng: 'pt-BR',
    fallbackLng: 'en',
    defaultNS: 'backlog',
    ns: ['backlog'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const i18n = novaInstanciaI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ProjectBacklogTab projectId="proj-1" />
        </ToastProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getCoverage.mockResolvedValue({ rules: [], uncoveredCount: 0 });
  promoteStories.mockResolvedValue({ promoted: ['story-1'], failed: [] });
  returnStory.mockResolvedValue({ ok: true });
});

describe('ProjectBacklogTab — aguardando sua promoção (Fase 12c, RN-048)', () => {
  it('sem histórias propostas a seção não aparece', async () => {
    listBacklog.mockResolvedValue([
      epic([story({ status: 'ready', proposedReady: false })]),
    ]);
    montar();

    expect(await screen.findByText('Backlog')).toBeTruthy();
    expect(screen.queryByText('Aguardando sua promoção')).toBeNull();
  });

  it('lista as propostas e diz o que está em jogo', async () => {
    listBacklog.mockResolvedValue([epic([story()])]);
    montar();

    expect(await screen.findByText('Aguardando sua promoção')).toBeTruthy();
    expect(
      screen.getByText(/nenhuma tarefa delas é pegável por um dev agent/),
    ).toBeTruthy();
  });

  it('promover individual manda um lote de 1', async () => {
    listBacklog.mockResolvedValue([epic([story()])]);
    montar();

    fireEvent.click(await screen.findByText('Promover'));

    await waitFor(() =>
      expect(promoteStories).toHaveBeenCalledWith('proj-1', ['story-1']),
    );
    expect(await screen.findByText('1 história(s) promovida(s)')).toBeTruthy();
  });

  it('lote: seleciona duas e promove as duas de uma vez', async () => {
    listBacklog.mockResolvedValue([
      epic([story({ id: 'story-1' }), story({ id: 'story-2', title: 'Login' })]),
    ]);
    promoteStories.mockResolvedValue({
      promoted: ['story-1', 'story-2'],
      failed: [],
    });
    montar();

    fireEvent.click(await screen.findByLabelText('Selecionar Cadastrar usuário'));
    fireEvent.click(screen.getByLabelText('Selecionar Login'));

    expect(screen.getByText('2 selecionada(s)')).toBeTruthy();
    fireEvent.click(screen.getByText('Promover selecionadas'));

    await waitFor(() =>
      expect(promoteStories).toHaveBeenCalledWith('proj-1', [
        'story-1',
        'story-2',
      ]),
    );
  });

  it('falha parcial não é tratada como erro — diz quantas passaram e por que a outra não', async () => {
    // O contrato do servidor é 201 com `promoted` e `failed` convivendo. Se a
    // tela tratasse isso como sucesso/erro binário, perderia a única
    // informação acionável que a resposta traz.
    listBacklog.mockResolvedValue([
      epic([story({ id: 'story-1' }), story({ id: 'story-2', title: 'Login' })]),
    ]);
    promoteStories.mockResolvedValue({
      promoted: ['story-1'],
      failed: [{ storyId: 'story-2', reason: 'módulo `fantasma` não existe' }],
    });
    montar();

    fireEvent.click(await screen.findByLabelText('Selecionar Cadastrar usuário'));
    fireEvent.click(screen.getByLabelText('Selecionar Login'));
    fireEvent.click(screen.getByText('Promover selecionadas'));

    expect(
      await screen.findByText('1 promovida(s), 1 recusada(s) pelo domínio'),
    ).toBeTruthy();
    expect(screen.getByText('módulo `fantasma` não existe')).toBeTruthy();
  });

  it('recusar exige motivo e o envia ao PO', async () => {
    listBacklog.mockResolvedValue([epic([story()])]);
    montar();

    fireEvent.click(await screen.findByText('Recusar'));

    // Sem motivo o botão não deixa devolver: a mensagem é o que o PO recebe.
    const devolver = screen.getByText('Devolver ao PO').closest('button');
    expect(devolver?.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Motivo'), {
      target: { value: 'Faltou o caso de recusa do pagamento' },
    });
    fireEvent.click(screen.getByText('Devolver ao PO'));

    await waitFor(() =>
      expect(returnStory).toHaveBeenCalledWith(
        'proj-1',
        'story-1',
        'Faltou o caso de recusa do pagamento',
      ),
    );
  });

  it('história já devolvida mostra o motivo na árvore', async () => {
    listBacklog.mockResolvedValue([
      epic([
        story({
          proposedReady: false,
          returnedReason: 'Faltou o caso de recusa',
          returnedAt: '2026-08-02T01:00:00.000Z',
        }),
      ]),
    ]);
    montar();

    fireEvent.click(await screen.findByText('Cadastrar usuário'));
    expect(screen.getByText(/Faltou o caso de recusa/)).toBeTruthy();
  });
});

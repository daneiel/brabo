import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import overviewPtBR from '../locales/pt-BR/overview.json';
import type {
  MirrorState,
  Model,
  ModelsByCategory,
  Project,
} from '../lib/api-types';
import { AmbienteDoProjeto } from './AmbienteDoProjeto';

/**
 * Estado de ambiente do projeto — a metade dos sinais que só é verdade depois
 * do login.
 *
 * O que este arquivo guarda não é layout: é a FRONTEIRA DA AFIRMAÇÃO. O sinal
 * de runner vem de `workspaceVerifiedAt`, que é o carimbo de "um runner
 * confirmou esta pasta um dia" — e não é batimento por duas razões
 * independentes: não há processo sendo observado, e reconectar reportando o
 * mesmo caminho nem regrava o carimbo (decisão explícita de
 * `ConfirmProjectWorkspaceUseCase`). Uma bolinha verde ou a palavra "de pé"
 * aqui seriam uma garantia de liveness que o dado não sustenta, e é isso que
 * os casos abaixo travam.
 */
const getProject = vi.fn();
const listModels = vi.fn();
const getMirrorState = vi.fn();

vi.mock('../lib/api-client', () => ({
  getProject: (...args: unknown[]) => getProject(...args),
  listModels: (...args: unknown[]) => listModels(...args),
  getMirrorState: (...args: unknown[]) => getMirrorState(...args),
}));

function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: { 'pt-BR': { overview: overviewPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'overview',
    ns: ['overview'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

const PROJETO: Project = {
  id: 'proj-1',
  workspaceId: 'ws-1',
  name: 'Brabo',
  slug: 'brabo',
  createdBy: 'user-1',
  maxConsecutiveBlocked: null,
  storyPromotion: 'manual',
  executionMode: 'container',
  workspacePath: null,
  workspaceVerifiedAt: null,
  mirrorPath: null,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
};

function modelo(id: string): Model {
  return {
    id,
    provider: 'ollama',
    name: id,
    category: 'local',
    contextWindow: 8192,
    inputPricePerMTokUsd: 0,
    outputPricePerMTokUsd: 0,
    supportsTools: true,
    supportsVision: false,
    supportsEmbeddings: false,
    availability: 'available',
    isActive: true,
    uses: [],
  } as unknown as Model;
}

function modelos(locais: string[]): ModelsByCategory {
  return {
    local: locais.length ? { ollama: locais.map(modelo) } : {},
    cloud: {},
  } as ModelsByCategory;
}

const ESPELHO: MirrorState = {
  mirrorPath: '/home/eu/espelhos/brabo',
  status: 'never',
  lastSyncedAt: null,
  filesCopied: null,
  filesSkipped: null,
  filesRefused: null,
  lastDestination: null,
  lastError: null,
  lastErrorAt: null,
};

function montar(
  project: Partial<Project> = {},
  locais: string[] = [],
  espelho: Partial<MirrorState> | null = null,
) {
  getProject.mockResolvedValue({ ...PROJETO, ...project });
  listModels.mockResolvedValue(modelos(locais));
  getMirrorState.mockResolvedValue({ ...ESPELHO, ...(espelho ?? {}) });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={novaInstanciaI18n()}>
        <AmbienteDoProjeto projectId="proj-1" />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getProject.mockReset();
  listModels.mockReset();
  getMirrorState.mockReset();
});

describe('AmbienteDoProjeto', () => {
  it('diz onde o código roda, e mostra o caminho quando há um', async () => {
    montar({ executionMode: 'mounted', workspacePath: '/home/eu/app' });

    expect(await screen.findByText('pasta montada')).toBeInTheDocument();
    expect(screen.getByText('/home/eu/app')).toBeInTheDocument();
  });

  it('no modo container não existe linha de runner', async () => {
    // `workspaceVerifiedAt` é nulo por definição fora do modo `runner` (a
    // conversão de modo o zera, RN-450) — uma linha "nunca confirmada" ali
    // seria uma ausência inventada, não um fato.
    montar({ executionMode: 'container' });

    expect(await screen.findByText('container gerenciado')).toBeInTheDocument();
    expect(screen.queryByText('runner')).toBeNull();
  });

  it('runner confirmado é registro de confirmação, nunca "de pé"', async () => {
    const { container } = montar({
      executionMode: 'runner',
      workspacePath: '/home/eu/app',
      workspaceVerifiedAt: '2026-08-28T09:30:00.000Z',
    });

    expect(await screen.findByText('runner')).toBeInTheDocument();
    expect(screen.getByText(/pasta confirmada em /)).toBeInTheDocument();

    // A ressalva é obrigatória: sem ela a data lê como batimento.
    expect(
      screen.getByText(/não um sinal de que o runner está rodando agora/i),
    ).toBeInTheDocument();

    // E nenhum vocabulário de liveness em lugar nenhum do bloco.
    expect(container.textContent).not.toMatch(/de pé|online|conectado agora/i);
  });

  it('runner nunca confirmado diz isso, e ensina o caminho', async () => {
    montar({
      executionMode: 'runner',
      workspacePath: '/home/eu/app',
      workspaceVerifiedAt: null,
    });

    expect(await screen.findByText('pasta ainda não confirmada')).toBeInTheDocument();
    expect(
      screen.getByText(/Nenhum runner conectou a este projeto ainda/i),
    ).toBeInTheDocument();
  });

  it('um modelo local sai no singular', async () => {
    montar({}, ['llama3']);

    expect(
      await screen.findByText('1 do Ollama, ativo no workspace'),
    ).toBeInTheDocument();
  });

  it('dois modelos locais saem no plural', async () => {
    montar({}, ['llama3', 'qwen3']);

    expect(
      await screen.findByText('2 do Ollama, ativos no workspace'),
    ).toBeInTheDocument();
  });

  it('zero modelo local é um fato, com frase própria', async () => {
    // O pt-BR põe 0 na categoria `one` do CLDR, então o plural do i18next
    // devolveria "0 do Ollama, ativo no workspace" — frase que ninguém
    // escreveria. Zero tem chave separada de propósito.
    montar({}, []);

    expect(
      await screen.findByText('nenhum modelo do Ollama ativo no workspace'),
    ).toBeInTheDocument();
  });

  it('enquanto as consultas não voltam, diz "verificando" em vez de afirmar', () => {
    getProject.mockReturnValue(new Promise(() => {}));
    listModels.mockReturnValue(new Promise(() => {}));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={novaInstanciaI18n()}>
          <AmbienteDoProjeto projectId="proj-1" />
        </I18nextProvider>
      </QueryClientProvider>,
    );

    expect(screen.getAllByText('verificando…')).toHaveLength(2);
  });

  // RN-517 (ADR 0147 ponto 7) — a linha do espelho. O que estes casos travam
  // é o mesmo da linha do runner: a fronteira da afirmação, e os TRÊS estados
  // da RN-088 com TRÊS frases, nenhuma virando a outra.
  describe('linha do espelho (RN-517)', () => {
    it('projeto SEM destino não tem linha de espelho, e nem consulta o estado', async () => {
      // Ausência inventada é o defeito: num projeto sem espelho não há o que
      // sincronizar, então "nunca sincronizou" seria uma pendência falsa.
      montar({ executionMode: 'mounted', workspacePath: '/home/eu/app' });

      expect(await screen.findByText('pasta montada')).toBeInTheDocument();
      expect(screen.queryByText('espelho')).toBeNull();
      expect(getMirrorState).not.toHaveBeenCalled();
    });

    it('projeto COM destino que nunca sincronizou diz isso, com frase própria', async () => {
      montar(
        {
          executionMode: 'mounted',
          workspacePath: '/home/eu/app',
          mirrorPath: '/home/eu/espelhos/brabo',
        },
        [],
        { status: 'never' },
      );

      expect(await screen.findByText('nunca sincronizou')).toBeInTheDocument();
      expect(screen.getByText('espelho')).toBeInTheDocument();
      expect(
        screen.getByText(/Nenhuma rodada foi reportada para este projeto ainda/i),
      ).toBeInTheDocument();
    });

    it('sincronizou copiando arquivos: data absoluta, contagem, e NUNCA "de pé"', async () => {
      const { container } = montar(
        {
          executionMode: 'mounted',
          workspacePath: '/home/eu/app',
          mirrorPath: '/home/eu/espelhos/brabo',
        },
        [],
        {
          status: 'synced',
          lastSyncedAt: '2026-09-07T09:30:00.000Z',
          filesCopied: 412,
          lastDestination: '/home/eu/espelhos/brabo',
        },
      );

      expect(await screen.findByText(/412 arquivos copiados em /)).toBeInTheDocument();
      // A ressalva é obrigatória: sem ela a data lê como "está em dia agora".
      expect(screen.getByText(/momentos nomeados/i)).toBeInTheDocument();
      expect(container.textContent).not.toMatch(/de pé|online|sincronizado agora/i);
    });

    it('sincronizou e não copiou NADA não é "nunca sincronizou"', async () => {
      montar(
        {
          executionMode: 'mounted',
          workspacePath: '/home/eu/app',
          mirrorPath: '/home/eu/espelhos/brabo',
        },
        [],
        {
          status: 'synced',
          lastSyncedAt: '2026-09-07T09:30:00.000Z',
          filesCopied: 0,
          lastDestination: '/home/eu/espelhos/brabo',
        },
      );

      expect(await screen.findByText(/nada a copiar/)).toBeInTheDocument();
      expect(screen.queryByText('nunca sincronizou')).toBeNull();
    });

    it('falhou mostra o erro NOMEADO e mantém a última cópia boa', async () => {
      montar(
        {
          executionMode: 'mounted',
          workspacePath: '/home/eu/app',
          mirrorPath: '/home/eu/espelhos/brabo',
        },
        [],
        {
          status: 'failed',
          lastSyncedAt: '2026-09-06T09:30:00.000Z',
          filesCopied: 412,
          lastDestination: '/home/eu/espelhos/brabo',
          lastError: 'o espelho não conseguiu listar o trabalho com o git',
          lastErrorAt: '2026-09-07T09:30:00.000Z',
        },
      );

      // A última cópia BOA continua na frase — é a informação mais útil que a
      // tela tem enquanto o espelho está quebrado.
      expect(
        await screen.findByText(/a última rodada falhou — última cópia boa em /),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/o espelho não conseguiu listar o trabalho com o git/),
      ).toBeInTheDocument();
    });

    it('falhou SEM nenhuma cópia boa anterior tem frase diferente', async () => {
      montar(
        {
          executionMode: 'mounted',
          workspacePath: '/home/eu/app',
          mirrorPath: '/home/eu/espelhos/brabo',
        },
        [],
        {
          status: 'failed',
          lastSyncedAt: null,
          lastError: 'destino não concedido',
          lastErrorAt: '2026-09-07T09:30:00.000Z',
        },
      );

      expect(await screen.findByText('a última rodada falhou')).toBeInTheDocument();
    });

    it('destino trocado depois da rodada é DITO, com o destino de então', async () => {
      montar(
        {
          executionMode: 'mounted',
          workspacePath: '/home/eu/app',
          mirrorPath: '/home/eu/espelhos/novo',
        },
        [],
        {
          status: 'synced',
          lastSyncedAt: '2026-09-07T09:30:00.000Z',
          filesCopied: 5,
          lastDestination: '/home/eu/espelhos/antigo',
        },
      );

      expect(
        await screen.findByText(/escreveu em \/home\/eu\/espelhos\/antigo/),
      ).toBeInTheDocument();
    });
  });

  it('reusa as chaves de consulta que a página já busca — nenhuma requisição a mais', async () => {
    // A prova é a CHAVE, não a contagem de chamadas: `['project', id]` é a
    // mesma de `ProjectPage` e `['models', id]` a mesma da Visão geral, então
    // no ar as duas saem do cache do TanStack. Uma chave nova aqui dobraria as
    // duas requisições sem ninguém notar.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(['project', 'proj-1'], {
      ...PROJETO,
      executionMode: 'runner',
      workspacePath: '/vindo/do/cache',
      workspaceVerifiedAt: '2026-08-28T09:30:00.000Z',
    });
    client.setQueryData(['models', 'proj-1'], modelos(['llama3']));
    getProject.mockReturnValue(new Promise(() => {}));
    listModels.mockReturnValue(new Promise(() => {}));

    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={novaInstanciaI18n()}>
          <AmbienteDoProjeto projectId="proj-1" />
        </I18nextProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('/vindo/do/cache')).toBeInTheDocument();
    });
    expect(
      screen.getByText('1 do Ollama, ativo no workspace'),
    ).toBeInTheDocument();
  });
});

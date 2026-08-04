import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModelCatalogSection } from './ModelCatalogSection';
import { ToastProvider } from './ui/ToastProvider';
import type {
  CatalogoPorCategoria,
  ModelComCuradoria,
} from '../lib/api-types';

const listModelCatalog = vi.fn();
const setModelsActive = vi.fn();
const syncModelCatalog = vi.fn();
const listCredentials = vi.fn();
const setModelUses = vi.fn();

vi.mock('../lib/api-client', () => ({
  listModelCatalog: (...args: unknown[]) => listModelCatalog(...args),
  setModelsActive: (...args: unknown[]) => setModelsActive(...args),
  syncModelCatalog: (...args: unknown[]) => syncModelCatalog(...args),
  listCredentials: (...args: unknown[]) => listCredentials(...args),
  setModelUses: (...args: unknown[]) => setModelUses(...args),
}));

function model(
  over: Partial<ModelComCuradoria> = {},
): ModelComCuradoria {
  return {
    id: 'm-1',
    provider: 'openai',
    name: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    inputPricePerMillionMicros: 150_000,
    outputPricePerMillionMicros: 600_000,
    contextWindow: 128_000,
    supportsToolCalling: true,
    supportsStreaming: true,
    supportsVision: false,
    supportsReasoning: false,
    generatesImage: false,
    manualPricing: true,
    isActive: false,
    uses: [],
    availability: 'available',
    lastSeenAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

function catalogo(modelos: ModelComCuradoria[]): CatalogoPorCategoria {
  return { local: {}, cloud: { openai: modelos } } as CatalogoPorCategoria;
}

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ModelCatalogSection workspaceId="ws-1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listModelCatalog.mockResolvedValue(catalogo([model()]));
  setModelsActive.mockResolvedValue([]);
  setModelUses.mockResolvedValue([]);
  syncModelCatalog.mockResolvedValue({ porProvider: [] });
  listCredentials.mockResolvedValue([]);
});

function credencial(provider: string) {
  return {
    id: `cred-${provider}`,
    provider,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

describe('ModelCatalogSection', () => {
  it('mostra o modelo descoberto como DESATIVADO — ativar é do owner (RN-043)', async () => {
    montar();

    expect(await screen.findByText('GPT-4o mini')).toBeTruthy();
    expect(screen.getByText('desativado')).toBeTruthy();
  });

  it('ativa em lote o que foi marcado', async () => {
    montar();
    await screen.findByText('GPT-4o mini');

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }));

    await waitFor(() =>
      expect(setModelsActive).toHaveBeenCalledWith('ws-1', {
        modelIds: ['m-1'],
        isActive: true,
      }),
    );
  });

  it('modelo indisponível continua listado, marcado', async () => {
    listModelCatalog.mockResolvedValue(
      catalogo([model({ availability: 'unavailable', isActive: true })]),
    );
    montar();

    expect(await screen.findByText('GPT-4o mini')).toBeTruthy();
    expect(screen.getByText('indisponível no provider')).toBeTruthy();
    // Continua ativo: os dois eixos são independentes.
    expect(screen.getByText('ativo')).toBeTruthy();
  });

  it('o relatório do sync mostra TODO provider, inclusive o pulado, com a origem', async () => {
    syncModelCatalog.mockResolvedValue({
      porProvider: [
        {
          provider: 'openai',
          descobertos: 2,
          reencontrados: 0,
          indisponibilizados: 1,
        },
        {
          provider: 'anthropic',
          descobertos: 0,
          reencontrados: 0,
          indisponibilizados: 0,
          pulado: 'sem_capability',
        },
        {
          provider: 'ollama',
          descobertos: 0,
          reencontrados: 0,
          indisponibilizados: 0,
          pulado: 'falha',
          origemDaFalha: 'infra',
        },
      ],
    });
    montar();
    await screen.findByText('GPT-4o mini');

    fireEvent.click(screen.getByRole('button', { name: 'Atualizar catálogo' }));

    expect(await screen.findByText(/2 novo\(s\)/)).toBeTruthy();
    expect(screen.getByText('sem listagem de catálogo')).toBeTruthy();
    // "Falhou" sem a origem seria diagnóstico por eliminação (ADR 0020).
    expect(screen.getByText('falhou · origem infra')).toBeTruthy();
  });

  it('catálogo vazio explica o que fazer em vez de mostrar nada', async () => {
    listModelCatalog.mockResolvedValue(catalogo([]));
    montar();

    expect(
      await screen.findByText(/Cadastre uma credencial de provider/),
    ).toBeTruthy();
  });
  /**
   * O passo que faltava estar dito na tela. Cadastrar a chave não descobre
   * modelo nenhum — quem descobre é o sync —, e nada ligava as duas coisas: o
   * caso real foi uma chave de OpenRouter válida e testada, com o seletor de
   * modelos oferecendo só os locais.
   */
  describe('aviso de provider com credencial e catálogo vazio', () => {
    it('nomeia o provider e aponta a ação', async () => {
      listCredentials.mockResolvedValue([credencial('openrouter')]);
      montar();

      const aviso = (await screen.findByText(/OpenRouter/)).closest(
        'div[class*="alerta"]',
      );
      expect(aviso).toBeTruthy();
      // O aviso precisa dizer o que fazer, não só que algo falta.
      expect(aviso!.textContent).toContain('Atualizar catálogo');
      expect(aviso!.textContent).toContain('nenhum modelo dele no');
    });

    it('some quando o provider já tem modelo no catálogo', async () => {
      listCredentials.mockResolvedValue([credencial('openai')]);
      montar();

      await screen.findByText('GPT-4o mini');
      expect(screen.queryByText(/nenhum modelo dele no/)).toBeNull();
    });

    it('token de git não gera aviso — não existe modelo de github', async () => {
      listCredentials.mockResolvedValue([credencial('github')]);
      montar();

      await screen.findByText('GPT-4o mini');
      expect(screen.queryByText(/nenhum modelo dele no/)).toBeNull();
    });

    it('sem credencial nenhuma, sem aviso', async () => {
      montar();

      await screen.findByText('GPT-4o mini');
      expect(screen.queryByText(/nenhum modelo dele no/)).toBeNull();
    });
  });
});

/**
 * Com 58 fabricantes no OpenRouter, abrir todos de saída devolve a lista de 338
 * linhas que o agrupamento existe para evitar. Fechados, os cabeçalhos com
 * contagem viram um índice navegável.
 */
describe('subgrupos colapsáveis', () => {
  function catalogoDeHub() {
    return {
      local: {},
      cloud: {
        openrouter: [
          model({ id: 'or-1', provider: 'openrouter', name: 'openai/gpt-4o', displayName: 'GPT-4o' }),
          model({ id: 'or-2', provider: 'openrouter', name: 'openai/gpt-4o-mini', displayName: 'GPT-4o mini' }),
          model({ id: 'or-3', provider: 'openrouter', name: 'anthropic/claude', displayName: 'Claude' }),
        ],
      },
    } as CatalogoPorCategoria;
  }

  it('começam FECHADOS: mostra o fabricante e a contagem, não os modelos', async () => {
    listModelCatalog.mockResolvedValue(catalogoDeHub());
    montar();

    expect(await screen.findByRole('button', { name: /OpenAI/ })).toBeTruthy();
    expect(screen.queryByText('GPT-4o')).toBeNull();
  });

  it('clicar abre e clicar de novo fecha', async () => {
    listModelCatalog.mockResolvedValue(catalogoDeHub());
    montar();

    const cabecalho = await screen.findByRole('button', { name: /OpenAI/ });
    expect(cabecalho.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(cabecalho);
    expect(cabecalho.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('GPT-4o')).toBeTruthy();

    fireEvent.click(cabecalho);
    expect(screen.queryByText('GPT-4o')).toBeNull();
  });

  it('abrir um fabricante não abre os outros', async () => {
    listModelCatalog.mockResolvedValue(catalogoDeHub());
    montar();

    fireEvent.click(await screen.findByRole('button', { name: /OpenAI/ }));

    expect(screen.getByText('GPT-4o')).toBeTruthy();
    expect(screen.queryByText('Claude')).toBeNull();
  });

  /**
   * O risco de esconder: a barra de lote conta o total e você ativaria sem ver
   * o quê. O selo no cabeçalho fechado é o que impede isso.
   */
  it('fechado com item marcado, o cabeçalho avisa', async () => {
    listModelCatalog.mockResolvedValue(catalogoDeHub());
    montar();

    const openai = await screen.findByRole('button', { name: /OpenAI/ });
    fireEvent.click(openai);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(openai);

    expect(screen.getByText(/1 marcado/)).toBeTruthy();
  });
});

describe('colapso de grupo e "minimizar tudo"', () => {
  function catalogoMisto() {
    return {
      local: { ollama: [model({ id: 'l-1', provider: 'ollama', name: 'llama3.2:1b', displayName: 'Llama 3.2 1B' })] },
      cloud: {
        openai: [model({ id: 'd-1', provider: 'openai', name: 'gpt-4o', displayName: 'GPT-4o direto' })],
        openrouter: [model({ id: 'h-1', provider: 'openrouter', name: 'openai/gpt-4o', displayName: 'GPT-4o via hub' })],
      },
    } as CatalogoPorCategoria;
  }

  it('grupos nascem ABERTOS — fechá-los de saída esconderia até o que é pequeno', async () => {
    listModelCatalog.mockResolvedValue(catalogoMisto());
    montar();

    expect(await screen.findByText('Llama 3.2 1B')).toBeTruthy();
    expect(screen.getByText('GPT-4o direto')).toBeTruthy();
  });

  it('fechar "Local" some com os modelos dele e não toca nos outros', async () => {
    listModelCatalog.mockResolvedValue(catalogoMisto());
    montar();
    await screen.findByText('Llama 3.2 1B');

    fireEvent.click(screen.getByRole('button', { name: /^Local/ }));

    expect(screen.queryByText('Llama 3.2 1B')).toBeNull();
    expect(screen.getByText('GPT-4o direto')).toBeTruthy();
  });

  /**
   * "Hubs" sozinho não diz de QUEM é o catálogo — e preço, disponibilidade e
   * credencial pertencem ao hub, não ao fabricante do modelo.
   */
  it('o grupo de hub nomeia o provedor que o serve', async () => {
    listModelCatalog.mockResolvedValue(catalogoMisto());
    montar();

    const hub = await screen.findByRole('button', { name: /Hubs/ });
    expect(hub.textContent).toContain('OpenRouter');
  });

  it('APIs diretas não repetem o provider no cabeçalho — a linha já diz', async () => {
    listModelCatalog.mockResolvedValue(catalogoMisto());
    montar();

    const direto = await screen.findByRole('button', { name: /APIs diretas/ });
    expect(direto.textContent).not.toContain('OpenAI');
  });

  it('minimizar tudo fecha grupos e subgrupos; expandir tudo reabre os dois', async () => {
    listModelCatalog.mockResolvedValue(catalogoMisto());
    montar();
    await screen.findByText('Llama 3.2 1B');

    fireEvent.click(screen.getByRole('button', { name: 'Minimizar tudo' }));
    expect(screen.queryByText('Llama 3.2 1B')).toBeNull();
    expect(screen.queryByText('GPT-4o direto')).toBeNull();

    // O botão oferece a AÇÃO, não o estado: agora ele reabre.
    fireEvent.click(screen.getByRole('button', { name: 'Expandir tudo' }));
    expect(screen.getByText('Llama 3.2 1B')).toBeTruthy();
    // E "expandir tudo" abre também os subgrupos, que nascem fechados.
    expect(screen.getByText('GPT-4o via hub')).toBeTruthy();
  });
});


/**
 * Facetas de capability (ADR 0051).
 *
 * Um catálogo de 338 linhas não se navega por rolagem: a pergunta real é "qual
 * modelo serve para ESTA tarefa". As facetas respondem isso com o que o
 * provider PROVA — e nada além disso.
 */
describe('filtro por faceta', () => {
  const catalogoRico = {
    local: {},
    cloud: {
      openai: [
        model({ id: 'm-ve', name: 've', displayName: 'Vê imagem', supportsVision: true }),
        model({
          id: 'm-pensa',
          name: 'pensa',
          displayName: 'Pensa',
          supportsReasoning: true,
        }),
        model({
          id: 'm-ambos',
          name: 'ambos',
          displayName: 'Vê e pensa',
          supportsVision: true,
          supportsReasoning: true,
        }),
      ],
    },
  } as CatalogoPorCategoria;

  it('nasce sem filtro — o catálogo inteiro é o default', async () => {
    listModelCatalog.mockResolvedValue(catalogoRico);
    montar();

    expect(await screen.findByText('Vê imagem')).toBeTruthy();
    expect(screen.getByText('Pensa')).toBeTruthy();
  });

  it('marcar duas facetas exige AS DUAS, não uma ou outra', async () => {
    listModelCatalog.mockResolvedValue(catalogoRico);
    montar();
    await screen.findByText('Vê imagem');

    fireEvent.click(screen.getByRole('button', { name: 'lê imagem' }));
    fireEvent.click(screen.getByRole('button', { name: 'thinking' }));

    expect(screen.getByText('Vê e pensa')).toBeTruthy();
    expect(screen.queryByText('Vê imagem')).toBeNull();
    expect(screen.queryByText('Pensa')).toBeNull();
  });

  /** Filtro que zera a lista tem de ser distinguível de catálogo vazio. */
  it('quando nada sobra, explica que foi o filtro e como sair', async () => {
    listModelCatalog.mockResolvedValue(catalogoRico);
    montar();
    await screen.findByText('Vê imagem');

    fireEvent.click(screen.getByRole('button', { name: 'gera imagem' }));

    expect(screen.getByText(/desligue um filtro/i)).toBeTruthy();
    expect(screen.queryByText(/Nenhum modelo no catálogo\./)).toBeNull();
  });

  it('o selo só afirma o que é verdade — nunca a ausência', async () => {
    listModelCatalog.mockResolvedValue(
      catalogo([model({ supportsVision: true })]),
    );
    montar();
    await screen.findByText('GPT-4o mini');

    // O selo existe uma vez só na linha; o chip de filtro tem o mesmo texto,
    // então a busca é por papel para não confundir os dois.
    expect(screen.getAllByText('lê imagem').length).toBeGreaterThan(0);
    expect(screen.queryByText(/não lê imagem|não gera imagem/)).toBeNull();
  });
});

/**
 * Curadoria por USO (ADR 0051) — o eixo que o time decide, ao lado do que o
 * provider prova.
 */
describe('curadoria por uso', () => {
  it('o selo mostra o uso que o workspace marcou', async () => {
    listModelCatalog.mockResolvedValue(catalogo([model({ uses: ['codigo'] })]));
    montar();
    await screen.findByText('GPT-4o mini');

    // Duas ocorrências: o chip de filtro e o selo da linha — a lista tem uma só.
    expect(screen.getAllByText('código')).toHaveLength(2);
  });

  it('marcar em lote SUBSTITUI os usos dos modelos selecionados', async () => {
    montar();
    await screen.findByText('GPT-4o mini');

    fireEvent.click(screen.getByRole('checkbox'));
    // O chip da barra de lote, não o do filtro: ambos existem, e o de lote só
    // aparece depois de marcar uma linha.
    const chips = screen.getAllByRole('button', { name: 'análise' });
    fireEvent.click(chips[chips.length - 1]);
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar usos' }));

    await waitFor(() =>
      expect(setModelUses).toHaveBeenCalledWith('ws-1', {
        modelIds: ['m-1'],
        uses: ['analise'],
      }),
    );
  });

  /** Sem uso escolhido, a mesma rota LIMPA — é como se desmarca tudo. */
  it('sem uso escolhido o botão diz que vai limpar, e limpa', async () => {
    listModelCatalog.mockResolvedValue(catalogo([model({ uses: ['codigo'] })]));
    montar();
    await screen.findByText('GPT-4o mini');

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Limpar usos' }));

    await waitFor(() =>
      expect(setModelUses).toHaveBeenCalledWith('ws-1', {
        modelIds: ['m-1'],
        uses: [],
      }),
    );
  });

  it('filtrar por uso esconde quem não foi marcado', async () => {
    listModelCatalog.mockResolvedValue({
      local: {},
      cloud: {
        openai: [
          model({ id: 'm-cod', name: 'cod', displayName: 'O de código', uses: ['codigo'] }),
          model({ id: 'm-nada', name: 'nada', displayName: 'Sem opinião' }),
        ],
      },
    } as CatalogoPorCategoria);
    montar();
    await screen.findByText('O de código');

    fireEvent.click(screen.getByRole('button', { name: 'código' }));

    expect(screen.getByText('O de código')).toBeTruthy();
    expect(screen.queryByText('Sem opinião')).toBeNull();
  });
});

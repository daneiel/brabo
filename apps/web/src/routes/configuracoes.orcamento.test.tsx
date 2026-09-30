import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import type { ReactNode } from 'react';
import i18n from '../lib/i18n';
import { ToastProvider } from '../components/ui/ToastProvider';
import { OPCOES_PADRAO_DAS_QUERIES } from '../lib/query-policy';
import type { ChaveDeAba } from './project-tabs';

/**
 * AT-321 (RN-645) — o orçamento de requisições da aba Configurações.
 *
 * Levantamento visual da Rodada 29 (achado G1): percorrer as seções de
 * Configurações em ~40s estourou os 300 req/min do USUÁRIO (RN-579) e a página
 * inteira do projeto virou "Limite de requisições excedido". O roteiro do
 * levantamento RECARREGAVA a página por seção (`page.goto(...?section=)`), e
 * uma carga custava 55 requisições. Navegar pelo sumário DENTRO da aba não
 * remonta nada e custa zero — o que remonta as 19 seções é trocar de aba e
 * voltar, e é esse o caminho de uso que este arquivo mede, junto com a carga.
 *
 * Mesmo molde de `duas-abas.orcamento.test.tsx` (AT-278, RN-632): as TELAS de
 * verdade — `Shell` e `ProjectPage` na aba — sobre um `fetch` falso que conta
 * por rota, com os defaults de query de `main.tsx`.
 *
 * Números medidos AQUI (`dev` em 8271f9cc45 → esta correção):
 *   carga da aba (2,5s) ..................... 53 → 50 (3 buscas repetidas)
 *   um minuto parado na aba ................. 76 → 68 (dois polls de config)
 *   Configurações → Visão geral → volta ..... 31 → 0 buscas de configuração
 *
 * Integrada a `dev` depois da RN-638 (a moldura lê a fila do PROJETO uma vez
 * só), a carga caiu para 49 e o minuto para 64 — os tetos abaixo são esses.
 *
 * O "55" do levantamento é a mesma carga medida a 5s, com os dois primeiros
 * polls da moldura dentro. Dos 50 de agora, 20 são o binding RESOLVIDO de cada
 * agente e de cada área, uma rota por chave — cortá-los pede rota de LOTE na
 * api, fora deste corte. Dos 68 do minuto, todos são da MOLDURA (Shell e
 * trilho), comuns a toda aba.
 */

const contagem = new Map<string, number>();

vi.mock('@tanstack/react-router', async () => {
  const React = await import('react');
  const Caminho = React.createContext('/');
  return {
    __Caminho: Caminho,
    Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
    Outlet: () => null,
    useNavigate: () => () => {},
    useRouter: () => ({ navigate: () => {} }),
    useRouterState: (o?: { select?: (s: unknown) => unknown }) => {
      const s = { location: { pathname: React.useContext(Caminho), search: {} } };
      return o?.select ? o.select(s) : s;
    },
  };
});

vi.mock('../lib/session-channel', async () => {
  const { marcarCanalDaSessao } = await import('../lib/canal-vivo');
  return {
    connectSessionHeartbeat: (_p: string, sessionId: string) => {
      marcarCanalDaSessao(sessionId, true);
      return () => marcarCanalDaSessao(sessionId, false);
    },
  };
});

const AGORA = '2026-09-30T07:00:00.000Z';
const projeto = {
  id: 'proj-1',
  workspaceId: 'ws-1',
  name: 'proj-1',
  slug: 'proj-1',
  createdBy: 'u1',
  maxConsecutiveBlocked: null,
  storyPromotion: 'manual',
  executionMode: 'container',
  workspacePath: null,
  workspaceVerifiedAt: null,
  mirrorPath: null,
  language: 'pt-BR',
  createdAt: AGORA,
  updatedAt: AGORA,
};
const sessao = {
  id: 'sess-exec',
  projectId: 'proj-1',
  createdBy: 'u1',
  status: 'active',
  kind: 'criativa',
  name: null,
  nextSeq: 1,
  createdAt: AGORA,
  updatedAt: AGORA,
  closedAt: null,
  technical: false,
};

function rotaDe(url: string): string {
  return new URL(url, 'http://x').pathname.replace(/proj-\d+|sess-[a-z]+|ws-1/g, ':id');
}

function corpoDe(rota: string): unknown {
  if (rota === '/projects/:id') return projeto;
  if (rota === '/projects/:id/sessions') return [sessao];
  if (rota.endsWith('/execution/session')) return sessao;
  if (rota === '/projects/:id/actions') return [];
  if (rota.endsWith('/events') || rota.endsWith('/actions')) return { items: [], nextCursor: null };
  if (rota === '/workspaces') return [{ workspace: { id: 'ws-1', name: 'w', slug: 'w' }, role: 'owner' }];
  if (rota === '/workspaces/:id/projects') return [projeto];
  if (rota === '/workspaces/:id/projects-summary' || rota === '/workspaces/:id/projects-status') return [];
  if (rota.endsWith('/projects-base')) return { projectsBase: null, brokerConfigurado: true };
  if (rota.endsWith('/architecture'))
    return { moduleMap: null, adrs: [], pendencies: [], c4Diagram: { status: 'ausente' } };
  return null;
}

/**
 * As rotas que SÓ a aba Configurações lê — nenhuma outra aba nem a moldura as
 * buscam. É por elas que a volta à aba se mede.
 */
const ROTAS_DE_CONFIGURACAO = [
  /agent-bindings\//,
  /area-bindings\//,
  /\/model-binding$/,
  /\/models$/,
  /\/models\/catalog$/,
  /\/agent-areas$/,
  /\/members$/,
  /\/personal-access-tokens/,
  /\/proficiency$/,
  /\/instruction-versions$/,
  /\/users\/me\/credentials$/,
  /\/projects-base$/,
];
const ehDeConfiguracao = (chave: string) => ROTAS_DE_CONFIGURACAO.some((r) => r.test(chave));

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  contagem.clear();
  focusManager.setFocused(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const rota = rotaDe(url);
      const chave = `${init?.method ?? 'GET'} ${rota}`;
      contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
      const corpo = corpoDe(rota);
      return new Response(corpo === null ? '' : JSON.stringify(corpo), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const total = (porRota: Record<string, number>) =>
  Object.values(porRota).reduce((a, b) => a + b, 0);
const deConfiguracao = (porRota: Record<string, number>) =>
  total(Object.fromEntries(Object.entries(porRota).filter(([k]) => ehDeConfiguracao(k))));

/** Uma aba do navegador na aba Configurações; devolve como trocar de aba. */
async function abrirConfiguracoes() {
  const { Shell } = await import('./Shell');
  const { ProjectPage } = await import('./ProjectPage');
  const { __Caminho: Caminho } = (await import('@tanstack/react-router')) as unknown as {
    __Caminho: React.Context<string>;
  };
  const client = new QueryClient({ defaultOptions: { queries: OPCOES_PADRAO_DAS_QUERIES } });
  const arvore = (aba: ChaveDeAba) => (
    <Caminho.Provider value="/projects/proj-1">
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <ToastProvider>
            <Shell />
            <ProjectPage projectId="proj-1" initialTab={aba} />
          </ToastProvider>
        </QueryClientProvider>
      </I18nextProvider>
    </Caminho.Provider>
  );
  const { rerender } = render(arvore('settings'));
  return {
    client,
    irPara: async (aba: ChaveDeAba) => {
      rerender(arvore(aba));
      await avancar(2_000);
    },
  };
}

async function carga() {
  const aberta = await abrirConfiguracoes();
  // Carrega (a moldura só monta a aba depois do projeto) e estabiliza. Menos
  // de 3s: o primeiro poll da moldura (eventos a 3s) não entra na conta.
  await avancar(2_500);
  return { ...aberta, porRota: Object.fromEntries(contagem) };
}

describe('orçamento de requisições da aba Configurações (AT-321, RN-645)', () => {
  it('a carga busca cada recurso UMA vez — as seções não repetem o que a moldura já trouxe', async () => {
    const { porRota } = await carga();

    // `dev`: 2 de cada — a moldura buscava e cada seção, montando depois do
    // projeto, buscava de novo (`staleTime: 0`).
    expect(porRota['GET /projects/:id']).toBe(1);
    expect(porRota['GET /projects/:id/git/repository']).toBe(1);
    expect(porRota['GET /workspaces']).toBe(1);
    for (const [rota, n] of Object.entries(porRota)) expect([rota, n]).toEqual([rota, 1]);
    // `dev`: 53.
    expect(total(porRota)).toBeLessThanOrEqual(49);
  }, 60_000);

  it('um minuto parado na aba: nenhum poll de configuração', async () => {
    await carga();
    contagem.clear();
    await avancar(60_000);
    const minuto = Object.fromEntries(contagem);

    // `dev`: 4 + 4 — as duas pollavam a 15s.
    expect(minuto['GET /projects/:id/proficiency'] ?? 0).toBe(0);
    expect(minuto['GET /projects/:id/instruction-versions'] ?? 0).toBe(0);
    expect(deConfiguracao(minuto)).toBe(0);
    // `dev`: 76. O que sobra é da moldura, igual em toda aba.
    expect(total(minuto)).toBeLessThanOrEqual(64);
  }, 90_000);

  it('trocar de aba e voltar dentro do minuto não refaz as buscas de configuração', async () => {
    const { irPara } = await carga();
    // A Visão geral busca o que é DELA (inclusive o binding de três agentes,
    // com o frescor de sempre); o que se mede é só a VOLTA.
    await irPara('overview');
    contagem.clear();
    await irPara('settings');

    // `dev`: 31 — as 19 seções remontavam e refaziam a carga delas.
    expect(Object.fromEntries([...contagem].filter(([k]) => ehDeConfiguracao(k)))).toEqual({});
  }, 60_000);

  it('CASO DE FALHA: salvar invalida e busca NA HORA, e depois do minuto a volta busca de novo', async () => {
    const { client, irPara } = await carga();
    contagem.clear();

    // O frescor não esconde a própria escrita: toda mutação da aba invalida a
    // chave, e invalidar ignora `staleTime`.
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['members', 'proj-1'] });
    });
    expect(contagem.get('GET /projects/:id/members')).toBe(1);

    // E o frescor tem prazo: passado o minuto, voltar à aba busca de novo o
    // que a outra pessoa possa ter mudado.
    await irPara('overview');
    await avancar(61_000);
    contagem.clear();
    await irPara('settings');
    const volta = Object.fromEntries(contagem);
    expect(volta['GET /projects/:id/members']).toBeGreaterThanOrEqual(1);
    expect(volta['GET /users/me/credentials']).toBe(1);
  }, 120_000);
});

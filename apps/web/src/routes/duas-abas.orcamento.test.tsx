import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import type { ReactNode } from 'react';
import i18n from '../lib/i18n';
import { ToastProvider } from '../components/ui/ToastProvider';
import { OPCOES_PADRAO_DAS_QUERIES } from '../lib/query-policy';
import type { SessionChannelHandlers } from '../lib/session-channel';

/**
 * AT-278 (RN-632) — o orçamento de requisições com DUAS abas.
 *
 * Uso real de 29/09: 192 × 429 às 07:14 (106 deles em `GET
 * /projects/:id/sessions`, 20 em `GET /projects/:id`) com duas abas abertas —
 * o chat da sessão e a aba Executores. O teto de 300/min é do USUÁRIO (RN-579),
 * então as duas abas somam.
 *
 * Diferente de `canal-vivo.orcamento.test.tsx`, que monta os HOOKS da tela de
 * Sessão, este monta as TELAS DE VERDADE — `Shell`, `SessionPage`,
 * `ProjectPage` com a aba Executores, `ContainersPage` — sobre um `fetch`
 * falso que conta por rota. Foi assim que a medição achou o que o outro não
 * alcança: a aba Executores invalidava os eventos a CADA aviso do canal, sem
 * janela, e a moldura do projeto pollava cinco contadores de trilho e a lista
 * de sessões a 3–5s.
 *
 * Cada aba é medida SOZINHA e as duas são somadas: num navegador, duas abas
 * são dois contextos JS, cada um com o seu `canal-vivo` e o seu `QueryClient`
 * — montar as duas na mesma árvore faria o canal de uma servir a outra, o que
 * nunca acontece.
 *
 * Números medidos AQUI (req/min, `dev` em 378fc39 → esta correção):
 *   chat + Executores, canal vivo ........ 70 + 138 = 208 → 70 + 72 = 142
 *   idem, dev agent em rajada (10/s) ..... 70 + 764 = 834 → 70 + 97 = 167
 *   idem, canal que nunca conecta ........ 155 + 186 = 341 → 155 + 120 = 275
 *   /containers com 9 projetos ........... 132 (108 de /sessions) → 24
 *
 * O último é o que casa com o número do incidente: 9 linhas × 12/min = 108
 * `GET /projects/:id/sessions`, contra os 106 do log.
 */

const contagem = new Map<string, number>();
const canais: SessionChannelHandlers[] = [];
let canalConecta = true;

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

// O canal: join confirmado na hora (ou nunca, com `canalConecta = false`), e
// os handlers guardados para o teste disparar avisos.
vi.mock('../lib/session-channel', async () => {
  const { marcarCanalDaSessao } = await import('../lib/canal-vivo');
  return {
    connectSessionHeartbeat: (_p: string, sessionId: string, h: SessionChannelHandlers = {}) => {
      canais.push(h);
      if (canalConecta) marcarCanalDaSessao(sessionId, true);
      return () => marcarCanalDaSessao(sessionId, false);
    },
  };
});

const AGORA = '2026-09-29T07:00:00.000Z';
const projeto = (id: string) => ({
  id,
  workspaceId: 'ws-1',
  name: id,
  slug: id,
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
});
const sessao = (id: string, createdAt = AGORA) => ({
  id,
  projectId: 'proj-1',
  createdBy: 'u1',
  status: 'active',
  kind: 'criativa',
  name: null,
  nextSeq: 1,
  createdAt,
  updatedAt: createdAt,
  closedAt: null,
  technical: false,
});
const PROJETOS = Array.from({ length: 9 }, (_, i) => `proj-${i + 1}`);

function rotaDe(url: string): string {
  return new URL(url, 'http://x').pathname
    .replace(/proj-\d+|sess-[a-z]+|ws-1/g, ':id');
}

/** O mínimo que cada tela precisa para renderizar; o resto é corpo vazio. */
function corpoDe(rota: string): unknown {
  if (rota === '/projects/:id') return projeto('proj-1');
  // A de chat é a mais recente: é ela que a moldura do projeto acompanha.
  if (rota === '/projects/:id/sessions')
    return [sessao('sess-exec'), sessao('sess-chat', '2026-09-29T08:00:00.000Z')];
  if (/^\/projects\/:id\/sessions\/:id$/.test(rota)) return sessao('sess-chat');
  if (rota.endsWith('/execution/session')) return sessao('sess-exec');
  if (rota === '/projects/:id/actions') return [];
  if (rota.endsWith('/events') || rota.endsWith('/actions')) return { items: [], nextCursor: null };
  if (rota === '/workspaces') return [{ workspace: { id: 'ws-1', name: 'w', slug: 'w' }, role: 'owner' }];
  if (rota === '/workspaces/:id/projects') return [projeto('proj-1')];
  if (rota === '/workspaces/:id/projects-summary' || rota === '/workspaces/:id/projects-status') return [];
  if (rota === '/workspaces/:id/containers')
    return PROJETOS.map((id) => ({
      projectId: id,
      projectName: id,
      projectSlug: id,
      executionMode: 'container',
      registrado: null,
      temImagemDecidida: true,
      workspaceVerifiedAt: null,
      observado: null,
      naoObservado: null,
      detalheDaObservacao: null,
      naoVerificado: 'sem_container_registrado',
      acaoPendente: null,
      brokerConfigurado: true,
    }));
  if (rota.endsWith('/architecture'))
    return { moduleMap: null, adrs: [], pendencies: [], c4Diagram: { status: 'ausente' } };
  return null;
}

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  contagem.clear();
  canais.length = 0;
  canalConecta = true;
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

type Aba = 'chat' | 'executores' | 'containers';

/** Uma aba do navegador: o `Shell` e a tela da rota, com os defaults de `main.tsx`. */
async function abrir(aba: Aba) {
  const { Shell } = await import('./Shell');
  const { SessionPage } = await import('./SessionPage');
  const { ProjectPage } = await import('./ProjectPage');
  const { ContainersPage } = await import('./ContainersPage');
  // O painel da aba é chunk sob demanda (AT-300, `React.lazy` em
  // `project-tabs.ts`), e o `import()` dele é I/O de verdade que os relógios
  // falsos não esperam: sob carga ele chegava NO MEIO do minuto medido, e a aba
  // montando ali somava buscas que não são do regime. Pré-carregado, o `lazy`
  // resolve na carga, pelo mesmo caminho de produção.
  await import('./ProjectExecutorsTab');
  const { __Caminho: Caminho } = (await import('@tanstack/react-router')) as unknown as {
    __Caminho: React.Context<string>;
  };
  const caminho =
    aba === 'chat'
      ? '/projects/proj-1/sessions/sess-chat'
      : aba === 'executores'
        ? '/projects/proj-1'
        : '/containers';
  const tela =
    aba === 'chat' ? (
      <SessionPage projectId="proj-1" sessionId="sess-chat" />
    ) : aba === 'executores' ? (
      <ProjectPage projectId="proj-1" initialTab="executores" />
    ) : (
      <ContainersPage />
    );
  const client = new QueryClient({ defaultOptions: { queries: OPCOES_PADRAO_DAS_QUERIES } });
  render(
    <Caminho.Provider value={caminho}>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <ToastProvider>
            <Shell />
            {tela}
          </ToastProvider>
        </QueryClientProvider>
      </I18nextProvider>
    </Caminho.Provider>,
  );
  // Carrega (a moldura só monta a aba depois do projeto) e estabiliza.
  await avancar(5_000);
  // A tela MONTOU — nada ficou preso no `Suspense` para chegar durante o minuto.
  expect(document.body.textContent).not.toContain('Carregando a página');
}

/** Req/min por rota da aba aberta, com `durante` rodando a cada 100 ms. */
async function umMinuto(durante?: (decimo: number) => void): Promise<Record<string, number>> {
  contagem.clear();
  for (let decimo = 0; decimo < 600; decimo += 1) {
    durante?.(decimo);
    await avancar(100);
  }
  return Object.fromEntries(contagem);
}

const total = (porRota: Record<string, number>) =>
  Object.values(porRota).reduce((a, b) => a + b, 0);

/** Uma aba sozinha num minuto — e desmonta, como fechar a aba. */
async function medir(aba: Aba, durante?: (decimo: number) => void) {
  await abrir(aba);
  const porRota = await umMinuto(durante);
  cleanup();
  return porRota;
}

/** Dev agent trabalhando: 10 avisos/s, uma proposta a cada 5s. */
function rajada(decimo: number) {
  for (const canal of canais) {
    canal.onEvent?.({
      type: decimo % 50 === 0 ? 'proposed_action.created' : 'tool.result',
      actorId: 'dev-api',
    });
    if (decimo % 20 === 0) canal.onAgentStatus?.({ status: 'working' });
  }
}

describe('orçamento de requisições com DUAS abas (AT-278, RN-632)', () => {
  it('chat + Executores com o canal vivo: bem abaixo do teto, e a lista de sessões no ritmo de projeto', async () => {
    const chat = await medir('chat');
    const executores = await medir('executores');

    // `dev`: 208. A aba de Executores caiu de 138 para 72.
    expect(total(chat) + total(executores)).toBeLessThanOrEqual(150);
    // `dev`: 12/min (5s). Ritmo de projeto: 15s.
    expect(executores['GET /projects/:id/sessions']).toBe(4);
    // `GET /projects/:id` só na montagem: nenhuma das duas o polla.
    expect(chat['GET /projects/:id'] ?? 0).toBe(0);
    expect(executores['GET /projects/:id'] ?? 0).toBe(0);
    // Os cinco contadores do trilho, no ritmo de projeto.
    expect(executores['GET /projects/:id/actions']).toBe(4);
    expect(executores['GET /projects/:id/architecture']).toBe(4);
    expect(executores['GET /projects/:id/backlog']).toBe(4);
    expect(executores['GET /projects/:id/hypotheses']).toBe(4);
  }, 60_000);

  it('dev agent em rajada na aba Executores: uma busca por JANELA, não uma por aviso', async () => {
    const chat = await medir('chat');
    const executores = await medir('executores', rajada);

    // `dev`: 630 GET de eventos só nesta aba (um por aviso), 834 nas duas.
    // Janela de 3s: ≤ 20 por invalidação + o fallback.
    expect(executores['GET /projects/:id/sessions/:id/events']).toBeLessThanOrEqual(24);
    // A proposta do dev agent agora invalida as pendentes NA HORA (antes só
    // o fallback de 15s as trazia: 4/min). Desde a AT-297 (RN-638) a aba lê a
    // fila do PROJETO — a mesma chave do contador do trilho —, e é ela que o
    // aviso de `proposed_action.*` invalida (AT-299); as ações da sessão a
    // aba não lê mais.
    expect(executores['GET /projects/:id/actions']).toBeGreaterThanOrEqual(12);
    expect(executores['GET /projects/:id/sessions/:id/actions'] ?? 0).toBe(0);
    expect(total(chat) + total(executores)).toBeLessThan(200);
  }, 60_000);

  it('CASO DE FALHA: canal que nunca conecta — o poll curto volta, e as duas abas ainda cabem no teto', async () => {
    canalConecta = false;
    const chat = await medir('chat');
    const executores = await medir('executores');

    // Sem canal a sessão volta aos 3s de sempre (RN-579: nunca pior que era).
    expect(executores['GET /projects/:id/sessions/:id/events']).toBe(20);
    // `dev`: 341 — o teto estourava só com as duas abas paradas na tela.
    expect(total(chat) + total(executores)).toBeLessThan(300);
  }, 60_000);

  it('/containers não polla a lista de sessões de cada projeto (9 projetos: 108/min → 0)', async () => {
    const containers = await medir('containers');
    expect(containers['GET /projects/:id/sessions'] ?? 0).toBe(0);
  }, 60_000);
});

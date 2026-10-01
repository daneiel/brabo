import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Handoff, Session } from '../lib/api-types';
import { historicoFalso } from '../test/historico-de-eventos';
// Instância REAL do app: as asserções abaixo esperam texto em pt-BR, e `en` é
// o idioma DEFAULT.
import i18n from '../lib/i18n';

/**
 * RN-631 (AT-251) — o destinatário da mensagem do chat é EXPLÍCITO, VISÍVEL e
 * escolhido pela pessoa.
 *
 * Antes (achado 9-fix) ele era "o `agent.activated` mais recente na janela de
 * 200 eventos" — um destinatário padrão do lado da tela, e invisível. Medido
 * no uso real de 29/09: a Infra aceita, depois o Arquiteto, e o "oi" da pessoa
 * foi respondido pelo Arquiteto sem nada na tela dizer que ia para ele.
 *
 * Este arquivo nasceu como `SessionPage.agente-mais-recente.test.tsx`, que
 * fixava a regra antiga; o "caso de falha" dele (a cadeia fixa que mandava ao
 * Arquiteto) continua coberto: nenhuma regra de ordem escolhe por ninguém.
 */

const sendAgentMessage = vi.fn();
const requestManualHandoff = vi.fn();
const streamChatMessage = vi.fn();
const acceptHandoff = vi.fn();
const getSession = vi.fn();
const getProjectsSummary = vi.fn();
const getSessionTokenUsage = vi.fn();
const workspaceMock = vi.fn<() => unknown>(() => undefined);

const eventos = vi.fn<() => { items: unknown[] }>(() => ({ items: [] }));
const handoffsMock = vi.fn<() => Handoff[]>(() => []);

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../lib/hooks', () => ({
  useSessionEvents: () => ({ data: eventos() }),
  useSessionEventHistory: () => historicoFalso(eventos().items),
  useSessionEvent: () => ({ data: undefined, isError: false }),
  usePendingActions: () => ({ data: { items: [] } }),
  useHandoffs: () => ({ data: handoffsMock() }),
  useCurrentWorkspaceWithRole: () => ({ data: workspaceMock() }),
  useBacklog: () => ({ data: [] }),
}));

vi.mock('../lib/chat-stream', () => ({
  streamChatMessage: (...args: unknown[]) => streamChatMessage(...args),
}));
vi.mock('../lib/session-channel', () => ({
  connectSessionHeartbeat: () => () => {},
}));
vi.mock('../lib/auth', () => ({
  emailDaSessao: () => 'eu@brabo.dev',
  userIdDaSessao: () => 'eu',
}));

vi.mock('../lib/api-client', () => ({
  getProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'core' }),
  getSession: (...args: unknown[]) => getSession(...args),
  getProjectsSummary: (...args: unknown[]) => getProjectsSummary(...args),
  getSessionTokenUsage: (...args: unknown[]) => getSessionTokenUsage(...args),
  getSessionBudget: vi.fn().mockResolvedValue(null),
  getSessionModelBinding: vi.fn().mockResolvedValue(null),
  listModels: vi.fn().mockResolvedValue(null),
  renameSession: vi.fn(),
  acceptHandoff: (...args: unknown[]) => acceptHandoff(...args),
  approveAction: vi.fn(),
  approveAlwaysAction: vi.fn(),
  confirmReadiness: vi.fn(),
  denyAction: vi.fn(),
  sendAgentMessage: (...args: unknown[]) => sendAgentMessage(...args),
  requestManualHandoff: (...args: unknown[]) => requestManualHandoff(...args),
  setSessionModelBinding: vi.fn(),
  startAgent: vi.fn(),
  transitionSession: vi.fn(),
}));

const { SessionPage } = await import('./SessionPage');
const { ToastProvider } = await import('../components/ui/ToastProvider');

const ID = 'a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7';

function sessao(over: Partial<Session> = {}): Session {
  return {
    id: ID,
    projectId: 'proj-1',
    createdBy: 'user-1',
    status: 'active',
    kind: 'consultiva',
    name: null,
    nextSeq: 1,
    createdAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
    closedAt: null,
    ...over,
  } as Session;
}

function ativou(agent: string, seq: number) {
  return {
    id: `evt-${seq}`,
    seq,
    type: 'agent.activated',
    actor: { kind: 'agent', id: agent },
    payload: { agent },
    createdAt: '2026-08-10T12:00:00.000Z',
  };
}

function handoff(over: Partial<Handoff>): Handoff {
  return {
    id: 'h-1',
    sessionId: ID,
    projectId: 'proj-1',
    fromAgent: 'criativo',
    toAgent: 'po',
    artifactId: null,
    status: 'offered',
    createdAt: '2026-08-10T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
    ...over,
  };
}

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SessionPage projectId="proj-1" sessionId={ID} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function escrever(texto: string) {
  const campo = await screen.findByPlaceholderText(
    'Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)',
  );
  fireEvent.change(campo, { target: { value: texto } });
  return campo;
}

async function mandarMensagem(texto: string) {
  const campo = await escrever(texto);
  fireEvent.keyDown(campo, { key: 'Enter' });
}

async function seletor() {
  return (await screen.findByLabelText('Para')) as HTMLSelectElement;
}

beforeEach(async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  await i18n.changeLanguage('pt-BR');
  getSession.mockResolvedValue(sessao());
  sendAgentMessage.mockResolvedValue({ ok: true });
  acceptHandoff.mockResolvedValue({ ok: true });
  requestManualHandoff.mockResolvedValue({ id: 'h-novo' });
  handoffsMock.mockReturnValue([]);
  eventos.mockReturnValue({ items: [] });
  workspaceMock.mockReturnValue(undefined);
  getProjectsSummary.mockResolvedValue([]);
  getSessionTokenUsage.mockResolvedValue([]);
});

/** O resumo do projeto (RN-630): `activatedAgents` da sessão INTEIRA. */
function comResumo(latestSessionId: string, activatedAgents: string[]) {
  workspaceMock.mockReturnValue({ workspace: { id: 'ws-1' }, role: 'owner' });
  getProjectsSummary.mockResolvedValue([
    { projectId: 'proj-1', latestSessionId, roster: { activatedAgents } },
  ]);
}

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('SessionPage — o destinatário do chat é escolhido e visível (RN-631)', () => {
  it('caminho feliz: Infra e Arquiteto na sessão, a pessoa escolhe a Infra e a mensagem vai para ela', async () => {
    // O caso de 29/09: os dois entraram; o Arquiteto por último.
    eventos.mockReturnValue({ items: [ativou('infra', 1), ativou('arquiteto', 2)] });

    montar();
    const select = await seletor();
    expect([...select.options].map((o) => o.value)).toEqual(['', 'arquiteto', 'infra']);

    fireEvent.change(select, { target: { value: 'infra' } });
    await mandarMensagem('oi');

    await waitFor(() => expect(sendAgentMessage).toHaveBeenCalled());
    expect(sendAgentMessage).toHaveBeenCalledWith('proj-1', ID, 'infra', 'oi');
  });

  it('CASO DE FALHA: dois agentes e nenhuma escolha — nada é enviado, e a tela diz por quê', async () => {
    // A regra antiga ("o ativado mais recente vence") mandaria ao Arquiteto.
    eventos.mockReturnValue({ items: [ativou('infra', 1), ativou('arquiteto', 2)] });

    montar();
    expect((await seletor()).value).toBe('');
    expect(
      screen.getByText('Há mais de um agente nesta sessão: escolha a quem vai a mensagem.'),
    ).toBeInTheDocument();

    await escrever('oi');
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    await mandarMensagem('oi');

    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it('com UM agente só, ele é o destinatário — e o composer o nomeia antes do envio', async () => {
    eventos.mockReturnValue({ items: [ativou('po', 1)] });

    montar();
    const select = await seletor();
    expect(select.value).toBe('po');
    expect(select.selectedOptions[0]?.textContent).toBe('PO');

    await mandarMensagem('e agora?');
    await waitFor(() =>
      expect(sendAgentMessage).toHaveBeenCalledWith('proj-1', ID, 'po', 'e agora?'),
    );
  });

  it('agente cuja ativação saiu da janela continua opção pelo handoff ACEITO (RN-180)', async () => {
    // A janela só tem o Criativo; o aceite ao Arquiteto está na lista de
    // handoffs, que não tem janela. Quem OFERECEU (o PO) também estava na
    // sessão, e entra pelo mesmo handoff desde a revisão do PR #759.
    eventos.mockReturnValue({ items: [ativou('criativo', 250)] });
    handoffsMock.mockReturnValue([
      handoff({ id: 'h-arq', fromAgent: 'po', toAgent: 'arquiteto', status: 'accepted' }),
    ]);

    montar();
    const select = await seletor();
    expect([...select.options].map((o) => o.value)).toEqual([
      '',
      'criativo',
      'po',
      'arquiteto',
    ]);
  });

  it('ativar a execução criou OUTRA sessão mais recente: a ativação fora da janela segue lida pelos handoffs e pelo gasto DESTA sessão', async () => {
    // O defeito da revisão do PR #759: o resumo só vale para a sessão mais
    // recente, e a de execução passa a ser ela. O Staff entrou por `start`
    // direto (sem handoff), e só o gasto desta sessão o prova.
    eventos.mockReturnValue({ items: [ativou('criativo', 250)] });
    comResumo('sessao-de-execucao', ['dev-lead']);
    handoffsMock.mockReturnValue([
      handoff({ id: 'h-arq', fromAgent: 'criativo', toAgent: 'arquiteto', status: 'accepted' }),
    ]);
    getSessionTokenUsage.mockResolvedValue([
      { actorId: 'staff', costMicros: 10, inputTokens: 5, outputTokens: 5 },
    ]);

    montar();
    await waitFor(() => expect(getSessionTokenUsage).toHaveBeenCalledWith('proj-1', ID));
    await waitFor(async () =>
      expect([...(await seletor()).options].map((o) => o.value)).toEqual([
        '',
        'criativo',
        'arquiteto',
        'staff',
      ]),
    );
  });

  it('CASO DE FALHA: sem permissão para o gasto (403), a fonte some sem derrubar a tela nem inventar opção', async () => {
    eventos.mockReturnValue({ items: [ativou('criativo', 250)] });
    comResumo('sessao-de-execucao', ['dev-lead']);
    getSessionTokenUsage.mockRejectedValue(new Error('403'));

    montar();
    await waitFor(() => expect(getSessionTokenUsage).toHaveBeenCalled());
    expect([...(await seletor()).options].map((o) => o.value)).toEqual(['criativo']);
  });

  it('agente ativado fora da janela entra pelo resumo da MESMA sessão (RN-630)', async () => {
    eventos.mockReturnValue({ items: [ativou('criativo', 250)] });
    comResumo(ID, ['arquiteto', 'criativo']);

    montar();
    await waitFor(async () =>
      expect([...(await seletor()).options].map((o) => o.value)).toEqual([
        '',
        'criativo',
        'arquiteto',
      ]),
    );
  });

  it('CASO DE FALHA: resumo de OUTRA sessão não acrescenta opção', async () => {
    eventos.mockReturnValue({ items: [ativou('criativo', 1)] });
    comResumo('outra-sessao', ['arquiteto']);

    montar();
    await waitFor(() => expect(getProjectsSummary).toHaveBeenCalled());
    expect([...(await seletor()).options].map((o) => o.value)).toEqual(['criativo']);
  });

  it('oferta a agente já ativado fora da janela não volta a ser aceitável (RN-630)', async () => {
    eventos.mockReturnValue({
      items: [
        ativou('criativo', 250),
        {
          id: 'evt-251',
          seq: 251,
          type: 'handoff.offered',
          actor: { kind: 'agent', id: 'po' },
          payload: { handoffId: 'h-arq', toAgent: 'arquiteto' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });
    handoffsMock.mockReturnValue([
      handoff({ id: 'h-arq', fromAgent: 'po', toAgent: 'arquiteto' }),
    ]);
    comResumo(ID, ['arquiteto', 'criativo']);

    montar();
    await waitFor(() => expect(getProjectsSummary).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /Aceitar handoff e iniciar/ }),
      ).not.toBeInTheDocument(),
    );
  });

  it('oferta cujo evento saiu da janela ganha botão na faixa fixa acima do composer', async () => {
    // A janela começa às 13h; a oferta ao PO é das 12h, e o evento dela
    // ficou para trás dos 200.
    eventos.mockReturnValue({
      items: [{ ...ativou('criativo', 250), createdAt: '2026-08-10T13:00:00.000Z' }],
    });
    handoffsMock.mockReturnValue([
      handoff({ id: 'h-po', fromAgent: 'criativo', toAgent: 'po' }),
    ]);

    const { container } = montar();
    const botao = await screen.findByRole('button', { name: 'Aceitar handoff e iniciar PO' });
    expect(container.querySelector('[data-oferta-fora-da-janela="h-po"]')).not.toBeNull();
    fireEvent.click(botao);
    await waitFor(() => expect(acceptHandoff).toHaveBeenCalledWith('proj-1', ID, 'h-po'));
  });

  it('CASO DE FALHA: oferta com o evento NA janela, ou mais nova que ela, não vai para a faixa', async () => {
    eventos.mockReturnValue({
      items: [
        { ...ativou('criativo', 1), createdAt: '2026-08-10T13:00:00.000Z' },
        {
          id: 'evt-2',
          seq: 2,
          type: 'handoff.offered',
          actor: { kind: 'agent', id: 'criativo' },
          payload: { handoffId: 'h-po', toAgent: 'po' },
          createdAt: '2026-08-10T13:00:00.000Z',
        },
      ],
    });
    handoffsMock.mockReturnValue([
      handoff({ id: 'h-po', fromAgent: 'criativo', toAgent: 'po', createdAt: '2026-08-10T13:00:00.000Z' }),
      // Recém-criada, o evento ainda não chegou: não é corte, é atraso.
      handoff({ id: 'h-ux', fromAgent: 'criativo', toAgent: 'ux-designer', createdAt: '2026-08-10T14:00:00.000Z' }),
    ]);

    const { container } = montar();
    // O botão do PO existe UMA vez, no card do fio.
    expect(
      await screen.findAllByRole('button', { name: 'Aceitar handoff e iniciar PO' }),
    ).toHaveLength(1);
    expect(container.querySelector('[data-oferta-fora-da-janela]')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Aceitar handoff e iniciar UX Designer' }),
    ).not.toBeInTheDocument();
  });

  it('aceitar um handoff nesta tela faz do agente que entrou o destinatário', async () => {
    const oferta = handoff({ id: 'h-po', fromAgent: 'criativo', toAgent: 'po' });
    eventos.mockReturnValue({
      items: [
        ativou('criativo', 1),
        {
          id: 'evt-2',
          seq: 2,
          type: 'handoff.offered',
          actor: { kind: 'agent', id: 'criativo' },
          payload: { handoffId: 'h-po', toAgent: 'po' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });
    handoffsMock.mockReturnValue([oferta]);
    acceptHandoff.mockImplementation(async () => {
      eventos.mockReturnValue({ items: [ativou('criativo', 1), ativou('po', 3)] });
      handoffsMock.mockReturnValue([{ ...oferta, status: 'accepted' }]);
      return { ok: true };
    });

    montar();
    fireEvent.click(await screen.findByRole('button', { name: /Aceitar handoff e iniciar/ }));
    await waitFor(() => expect(acceptHandoff).toHaveBeenCalledWith('proj-1', ID, 'h-po'));

    await waitFor(async () => expect((await seletor()).value).toBe('po'));
  });

  it('um aceite que FALHA não troca o destinatário', async () => {
    const oferta = handoff({ id: 'h-po', fromAgent: 'criativo', toAgent: 'po' });
    eventos.mockReturnValue({
      items: [
        ativou('criativo', 1),
        ativou('arquiteto', 2),
        {
          id: 'evt-3',
          seq: 3,
          type: 'handoff.offered',
          actor: { kind: 'agent', id: 'criativo' },
          payload: { handoffId: 'h-po', toAgent: 'po' },
          createdAt: '2026-08-10T12:00:00.000Z',
        },
      ],
    });
    handoffsMock.mockReturnValue([oferta]);
    acceptHandoff.mockRejectedValue(new Error('boom'));

    montar();
    fireEvent.change(await seletor(), { target: { value: 'arquiteto' } });
    fireEvent.click(await screen.findByRole('button', { name: /Aceitar handoff e iniciar/ }));
    await waitFor(() => expect(acceptHandoff).toHaveBeenCalled());

    expect((await seletor()).value).toBe('arquiteto');
  });

  it('a escolha é lembrada por sessão ao reabrir a tela', async () => {
    eventos.mockReturnValue({ items: [ativou('infra', 1), ativou('arquiteto', 2)] });

    const primeira = montar();
    fireEvent.change(await seletor(), { target: { value: 'infra' } });
    primeira.unmount();

    montar();
    expect((await seletor()).value).toBe('infra');
  });

  it('RN-682 — CASO DE FALHA: consultiva sem agente não envia, nem ao agente nem ao modelo cru', async () => {
    montar();
    expect(
      await screen.findByText(/Esta sessão ainda não tem agente: escolha um e clique em Chamar/),
    ).toBeInTheDocument();

    await mandarMensagem('oi');
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    await new Promise((r) => setTimeout(r, 20));
    expect(streamChatMessage).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();
  });

  it('RN-682 — caminho feliz: a linha do destinatário lista quem pode ser chamado, e Chamar é o handoff manual', async () => {
    montar();
    const lista = await seletor();
    const opcoes = [...lista.options].map((o) => o.value).filter(Boolean);
    // Os que conversam, sem o Criativo — a consultiva não abre a ideação.
    expect(opcoes).toEqual(['po', 'arquiteto', 'dev-lead', 'ux-designer', 'staff', 'infra']);
    // O seletor do handoff manual de cima não aparece duplicado.
    expect(screen.queryByLabelText('Endereçar handoff a outro agente')).not.toBeInTheDocument();

    fireEvent.change(lista, { target: { value: 'staff' } });
    fireEvent.click(screen.getByRole('button', { name: 'Chamar' }));
    await waitFor(() =>
      expect(requestManualHandoff).toHaveBeenCalledWith('proj-1', ID, 'staff'),
    );
  });
});

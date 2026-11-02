import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { KeyboardEvent, ReactNode } from 'react';
import i18n from '../lib/i18n';
import { AGENTS } from '../lib/agents';
import type { SessionEvent } from '../lib/api-types';
import { AvatarDoAgente } from '../components/ui/AvatarDoAgente';
import { TurnActivityStrip } from '../components/TurnActivityStrip';
import { criarStoreDoStreaming } from '../lib/streaming-do-turno';
import {
  limparMensagemNaoEnviada,
  marcarMensagemNaoEnviada,
} from '../lib/mensagem-nao-enviada';
import { SessionFio, type SessionFioProps } from './SessionFio';
import { ignorarComposicaoIme } from './SessionComposer';
import { montarTimeline, type ContextoDaTimeline } from './session-timeline-montagem';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

/** AT-503: avatar consistente (RN-829), acessibilidade do fio (RN-830) e a
 * mensagem não enviada (RN-831). */

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});
afterAll(() => {
  void i18n.changeLanguage('en');
});
afterEach(() => {
  limparMensagemNaoEnviada();
});

function propsDoFio(extra: Partial<SessionFioProps> = {}): SessionFioProps {
  return {
    conviteVisivel: false,
    sessaoCriativa: false,
    criativoActive: true,
    isActive: true,
    handleStartIdeation: async () => {},
    setDraft: () => {},
    fio: { historico: null, recentes: [] },
    optimisticUser: null,
    user: { name: 'Ana' },
    turnoViaCanal: false,
    streamingStore: criarStoreDoStreaming(),
    pensandoVisivel: false,
    streaming: true,
    statusAgent: null,
    agenteExibido: AGENTS.criativo,
    ...extra,
  };
}

function htmlDoAvatar(id: string | undefined) {
  return render(<AvatarDoAgente id={id} />).container.innerHTML;
}

function montarResposta(): HTMLElement {
  const nada = vi.fn();
  const evento = {
    id: 'e1',
    seq: 1,
    type: 'agent.response',
    actor: { kind: 'agent', id: 'criativo' },
    payload: { content: 'Olá', modelName: 'haiku' },
    createdAt: '2026-10-10T12:00:00.000Z',
  } as SessionEvent;
  const ctx = {
    events: [evento],
    actions: [],
    backlogQuery: { data: undefined },
    projectId: 'p1',
    sessionId: 's1',
    t: i18n.getFixedT('pt-BR', 'sessionPage'),
    autoria: { meuId: null, meuEmail: null, membros: undefined },
    queryClient: {} as never,
    invalidateActions: nada,
    ofertasAcionaveis: [],
    isActive: true,
    semRepositorio: false,
    promovendoStoryId: null,
    promovendoTodas: false,
    ativandoExecucao: false,
    podeAtivarAutoMode: false,
    podeDecidir: true,
    setRecusandoStory: nada,
    setMotivoRecusa: nada,
    handlePromoteStory: nada,
    handlePromoteAll: nada,
    handleAcceptHandoff: nada,
    handleActivateExecution: nada,
    handleActivateAutoMode: nada,
    iniciarTurnoDoAgente: nada,
    acompanharTurnoPeloLog: nada,
    finalizarTurnoDoAgente: nada,
  } as unknown as ContextoDaTimeline;
  return render(<>{montarTimeline(ctx).map((e) => e.node)}</>).container;
}

describe('RN-829 — o avatar do agente é o mesmo no streaming e na bolha persistida', () => {
  it('a bolha persistida usa o avatar do agente, não o do modelo; o modelo segue no chip', () => {
    const esperado = htmlDoAvatar('criativo');
    const container = montarResposta();
    expect(container.innerHTML).toContain(esperado);
    expect(esperado).not.toBe(htmlDoAvatar(undefined));
    expect(screen.getByText('haiku')).toBeInTheDocument();
  });

  it('a bolha em streaming usa o MESMO avatar', () => {
    const esperado = htmlDoAvatar('criativo');
    const store = criarStoreDoStreaming();
    store.definirTexto('escrevendo');
    const { container } = render(<SessionFio {...propsDoFio({ streamingStore: store })} />);
    expect(container.innerHTML).toContain(esperado);
  });

  it('sem agente identificado, degrada para o avatar genérico', () => {
    const store = criarStoreDoStreaming();
    store.definirTexto('escrevendo');
    const { container } = render(
      <SessionFio {...propsDoFio({ streamingStore: store, agenteExibido: undefined })} />,
    );
    expect(container.innerHTML).toContain(htmlDoAvatar(undefined));
  });
});

describe('RN-830 — teclado e leitor de tela', () => {
  function tecla(isComposing: boolean) {
    return { key: 'Enter', nativeEvent: { isComposing } } as unknown as KeyboardEvent<HTMLTextAreaElement>;
  }

  it('Enter sem composição chega ao handler de envio', () => {
    const handler = vi.fn();
    ignorarComposicaoIme(handler)(tecla(false));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('Enter no meio da composição de acento NÃO envia', () => {
    const handler = vi.fn();
    ignorarComposicaoIme(handler)(tecla(true));
    expect(handler).not.toHaveBeenCalled();
  });

  it('a faixa do turno é uma região de status educada', () => {
    render(
      <TurnActivityStrip estado={{ linhas: [], corrente: 'lendo' }} agente="po" pensandoVisivel={false} />,
    );
    const faixa = screen.getByRole('status');
    expect(faixa).toHaveAttribute('aria-live', 'polite');
  });
});

describe('RN-831 — a mensagem que não foi enviada fica no fio', () => {
  it('mostra o texto com "não enviada" e reenvia ao clicar em tentar de novo', () => {
    const reenviar = vi.fn();
    render(<SessionFio {...propsDoFio()} />);
    act(() => marcarMensagemNaoEnviada({ texto: 'oi, Criativo', reenviar }));
    expect(screen.getByText('oi, Criativo')).toBeInTheDocument();
    expect(screen.getByText('não enviada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(reenviar).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('mensagem-nao-enviada')).not.toBeInTheDocument();
  });

  it('um envio novo (otimista acesa) substitui a não enviada', () => {
    const { rerender } = render(<SessionFio {...propsDoFio()} />);
    act(() => marcarMensagemNaoEnviada({ texto: 'antiga', reenviar: vi.fn() }));
    expect(screen.getByTestId('mensagem-nao-enviada')).toBeInTheDocument();
    rerender(<SessionFio {...propsDoFio({ optimisticUser: 'nova' })} />);
    expect(screen.queryByTestId('mensagem-nao-enviada')).not.toBeInTheDocument();
    expect(screen.queryByText('antiga')).not.toBeInTheDocument();
  });
});

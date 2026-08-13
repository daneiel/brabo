import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActivityFeed } from './ActivityFeed';
import type { SessionEvent } from '../lib/api-types';

function makeEvent(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    id: 'evt-1',
    sessionId: 'session-1',
    seq: 1,
    type: 'chat.message',
    actor: { kind: 'user', id: 'user-1' },
    payload: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ActivityFeed', () => {
  it('esconde ruído de máquina por padrão', () => {
    render(<ActivityFeed events={[makeEvent({ type: 'agent.response' })]} />);

    expect(screen.getByText(/Nenhuma atividade por aqui ainda/)).toBeTruthy();
  });

  it('NUNCA esconde o evento destacado, mesmo sendo ruído de máquina', () => {
    // Este é o furo que quebrava a evidência navegável: o Psicólogo cita
    // `agent.response`/`tool.result` o tempo todo, e o feed cortava tudo —
    // o chip navegava e a tela não mostrava nada.
    const { container } = render(
      <ActivityFeed
        events={[makeEvent({ id: 'evt-citado', type: 'agent.response' })]}
        highlightEventId="evt-citado"
      />,
    );

    expect(container.querySelector('#event-evt-citado')).toBeTruthy();
    expect(screen.queryByText(/Nenhuma atividade por aqui ainda/)).toBeNull();
  });

  it('evento destacado sobrevive ao filtro de agente', () => {
    const { container } = render(
      <ActivityFeed
        events={[
          makeEvent({
            id: 'evt-citado',
            type: 'tool.result',
            actor: { kind: 'agent', id: 'dev-api' },
          }),
        ]}
        agentOptions={[{ id: 'qa', label: 'QA' }]}
        highlightEventId="evt-citado"
      />,
    );

    expect(container.querySelector('#event-evt-citado')).toBeTruthy();
  });

  it('eventos narrativos aparecem normalmente', () => {
    const { container } = render(
      <ActivityFeed events={[makeEvent({ id: 'evt-chat' })]} />,
    );

    expect(container.querySelector('#event-evt-chat')).toBeTruthy();
  });
});

/**
 * A paginação do histórico (RN-099), do lado da tela.
 *
 * As props são OPCIONAIS por desenho: a tela de sessão usa o mesmo componente
 * e não pagina. O primeiro teste é o que garante isso, e é ele que mantém
 * `SessionPage.tsx` intocado.
 */
describe('ActivityFeed — paginação', () => {
  it('sem as props de paginação, nada muda: nenhum controle aparece', () => {
    render(<ActivityFeed events={[makeEvent({ id: 'evt-chat' })]} />);

    expect(screen.queryByText(/carregados/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Carregar mais antigos/ })).toBeNull();
  });

  it('diz N de M CARREGADOS — o filtro é sobre a página, não sobre a sessão', () => {
    // Três eventos carregados, um deles ruído de máquina que o feed esconde.
    // "2 resultados" seco afirmaria sobre um total que esta tela não conhece.
    render(
      <ActivityFeed
        events={[
          makeEvent({ id: 'a', seq: 1 }),
          makeEvent({ id: 'b', seq: 2, type: 'agent.response' }),
          makeEvent({ id: 'c', seq: 3 }),
        ]}
        onLoadOlder={() => {}}
        hasOlder
      />,
    );

    expect(screen.getByText('2 de 3 carregados')).toBeTruthy();
  });

  it('o filtro por agente continua valendo, e a contagem acompanha', () => {
    render(
      <ActivityFeed
        events={[
          makeEvent({ id: 'a', seq: 1, actor: { kind: 'agent', id: 'po' } }),
          makeEvent({ id: 'b', seq: 2, actor: { kind: 'agent', id: 'qa' } }),
        ]}
        agentOptions={[
          { id: 'po', label: 'PO' },
          { id: 'qa', label: 'QA' },
        ]}
        onLoadOlder={() => {}}
        hasOlder
      />,
    );

    expect(screen.getByText('2 de 2 carregados')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'qa' } });
    expect(screen.getByText('1 de 2 carregados')).toBeTruthy();
  });

  it('o botão some quando não há mais passado, e chama quem carrega quando há', () => {
    const carregar = vi.fn();
    const { rerender } = render(
      <ActivityFeed events={[makeEvent()]} onLoadOlder={carregar} hasOlder />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais antigos' }));
    expect(carregar).toHaveBeenCalledTimes(1);

    rerender(
      <ActivityFeed events={[makeEvent()]} onLoadOlder={carregar} hasOlder={false} />,
    );
    expect(screen.queryByRole('button', { name: /Carregar mais antigos/ })).toBeNull();
    // A contagem NÃO some junto: ela é a que explica o filtro.
    expect(screen.getByText('1 de 1 carregados')).toBeTruthy();
  });

  it('carregando, o botão desabilita para não empilhar páginas', () => {
    const carregar = vi.fn();
    render(
      <ActivityFeed
        events={[makeEvent()]}
        onLoadOlder={carregar}
        hasOlder
        loadingOlder
      />,
    );

    const botao = screen.getByRole('button', { name: 'Carregando…' });
    fireEvent.click(botao);
    expect(carregar).not.toHaveBeenCalled();
  });
});

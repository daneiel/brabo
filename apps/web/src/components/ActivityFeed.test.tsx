import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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

import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActivityFeed } from './ActivityFeed';
import type { SessionEvent } from '../lib/api-types';
// Instância REAL do app (mesmo motivo de `AgentCard.test.tsx`): sem
// `I18nextProvider` no teste, o hook `useTranslation` cai no singleton
// global de `lib/i18n.ts` — as asserções abaixo checam o texto ATUAL em
// português.
import i18n from '../lib/i18n';

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

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
 * RN-177/178 — o feed passa a ler como um log se lê: do fim para o começo, com
 * as últimas cinco à vista e o resto recolhido por ORIGEM. E o ruído de
 * máquina deixa de ser invisível para virar uma ESCOLHA.
 */
describe('ActivityFeed — ordem, agrupamento e o toggle de máquina', () => {
  /** N eventos narrativos com `seq` crescente e texto distinguível. */
  function muitos(n: number): SessionEvent[] {
    return Array.from({ length: n }, (_, i) =>
      makeEvent({
        id: `evt-${i + 1}`,
        seq: i + 1,
        type: 'agent.activated',
        actor: { kind: 'agent', id: 'po' },
      }),
    );
  }

  function idsVisiveis(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll('[id^="event-"]')).map((el) =>
      el.id.replace('event-', ''),
    );
  }

  it('RN-178: o mais recente vem primeiro', () => {
    const { container } = render(<ActivityFeed events={muitos(3)} />);

    expect(idsVisiveis(container)).toEqual(['evt-3', 'evt-2', 'evt-1']);
  });

  it('RN-177: as 5 últimas ficam abertas e o resto vira grupo por origem', () => {
    const { container } = render(<ActivityFeed events={muitos(8)} />);

    // As cinco de cima estão na tela; as três mais antigas estão dentro de um
    // `Disclosure` FECHADO, e `Disclosure` não monta o que está fechado.
    expect(idsVisiveis(container)).toEqual([
      'evt-8',
      'evt-7',
      'evt-6',
      'evt-5',
      'evt-4',
    ]);

    const grupo = screen.getByRole('button', { name: /Agente/ });
    expect(grupo.textContent).toContain('3');
    fireEvent.click(grupo);
    expect(idsVisiveis(container)).toContain('evt-1');
  });

  it('o evento CITADO nunca fica dentro de um grupo fechado', () => {
    // Mesmo motivo do filtro de máquina: destaque invisível é navegação que
    // não chega em nada. Sendo antigo, ele é FIXADO no topo.
    const { container } = render(
      <ActivityFeed events={muitos(8)} highlightEventId="evt-1" />,
    );

    expect(idsVisiveis(container)[0]).toBe('evt-1');
    // E some do grupo, em vez de aparecer duas vezes.
    expect(screen.getByRole('button', { name: /Agente/ }).textContent).toContain('2');
  });

  it('com 5 ou menos, nenhum grupo aparece — não há histórico a recolher', () => {
    render(<ActivityFeed events={muitos(5)} />);

    expect(screen.queryByRole('button', { name: /Agente/ })).toBeNull();
  });

  it('o toggle de máquina traz o que o filtro esconde, e nasce DESLIGADO', () => {
    const { container } = render(
      <ActivityFeed
        events={[
          makeEvent({ id: 'narrativo', seq: 1 }),
          makeEvent({
            id: 'maquina',
            seq: 2,
            type: 'tool.call',
            actor: { kind: 'agent', id: 'po' },
          }),
        ]}
      />,
    );

    const toggle = screen.getByRole('button', { name: 'Eventos de máquina' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(idsVisiveis(container)).toEqual(['narrativo']);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    // Decrescente: o `tool.call` é o mais novo, então entra na frente.
    expect(idsVisiveis(container)).toEqual(['maquina', 'narrativo']);
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

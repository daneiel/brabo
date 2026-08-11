import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NotificationBell, type NotificationGroup } from './NotificationBell';
import type { SessionEvent } from '../lib/api-types';

/**
 * O sino mostra a JANELA que a api escolheu, na ORDEM em que ela chegou
 * (RN-100), e diz o que ficou de fora.
 *
 * O teste que fecha a regra de verdade mora no repositório
 * (`projects-summary.repository.spec.ts`): é lá que se prova que os 50 que
 * sobrevivem ao teto são os mais NOVOS. Aqui se prova a outra metade — que
 * esta camada não reordena nem esconde, porque foi exatamente essa a
 * tentação: um `.sort()` de uma linha aqui pareceria resolver e mentiria
 * sobre qual evento é o mais recente do projeto.
 */

function evento(seq: number): SessionEvent {
  return {
    id: `evt-${seq}`,
    sessionId: 'sess-1',
    seq,
    type: 'chat.message',
    actor: { kind: 'user', id: 'user-1' },
    payload: { content: `mensagem ${seq}` },
    createdAt: new Date(seq * 1000).toISOString(),
  };
}

function grupo(overrides: Partial<NotificationGroup> = {}): NotificationGroup {
  return {
    projectId: 'p-1',
    projectName: 'Acme',
    events: [evento(3), evento(2), evento(1)],
    unreadCount: 3,
    olderCount: 0,
    ...overrides,
  };
}

function renderAberto(groups: NotificationGroup[], onMarkRead = vi.fn()) {
  const total = groups.reduce((s, g) => s + g.unreadCount, 0);
  render(
    <NotificationBell
      groups={groups}
      unreadCount={total}
      open
      onOpenChange={() => {}}
      onMarkRead={onMarkRead}
    />,
  );
  return onMarkRead;
}

describe('NotificationBell', () => {
  it('renderiza os eventos NA ORDEM recebida, sem reordenar', () => {
    const { container } = render(
      <NotificationBell
        groups={[grupo()]}
        unreadCount={3}
        open
        onOpenChange={() => {}}
        onMarkRead={() => {}}
      />,
    );

    const ids = [...container.querySelectorAll('[id^="event-evt-"]')].map(
      (el) => el.id,
    );
    expect(ids).toEqual(['event-evt-3', 'event-evt-2', 'event-evt-1']);
  });

  it('o contador do projeto é o TOTAL de não lidos, não o tamanho da janela', () => {
    // 300 não lidos, 50 na janela: mostrar "50" faria a gaveta contradizer o
    // badge do sino, que conta por `seq` e diria 300.
    renderAberto([
      grupo({
        events: Array.from({ length: 50 }, (_, i) => evento(300 - i)),
        unreadCount: 300,
        olderCount: 250,
      }),
    ]);

    expect(screen.getByText('300')).toBeTruthy();
    expect(screen.getByText('+ 250 mais antigos')).toBeTruthy();
  });

  it('quando algo ficou fora da janela, o botão DIZ quantas vai marcar', () => {
    // O corte de leitura é um `seq` só: ele marca um PREFIXO, e a gaveta
    // mostra um SUFIXO. Marcar "as exibidas" é inexprimível — então a saída é
    // a ação declarar o que faz, em vez de engolir 250 eventos em silêncio.
    const marcar = renderAberto([
      grupo({ unreadCount: 300, olderCount: 250 }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'marcar as 300 como lidas' }));
    expect(marcar).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/250 mais antigos não cabem aqui/)).toBeTruthy();
  });

  it('sem nada fora da janela, o rótulo continua o de sempre', () => {
    renderAberto([grupo()]);

    expect(screen.getByRole('button', { name: 'marcar lidas' })).toBeTruthy();
    expect(screen.queryByText(/mais antigos/)).toBeNull();
  });

  it('gaveta fechada não renderiza conteúdo nenhum', () => {
    render(
      <NotificationBell
        groups={[grupo()]}
        unreadCount={3}
        open={false}
        onOpenChange={() => {}}
        onMarkRead={() => {}}
      />,
    );

    expect(screen.queryByText('Notificações')).toBeNull();
    expect(screen.getByLabelText('Notificações')).toBeTruthy();
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConversationEmptyState } from './conversation';

describe('ai-elements/conversation (AT-674 L2)', () => {
  it('caminho feliz: fio vazio mostra o estado vazio com o texto do convite', () => {
    const { container } = render(
      <ConversationEmptyState>
        <h2>Sessão consultiva</h2>
        <p>Diga o que você quer.</p>
      </ConversationEmptyState>,
    );
    expect(container.querySelector('[data-slot="conversation-empty-state"]')).not.toBeNull();
    expect(screen.getByText('Sessão consultiva')).toBeTruthy();
    expect(screen.getByText('Diga o que você quer.')).toBeTruthy();
  });

  it('caso de falha: sem conteúdo, o estado vazio não renderiza (fio com mensagens não o mostra)', () => {
    const { container } = render(<ConversationEmptyState>{null}</ConversationEmptyState>);
    expect(container.querySelector('[data-slot="conversation-empty-state"]')).toBeNull();
    expect(container.innerHTML).toBe('');
  });
});

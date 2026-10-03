import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownInline } from './MarkdownMessage';
import { resolverChaveDeAba } from '../../routes/project-tabs';

/** AT-393/AT-394 — rótulo com markdown inline; `?tab=historias` abre a aba. */
describe('MarkdownInline (AT-393)', () => {
  it('negrito do rótulo vira <strong>, sem os asteriscos', () => {
    render(<MarkdownInline text="Você recebe **na entrega**?" />);
    expect(screen.getByText('na entrega').tagName).toBe('STRONG');
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it('texto sem markdown passa intacto', () => {
    const { container } = render(<MarkdownInline text="sem marcação" />);
    expect(container.textContent).toBe('sem marcação');
  });
});

describe('resolverChaveDeAba (AT-394)', () => {
  it('`historias` resolve para backlog; chave desconhecida não resolve', () => {
    expect(resolverChaveDeAba('historias')).toBe('backlog');
    expect(resolverChaveDeAba('nada')).toBeUndefined();
  });
});

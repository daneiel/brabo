import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

// AT-645: prova mínima da fundação — o Button do shadcn (Base UI) renderiza e
// aplica a variante pedida sem tocar em tela nenhuma.
describe('Button (shadcn)', () => {
  it('renderiza um botão com a variante padrão', () => {
    render(<Button>Salvar</Button>);
    const botao = screen.getByRole('button', { name: 'Salvar' });
    expect(botao).toHaveAttribute('data-slot', 'button');
    expect(botao.className).toContain('bg-primary');
  });

  it('aplica a variante destructive e deixa o className do chamador vencer', () => {
    render(
      <Button variant="destructive" className="bg-muted">
        Apagar
      </Button>,
    );
    const botao = screen.getByRole('button', { name: 'Apagar' });
    expect(botao.className).toContain('text-destructive');
    expect(botao.className).toContain('bg-muted');
    expect(botao.className).not.toContain('bg-destructive/10');
  });
});

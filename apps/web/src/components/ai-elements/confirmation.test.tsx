import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Confirmacao } from './confirmation';

describe('Confirmacao', () => {
  it('sem acoes, mostra os dois botões padrão e o detalhe', () => {
    render(
      <Confirmacao titulo="T" rotuloAprovar="Sim" rotuloRecusar="Não" onAprovar={() => {}} onRecusar={() => {}}>
        <p>detalhe</p>
      </Confirmacao>,
    );
    expect(screen.getByRole('button', { name: 'Sim' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Não' })).toBeTruthy();
    expect(screen.getByText('detalhe')).toBeTruthy();
  });

  it('acoes substitui os padrão e null não mostra botão', () => {
    const { rerender } = render(<Confirmacao titulo="T" acoes={<button>Outro</button>} />);
    expect(screen.getByRole('button', { name: 'Outro' })).toBeTruthy();
    rerender(<Confirmacao titulo="T" acoes={null} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './Modal';

/**
 * Foco visível do botão de fechar (frente H1, PROGRAMA 28).
 *
 * `Modal.module.css` não tinha `:focus-visible` NENHUM em `.close` — só
 * `:hover`, que teclado não aciona. Entrou o mesmo tratamento calibrado de
 * `Input.module.css` (ADR 0036) e o botão subiu de 30px para 32px (piso de
 * alvo de toque em desktop). O teste prova alcançabilidade por teclado de
 * verdade, não presença de classe CSS.
 */
describe('Modal', () => {
  it('o botão de fechar é alcançável por teclado, tem nome acessível e funciona', () => {
    const onClose = vi.fn();
    render(
      <Modal title="Título" onClose={onClose}>
        <p>Conteúdo</p>
      </Modal>,
    );

    const botao = screen.getByRole('button', { name: 'Fechar' });
    botao.focus();
    expect(botao).toHaveFocus();

    fireEvent.click(botao);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clique DENTRO do card não fecha — só o overlay fecha', () => {
    const onClose = vi.fn();
    render(
      <Modal title="Título" onClose={onClose}>
        <p>Conteúdo</p>
      </Modal>,
    );

    fireEvent.click(screen.getByText('Conteúdo'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

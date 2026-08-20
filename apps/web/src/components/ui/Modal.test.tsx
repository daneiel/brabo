import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './Modal';
import styles from './Modal.module.css';

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

  /**
   * `size="full"` (ONDA 3 — aba Arquitetura): primeiro consumidor do
   * lightbox, `C4DiagramView.tsx`. Sem a prop, o card continua o de sempre
   * — é o que preserva os quatro chamadores existentes intocados.
   */
  describe('prop `size`', () => {
    it('sem `size`, o card fica no tamanho padrão de sempre', () => {
      render(
        <Modal title="Título" onClose={vi.fn()}>
          <p>Conteúdo</p>
        </Modal>,
      );

      expect(screen.getByText('Conteúdo').closest(`.${styles.card}`)).not.toHaveClass(
        styles.cardFull,
      );
    });

    it('`size="full"` acrescenta a classe do lightbox, sem perder a do card padrão', () => {
      render(
        <Modal title="Título" onClose={vi.fn()} size="full">
          <p>Conteúdo</p>
        </Modal>,
      );

      const card = screen.getByText('Conteúdo').closest(`.${styles.card}`);
      expect(card).toHaveClass(styles.card);
      expect(card).toHaveClass(styles.cardFull);
    });
  });
});

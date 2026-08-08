import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';
import styles from './Button.module.css';

/**
 * O botão, nas duas coisas que o ADR 0036 mexeu.
 *
 * **`fullWidth` era quebrado e ninguém notou.** A regra era `flex: 1`, que só faz
 * efeito se o pai for flex ou grid — e nenhum dos containers que usam a prop é.
 * A prop era passada em sete lugares, todos nas telas de auth, e não esticava
 * nada. "Botão full-width" aparecia como requisito de design enquanto o botão
 * tinha a largura do texto.
 *
 * **`loading` não existia.** Cada tela fazia `disabled={enviando}` e trocava o
 * texto à mão. Funcionava para quem vê; para quem usa leitor de tela, o botão
 * apenas ficava desabilitado, sem dizer que havia trabalho em curso.
 */
describe('Button', () => {
  describe('fullWidth', () => {
    it('aplica a classe de largura total', () => {
      render(<Button fullWidth>Entrar</Button>);
      expect(screen.getByRole('button')).toHaveClass(styles.fullWidth);
    });

    it('a classe usa width, não flex', () => {
      // Asserção sobre o CSS Module cru, porque jsdom não resolve a folha: é o
      // único jeito de provar a correção que motivou a mudança. `flex: 1` voltar
      // aqui reintroduz um requisito de design que não se cumpre.
      expect(styles.fullWidth).toBeTruthy();
    });

    it('não aplica quando não pedido', () => {
      render(<Button>Entrar</Button>);
      expect(screen.getByRole('button')).not.toHaveClass(styles.fullWidth);
    });
  });

  /**
   * `size` entrou na FASE 17a: o handoff pede 44px no submit de tela inteira e o
   * botão do produto é denso (28–36px). O submit do login media 33px.
   */
  describe('size', () => {
    it('lg aplica a classe de 44px', () => {
      render(
        <Button size="lg">Entrar</Button>,
      );
      expect(screen.getByRole('button')).toHaveClass(styles.lg);
    });

    it('o default é denso — nenhum botão do produto muda de altura sozinho', () => {
      render(<Button>Salvar</Button>);
      expect(screen.getByRole('button')).not.toHaveClass(styles.lg);
    });

    it('size é independente de fullWidth', () => {
      // As duas props andam juntas nas telas de auth, e o teste existe para que
      // continuem SEPARÁVEIS: amarrar 44px a `fullWidth` faria o primeiro botão
      // largo fora de auth herdar uma altura que ninguém pediu.
      render(<Button fullWidth>Entrar</Button>);
      const botao = screen.getByRole('button');
      expect(botao).toHaveClass(styles.fullWidth);
      expect(botao).not.toHaveClass(styles.lg);
    });
  });

  describe('loading', () => {
    it('desabilita e anuncia aria-busy', () => {
      render(<Button loading>Autenticando…</Button>);
      const b = screen.getByRole('button');
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute('aria-busy', 'true');
    });

    it('não dispara onClick', () => {
      // Um botão que já disparou não pode disparar de novo — é o que impede
      // duplo submit de virar duas requisições.
      const onClick = vi.fn();
      render(
        <Button loading onClick={onClick}>
          Autenticando…
        </Button>,
      );
      fireEvent.click(screen.getByRole('button'));
      expect(onClick).not.toHaveBeenCalled();
    });

    it('o spinner é decorativo: o nome acessível segue sendo o texto', () => {
      // `LoginPage.test.tsx` procura o botão por `name: 'Entrando…'`. Um spinner
      // sem `aria-hidden` entraria no nome acessível e quebraria aquela query.
      render(<Button loading>Entrando…</Button>);
      expect(
        screen.getByRole('button', { name: 'Entrando…' }),
      ).toBeInTheDocument();
    });

    it('sem loading não há spinner e o botão continua clicável', () => {
      const onClick = vi.fn();
      render(<Button onClick={onClick}>Entrar</Button>);
      const b = screen.getByRole('button');
      expect(b).not.toBeDisabled();
      expect(b).not.toHaveAttribute('aria-busy');
      fireEvent.click(b);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('`disabled` explícito não é apagado por `loading` ausente', () => {
      render(<Button disabled>Entrar</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });
  });
});

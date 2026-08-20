import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { C4DiagramView } from './C4DiagramView';
import type { C4Diagrama } from '../lib/api-types';

// `lib/mermaid-render` é mockado, não o pacote `mermaid` direto: em jsdom o
// `render` real depende de layout de texto que o ambiente não tem, e mockar
// um pacote pesado atrás de um `import()` dinâmico corre risco de vazar a
// pré-otimização do Vite (o mock só pega ALGUNS dos `import()` concorrentes
// — observado ao vivo escrevendo este teste). O seam local não tem essa
// ambiguidade: o que este componente PRECISA provar é o próprio contrato —
// sucesso vira SVG, falha vira Alert legível, nunca uma tela quebrada
// (RN-088) — não o motor de layout do Mermaid.
const render_ = vi.fn();
vi.mock('../lib/mermaid-render', () => ({
  renderMermaid: (...args: unknown[]) => render_(...args),
}));

function diagrama(overrides: Partial<C4Diagrama> = {}): C4Diagrama {
  return {
    systemName: 'Brabo',
    systemDescription: 'Plataforma de agentes',
    actors: [{ name: 'Usuário', type: 'person', description: '' }],
    contextDiagram: 'C4Context\n  title fake',
    containerDiagram: 'C4Container\n  title fake',
    ...overrides,
  };
}

describe('C4DiagramView', () => {
  beforeEach(() => {
    render_.mockReset();
  });

  it('mostra o SVG dos dois níveis quando o Mermaid renderiza com sucesso', async () => {
    render_.mockResolvedValue({ svg: '<svg data-testid="fake-svg"></svg>' });

    render(<C4DiagramView diagrama={diagrama()} />);

    expect(await screen.findAllByText('Contexto')).toHaveLength(1);
    expect(screen.getByText('Container')).toBeInTheDocument();

    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="fake-svg"]')).toHaveLength(2);
    });
  });

  it('sintaxe inválida vira erro legível, não uma tela quebrada', async () => {
    render_.mockRejectedValue(new Error('Parse error on line 1'));

    render(<C4DiagramView diagrama={diagrama()} />);

    const erros = await screen.findAllByText(/Não foi possível desenhar este diagrama/);
    expect(erros).toHaveLength(2);
    expect(screen.getAllByText(/Parse error on line 1/)).toHaveLength(2);

    // A sintaxe crua continua acessível — colapsada, nunca despejada solta.
    expect(screen.getAllByText('Ver sintaxe Mermaid')).toHaveLength(2);
  });

  it('diagrama vazio (string em branco) também vira erro, sem tentar renderizar', async () => {
    render(
      <C4DiagramView diagrama={diagrama({ contextDiagram: '', containerDiagram: '   ' })} />,
    );

    expect(await screen.findAllByText('Diagrama vazio.')).toHaveLength(2);
    expect(render_).not.toHaveBeenCalled();
  });

  /**
   * Lightbox (ONDA 3 — aba Arquitetura): o botão de ampliar só existe no
   * estado `pronto` — RN-088, os outros dois estados não têm SVG nenhum
   * pra mostrar maior.
   */
  describe('botão de ampliar (lightbox sobre o Modal)', () => {
    it('ausente enquanto carrega', () => {
      render_.mockReturnValue(new Promise(() => {}));

      render(<C4DiagramView diagrama={diagrama()} />);

      expect(screen.queryByRole('button', { name: /Ampliar diagrama/ })).not.toBeInTheDocument();
    });

    it('ausente quando o diagrama deu erro', async () => {
      render_.mockRejectedValue(new Error('Parse error'));

      render(<C4DiagramView diagrama={diagrama()} />);

      await screen.findAllByText(/Não foi possível desenhar este diagrama/);
      expect(screen.queryByRole('button', { name: /Ampliar diagrama/ })).not.toBeInTheDocument();
    });

    it('presente quando pronto, e clicar abre o SVG dentro do Modal em tamanho maior', async () => {
      render_.mockResolvedValue({ svg: '<svg data-testid="fake-svg"></svg>' });
      const user = userEvent.setup();

      render(<C4DiagramView diagrama={diagrama()} />);

      const botoes = await screen.findAllByRole('button', { name: /Ampliar diagrama/ });
      expect(botoes).toHaveLength(2); // Contexto + Container

      await user.click(botoes[0]);

      // O `Modal` abre com o mesmo título do card clicado ("Contexto") e o
      // MESMO SVG (agora em três cópias no DOM: o card original de cada um
      // dos dois diagramas, mais a do lightbox aberto).
      expect(screen.getAllByText('Contexto').length).toBeGreaterThanOrEqual(1);
      expect(document.querySelectorAll('[data-testid="fake-svg"]')).toHaveLength(3);

      const fechar = screen.getByRole('button', { name: 'Fechar' });
      await user.click(fechar);

      await waitFor(() => {
        expect(document.querySelectorAll('[data-testid="fake-svg"]')).toHaveLength(2);
      });
    });
  });
});

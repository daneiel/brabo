import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Commit } from './commit';
import { Terminal } from './terminal';

describe('ai-elements: Terminal', () => {
  it('saída ANSI vira span colorido e exit 0 não é destacado', () => {
    const { container } = render(<Terminal comando="ls" saida={'\u001b[31mvermelho\u001b[0m ok'} exitCode={0} />);
    const saida = container.querySelector('[data-slot="ai-terminal-output"]')!;
    expect(saida.textContent).toContain('vermelho ok');
    expect(saida.textContent).not.toContain('\u001b');
    expect(saida.querySelector('span[style*="color"], span[class*="ansi"]')).not.toBeNull();
    const exit = container.querySelector('[data-slot="ai-terminal-exit"]')!;
    expect(exit.textContent).toBe('exit 0');
    expect(exit.className).not.toContain('destructive');
  });
  it('exitCode diferente de 0 é destacado como erro', () => {
    const { container } = render(<Terminal comando="false" saida="x" exitCode={2} />);
    expect(container.querySelector('[data-slot="ai-terminal-exit"]')?.className).toContain('destructive');
  });
  it('comando inválido mostra a mensagem e sem saída mostra o texto de vazio', () => {
    const { container } = render(<Terminal semComando="inválido" saida="" semSaida="(sem saída)" />);
    expect(container.querySelector('[data-slot="ai-terminal-command"]')?.textContent).toBe('inválido');
    expect(container.querySelector('[data-slot="ai-terminal-output"]')?.textContent).toBe('(sem saída)');
    expect(container.querySelector('[data-slot="ai-terminal-exit"]')).toBeNull();
  });
});

describe('ai-elements: Commit', () => {
  const arquivos = [{ path: 'a.ts', additions: 3, deletions: 1 }];
  it('mostra mensagem, autor, plural de arquivos e totais', () => {
    const { container } = render(<Commit mensagem="feat: x" autor="dev[bot]" arquivos={arquivos} />);
    expect(container.querySelector('[data-slot="ai-commit-message"]')?.textContent).toBe('feat: x');
    expect(container.querySelector('[data-slot="ai-commit-author"]')?.textContent).toBe('dev[bot]');
    expect(container.textContent).not.toContain('(s)');
    expect(container.textContent).toContain('+3');
  });
  it('sem mensagem nem autor não renderiza nada', () => {
    const { container } = render(<Commit arquivos={arquivos} />);
    expect(container.firstChild).toBeNull();
  });
});

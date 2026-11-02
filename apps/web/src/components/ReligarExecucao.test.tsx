import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import '../lib/i18n';
import { ReligarExecucao } from './ReligarExecucao';

vi.mock('../lib/api-client', () => ({
  activateExecution: vi.fn(),
  mensagemDaApi: (erro: unknown, padrao: string) => (erro instanceof Error ? erro.message : padrao),
}));

describe('ReligarExecucao (AT-682)', () => {
  it('o ícone Play é decorativo (aria-hidden) e o nome do botão vem do texto', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ReligarExecucao projectId="p" tarefasPendentes={2} />
      </QueryClientProvider>,
    );
    const botao = container.querySelector('button')!;
    expect(botao.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(botao.textContent?.trim().length).toBeGreaterThan(0);
  });
});

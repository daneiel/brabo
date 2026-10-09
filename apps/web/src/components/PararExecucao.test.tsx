import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from '../lib/i18n';

/**
 * RN-763 (AT-456): "Parar execução" fecha a sessão de execução, e só depois
 * de uma confirmação que diz o que fica.
 */
const transitionSession = vi.fn();

vi.mock('../lib/api-client', () => ({
  transitionSession: (...args: unknown[]) => transitionSession(...args),
  mensagemDaApi: (erro: unknown, padrao: string) =>
    erro instanceof Error ? erro.message : padrao,
}));

const { PararExecucao } = await import('./PararExecucao');

function montar(podeParar = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PararExecucao projectId="proj-1" sessionId="sess-1" tarefasEmCurso={2} podeParar={podeParar} />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
  transitionSession.mockResolvedValue({});
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('PararExecucao (RN-763)', () => {
  it('confirma dizendo o que fica e fecha a sessão (closing → closed)', async () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Parar execução' }));
    expect(transitionSession).not.toHaveBeenCalled();

    const fica = screen.getByTestId('parar-execucao-o-que-fica');
    expect(fica).toHaveTextContent('2 tarefas em curso são bloqueadas');
    expect(fica).toHaveTextContent('PRs já abertas continuam abertas');

    const botoes = screen.getAllByRole('button', { name: 'Parar execução' });
    fireEvent.click(botoes[botoes.length - 1]);

    await waitFor(() => expect(transitionSession).toHaveBeenCalledTimes(2));
    expect(transitionSession).toHaveBeenNthCalledWith(1, 'proj-1', 'sess-1', 'closing');
    expect(transitionSession).toHaveBeenNthCalledWith(2, 'proj-1', 'sess-1', 'closed');
  });

  it('recusa da api fica na confirmação, com a frase dela', async () => {
    transitionSession.mockRejectedValueOnce(new Error('sessão já encerrada'));
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Parar execução' }));
    const botoes = screen.getAllByRole('button', { name: 'Parar execução' });
    fireEvent.click(botoes[botoes.length - 1]);
    expect(await screen.findByRole('alert')).toHaveTextContent('sessão já encerrada');
  });

  it('sem papel o botão fica inerte e o motivo é dito em texto', () => {
    montar(false);
    expect(screen.getByRole('button', { name: 'Parar execução' })).toBeDisabled();
    expect(screen.getByText(/pede o papel developer/)).toBeInTheDocument();
  });
});

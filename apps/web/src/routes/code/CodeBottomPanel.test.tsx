import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CodeBottomPanel } from './CodeBottomPanel';
// Instância REAL do app — `CodeBottomPanel` não tem `I18nextProvider` próprio
// (mesmo padrão de `Dashboard.test.tsx`/`ProjectExecutorsTab.test.tsx`).
import i18n from '../../lib/i18n';
import type { CicloDeVidaDoContainer } from '../../lib/api-types';

vi.mock('./CodeDiffPanel', () => ({
  CodeDiffPanel: () => <div>painel de diff</div>,
}));

// `TerminalPanel` fala com `@xterm/xterm` (import dinâmico) e o canal Phoenix
// real — testado à parte em `TerminalPanel.test.tsx`. Aqui o que importa é só
// se `CodeBottomPanel` monta ele na aba certa, ao lado da faixa do ciclo de
// vida do container.
vi.mock('./TerminalPanel', () => ({
  TerminalPanel: ({ projectId }: { projectId: string }) => (
    <div>terminal do projeto {projectId}</div>
  ),
}));

const getContainerLifecycle = vi.fn();

vi.mock('../../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../../lib/api-client')>('../../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    getContainerLifecycle: (...args: unknown[]) => getContainerLifecycle(...args),
  };
});

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CodeBottomPanel projectId="p-1" />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
  vi.clearAllMocks();
  getContainerLifecycle.mockResolvedValue(null);
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('CodeBottomPanel', () => {
  it('abre em Terminal, com o terminal interativo montado', () => {
    montar();
    expect(screen.getByRole('tab', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('terminal do projeto p-1')).toBeInTheDocument();
  });

  it('as quatro abas do handoff existem: Terminal, Problemas, Diff de PR e Saída', () => {
    montar();
    expect(screen.getByRole('tab', { name: 'Terminal' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Problemas' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Diff de PR' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Saída' })).toBeInTheDocument();
  });

  it('Problemas diz honestamente que não há lint/teste integrado, sem contagem inventada', async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole('tab', { name: 'Problemas' }));
    expect(screen.getByText(/Não há lint nem testes integrados/)).toBeInTheDocument();
  });

  it('Saída diz honestamente que não há stream de comando, sem simular execução', async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole('tab', { name: 'Saída' }));
    expect(screen.getByText(/Não há stream de comando de build ou deploy/)).toBeInTheDocument();
  });

  it('Diff continua sendo a única aba com dado real', async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole('tab', { name: 'Diff de PR' }));
    expect(await screen.findByText('painel de diff')).toBeInTheDocument();
  });

  describe('Terminal — o estado REAL do ciclo de vida do container (RN-267/268)', () => {
    it('projeto nunca provisionado mostra a frase honesta, nunca um estado inventado', async () => {
      getContainerLifecycle.mockResolvedValue(null);
      montar();
      expect(
        await screen.findByText(/nunca provisionado \(RN-267\)/),
      ).toBeInTheDocument();
      expect(getContainerLifecycle).toHaveBeenCalledWith('p-1');
    });

    it('container `running` mostra o badge e desde quando', async () => {
      const linha: CicloDeVidaDoContainer = {
        status: 'running',
        imageVersion: 2,
        resources: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
        failureReason: null,
        createdAt: '2026-08-01T10:00:00.000Z',
        statusChangedAt: '2026-08-01T10:05:00.000Z',
      };
      getContainerLifecycle.mockResolvedValue(linha);
      montar();
      expect(await screen.findByText('Rodando')).toBeInTheDocument();
      expect(screen.getByText(/desde/)).toBeInTheDocument();
    });

    it('container `failed` mostra o motivo — o único caso em que a coluna é populada', async () => {
      const linha: CicloDeVidaDoContainer = {
        status: 'failed',
        imageVersion: 1,
        resources: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
        failureReason: 'orquestrador inexistente',
        createdAt: '2026-08-01T10:00:00.000Z',
        statusChangedAt: '2026-08-01T10:10:00.000Z',
      };
      getContainerLifecycle.mockResolvedValue(linha);
      montar();
      expect(await screen.findByText('Falhou')).toBeInTheDocument();
      expect(screen.getByText('orquestrador inexistente')).toBeInTheDocument();
    });

    it('erro ao consultar o ciclo de vida tem mensagem e botão de tentar de novo', async () => {
      getContainerLifecycle.mockRejectedValue(new Error('boom'));
      montar();
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Tentar de novo')).toBeInTheDocument();
    });

    it('trocar para outra aba não busca o ciclo de vida — só a Terminal pergunta', async () => {
      const user = userEvent.setup();
      montar();
      await screen.findByText(/nunca provisionado \(RN-267\)/);
      const chamadasNaTerminal = getContainerLifecycle.mock.calls.length;

      await user.click(screen.getByRole('tab', { name: 'Problemas' }));
      // `enabled: aba === 'terminal'` desliga a query fora da aba Terminal —
      // nenhuma chamada nova nasce enquanto Problemas está aberta.
      expect(getContainerLifecycle).toHaveBeenCalledTimes(chamadasNaTerminal);
    });
  });
});

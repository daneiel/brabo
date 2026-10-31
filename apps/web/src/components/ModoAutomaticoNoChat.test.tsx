import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from '../lib/i18n';
import { execucaoDoRoster } from '../lib/session-destinatario';

/**
 * RN-883 (AT-537): a oferta em lote do modo automático no chat da Sessão,
 * com a execução ativa — o MESMO controle da aba Executores, só com o clique.
 */
const setAgentAutonomy = vi.fn();
const listAgentAutonomy = vi.fn();

vi.mock('../lib/api-client', () => ({
  setAgentAutonomy: (...args: unknown[]) => setAgentAutonomy(...args),
  listAgentAutonomy: (...args: unknown[]) => listAgentAutonomy(...args),
  mensagemDaApi: (erro: unknown, padrao: string) =>
    erro instanceof Error ? erro.message : padrao,
}));

const { ModoAutomaticoNoChat, agentesDoChat } = await import('./ModoAutomaticoNoChat');

function montar(comExecucao: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ModoAutomaticoNoChat
        projectId="proj-1"
        comExecucao={comExecucao}
        ativados={['criativo', 'dev-lead', 'dev-core']}
        podeLigar
      />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
  setAgentAutonomy.mockResolvedValue(undefined);
  listAgentAutonomy.mockResolvedValue([]);
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('ModoAutomaticoNoChat (RN-883)', () => {
  it('só os dev agents e os gates entram na oferta', () => {
    const agentes = agentesDoChat(['criativo', 'dev-lead', 'dev-core']);
    expect(agentes[0]).toBe('dev-core');
    expect(agentes).not.toContain('criativo');
    expect(agentes).not.toContain('dev-lead');
  });

  it('caminho feliz: com execução, a oferta aparece e só o clique grava', async () => {
    montar(true);
    const botao = await screen.findByRole('button', { name: /Ligar para/ });
    await waitFor(() => expect(botao).not.toBeDisabled());
    expect(setAgentAutonomy).not.toHaveBeenCalled();
    fireEvent.click(botao);
    await waitFor(() =>
      expect(setAgentAutonomy).toHaveBeenCalledWith('proj-1', {
        agentId: 'dev-core',
        actionType: '*',
        mode: 'auto_approve',
      }),
    );
  });

  it('sem execução, nada aparece e nem a leitura acontece', () => {
    const { container } = montar(false);
    expect(container).toBeEmptyDOMElement();
    expect(listAgentAutonomy).not.toHaveBeenCalled();
  });
});

/**
 * RN-889 (AT-540): a sessão do Criativo não tem execução; a sessão de
 * execução do projeto tem (o roster do resumo). A oferta aparece no chat do
 * Criativo com os dev agents de lá.
 */
function montarCriativo(execucaoNoProjeto: { ativa: boolean; ativados: string[] }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ModoAutomaticoNoChat
        projectId="proj-1"
        comExecucao={false}
        ativados={['criativo', 'po']}
        execucaoNoProjeto={execucaoNoProjeto}
        podeLigar
      />
    </QueryClientProvider>,
  );
}

describe('ModoAutomaticoNoChat (RN-889)', () => {
  // RN-901: a fixture é o roster REAL: activatedAgents sem dev, dev vindo do module_map.
  const daExecucao = execucaoDoRoster({
    executionActivated: true,
    moduleNames: ['core'],
    activatedAgents: ['criativo', 'po'],
  });

  it('caminho feliz: execução ativa noutra sessão do projeto, time em manual — a oferta aparece no chat do Criativo', async () => {
    montarCriativo(daExecucao);
    const botao = await screen.findByRole('button', { name: /Ligar para/ });
    await waitFor(() => expect(botao).not.toBeDisabled());
    expect(setAgentAutonomy).not.toHaveBeenCalled();
    fireEvent.click(botao);
    await waitFor(() =>
      expect(setAgentAutonomy).toHaveBeenCalledWith('proj-1', {
        agentId: 'dev-core',
        actionType: '*',
        mode: 'auto_approve',
      }),
    );
  });

  it('time todo já em automático: nada aparece', async () => {
    listAgentAutonomy.mockResolvedValue(
      agentesDoChat(daExecucao.ativados).map((agentId) => ({
        agentId,
        actionType: '*',
        mode: 'auto_approve',
      })),
    );
    montarCriativo(daExecucao);
    await waitFor(() => expect(listAgentAutonomy).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: /Ligar para/ })).toBeNull();
  });

  it('sem execução no projeto: nada aparece e nem a leitura acontece', () => {
    const { container } = montarCriativo({ ativa: false, ativados: ['dev-core'] });
    expect(container).toBeEmptyDOMElement();
    expect(listAgentAutonomy).not.toHaveBeenCalled();
  });
});

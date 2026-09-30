import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from '../lib/i18n';
import type { AgentAutonomyRule } from '../lib/api-types';

/**
 * RN-661 (AT-315): o modo automático oferecido EM LOTE no início da execução.
 * Oferta, não ligação: nada é gravado sem o clique; grava a MESMA curinga
 * (`"*"`) do toggle por agente, pelo MESMO endpoint; o desfecho é POR agente
 * (RN-469); e a tela diz o que o modo automático NÃO libera.
 */
const setAgentAutonomy = vi.fn();

vi.mock('../lib/api-client', () => ({
  setAgentAutonomy: (...args: unknown[]) => setAgentAutonomy(...args),
  mensagemDaApi: (erro: unknown, padrao: string) =>
    erro instanceof Error ? erro.message : padrao,
}));

const { ModoAutomaticoDoTime } = await import('./ModoAutomaticoDoTime');

function montar(
  props: Partial<{
    agentes: string[];
    autonomyRules: AgentAutonomyRule[];
    podeLigar: boolean;
  }> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ModoAutomaticoDoTime
        projectId="proj-1"
        agentes={props.agentes ?? ['dev-lead', 'dev-core', 'qa']}
        autonomyRules={props.autonomyRules ?? []}
        podeLigar={props.podeLigar ?? true}
      />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
  setAgentAutonomy.mockResolvedValue(undefined);
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

describe('ModoAutomaticoDoTime (RN-661)', () => {
  it('caminho feliz: nada é gravado ao montar; o clique grava a curinga para cada escolhido', async () => {
    montar();
    expect(setAgentAutonomy).not.toHaveBeenCalled();

    // Desmarcar um agente o tira do lote.
    fireEvent.click(screen.getByLabelText('QA'));
    fireEvent.click(screen.getByRole('button', { name: 'Ligar para 2 agentes' }));

    await waitFor(() => expect(setAgentAutonomy).toHaveBeenCalledTimes(2));
    expect(setAgentAutonomy).toHaveBeenNthCalledWith(1, 'proj-1', {
      agentId: 'dev-lead',
      actionType: '*',
      mode: 'auto_approve',
    });
    expect(setAgentAutonomy.mock.calls[1][1]).toMatchObject({ agentId: 'dev-core' });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Modo automático ligado para os 2 agentes',
    );
  });

  it('diz o que o modo automático NÃO libera, antes do clique', () => {
    montar();
    const nao = screen.getByTestId('modo-automatico-nao-libera');
    expect(nao).toHaveTextContent('merge em branch protegida');
    expect(nao).toHaveTextContent('git push, abertura de PR e deploy');
    expect(nao).toHaveTextContent('sudo e doas');
    expect(nao).toHaveTextContent('container_remove');
    expect(nao).toHaveTextContent('instruction_patch');
    expect(nao).toHaveTextContent('paralelizar');
  });

  it('CASO DE FALHA: a api recusa um agente — o desfecho diz quantos passaram e quem ficou em manual', async () => {
    setAgentAutonomy.mockImplementation((_p: string, input: { agentId: string }) =>
      input.agentId === 'dev-core'
        ? Promise.reject(new Error('403'))
        : Promise.resolve(undefined),
    );
    montar();

    fireEvent.click(screen.getByRole('button', { name: 'Ligar para 3 agentes' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Ligado para 2 de 3 agentes. Ficaram em manual: dev-core.',
    );
    // Não aborta na primeira recusa (RN-469): o terceiro também foi tentado.
    expect(setAgentAutonomy).toHaveBeenCalledTimes(3);
  });

  it('sem maintainer: o controle fica inerte e o motivo é dito em texto', () => {
    montar({ podeLigar: false });
    expect(screen.getByRole('button', { name: 'Ligar para 3 agentes' })).toBeDisabled();
    expect(screen.getByTestId('modo-automatico-sem-papel')).toHaveTextContent('maintainer');
  });

  it('quem já está em automático não é oferecido; todos em automático = nada a oferecer', () => {
    const { container } = montar({
      agentes: ['dev-lead'],
      autonomyRules: [{ agentId: 'dev-lead', actionType: '*', mode: 'auto_approve' }],
    });
    expect(container).toBeEmptyDOMElement();
  });
});

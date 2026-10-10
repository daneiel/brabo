import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from '../lib/i18n';
import { agentesDaOfertaEmLote } from './ModoAutomaticoDoTime';
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
    autonomyRules: AgentAutonomyRule[] | undefined;
    podeLigar: boolean;
  }> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ModoAutomaticoDoTime
        projectId="proj-1"
        agentes={props.agentes ?? ['dev-lead', 'dev-core', 'qa']}
        autonomyRules={'autonomyRules' in props ? props.autonomyRules : []}
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
    // RN-713: push e PR passaram para o que o modo automático libera.
    expect(nao).toHaveTextContent('deploy');
    expect(nao).not.toHaveTextContent('git push');
    expect(screen.getByTestId('piloto-libera')).toHaveTextContent(
      'git push e abertura de PR',
    );
    expect(nao).toHaveTextContent('sudo e doas');
    expect(nao).toHaveTextContent('container_remove');
    expect(nao).toHaveTextContent('instruction_patch');
    expect(nao).toHaveTextContent('paralelizar');
    expect(nao).toHaveTextContent('deny');
  });

  it('diz o que o PILOTO libera — commit e branch local, composto sem regra, e que "Sempre permitir" não o desliga (RN-670)', () => {
    montar();
    const libera = screen.getByTestId('piloto-libera');
    expect(libera).toHaveTextContent('mesmo com caminho fora da pasta do projeto');
    expect(libera).toHaveTextContent('comando composto com segmento sem regra');
    expect(libera).toHaveTextContent('git commit e criar branch LOCAL');
    expect(libera).toHaveTextContent('"Sempre permitir" neste agente não desliga o piloto');
    // A MESMA lista, sem um segundo texto: aqui ela vem aberta.
    expect(screen.queryByTestId('piloto-detalhe')).toBeNull();
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

  it('AT-477 (RN-803): antes de a leitura de agent_autonomy chegar, o botão fica inerte e diz por quê', async () => {
    const { rerender } = montar({ autonomyRules: undefined });
    const botao = screen.getByRole('button', { name: 'Ligar para 3 agentes' });
    expect(botao).toBeDisabled();
    expect(screen.getByTestId('modo-automatico-carregando')).toHaveTextContent('Lendo');
    fireEvent.click(botao);
    expect(setAgentAutonomy).not.toHaveBeenCalled();

    // A leitura chega: o botão liga e o clique grava e diz o desfecho.
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ModoAutomaticoDoTime
          projectId="proj-1"
          agentes={['dev-lead', 'dev-core', 'qa']}
          autonomyRules={[]}
          podeLigar
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('modo-automatico-carregando')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ligar para 3 agentes' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Modo automático ligado');
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

describe('agentesDaOfertaEmLote (AT-449, RN-766)', () => {
  it('cobre os subagentes de QA desde a ativação, antes de aparecerem no roster', () => {
    expect(agentesDaOfertaEmLote(['dev-lead', 'dev-api'])).toEqual([
      'dev-lead',
      'dev-api',
      'qa',
      'qa-automacao',
      'qa-performance-seguranca',
    ]);
  });

  it('não repete quem já está no time', () => {
    expect(agentesDaOfertaEmLote(['qa-automacao'])).toEqual([
      'qa-automacao',
      'qa',
      'qa-performance-seguranca',
    ]);
  });
});

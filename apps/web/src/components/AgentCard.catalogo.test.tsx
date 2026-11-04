import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentCard } from './AgentCard';
import { AGENTS } from '../lib/agents';
import i18n from '../lib/i18n';
import * as api from '../lib/api-client';

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});

const agente = (extra = {}) => ({
  agente: 'criativo',
  identidade: 'Você é o Criativo.',
  instrucoesDoProjeto: { versao: 3, conteudo: 'abc' },
  ferramentas: [{ nome: 'rag_search', descricao: 'Busca no projeto' }],
  ...extra,
});

function montar(resposta: unknown) {
  const spy = vi.spyOn(api, 'getAgentCatalog').mockResolvedValue(resposta as never);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AgentCard agent={AGENTS.criativo} status="ocioso" projectId="p1" agentSlug="criativo" />
      <AgentCard agent={AGENTS.criativo} status="ocioso" projectId="p1" agentSlug="criativo" />
    </QueryClientProvider>,
  );
  return spy;
}

function abrir(titulo: string) {
  const d = screen.getAllByText(titulo)[0].closest('details') as HTMLDetailsElement;
  d.open = true;
  fireEvent(d, new Event('toggle'));
}

describe('AgentCard: catálogo', () => {
  it('caminho feliz: uma requisição só para dois cards', async () => {
    const spy = montar({ agentes: [agente()] });
    expect(spy).not.toHaveBeenCalled();
    abrir('Instruções');
    expect(await screen.findAllByText('Você é o Criativo.')).not.toHaveLength(0);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('engine fora: ferramentas null não viram "sem ferramentas"', async () => {
    montar({ agentes: [agente({ ferramentas: null, identidade: null })], motivoSemCatalogo: 'engine_indisponivel' });
    abrir('Ferramentas');
    await waitFor(() =>
      expect(screen.getAllByText('Não foi possível ler as ferramentas agora.')).not.toHaveLength(0),
    );
    expect(screen.queryByText('Este agente não tem ferramentas.')).toBeNull();
  });

  it('instrução cortada diz quantos caracteres faltam', async () => {
    montar({ agentes: [agente({ instrucoesDoProjeto: { versao: 1, conteudo: 'abc', conteudoTotal: 10 } })] });
    abrir('Instruções');
    expect((await screen.findAllByText('Faltam 7 caracteres (texto cortado)')).length).toBeGreaterThan(0);
  });
});

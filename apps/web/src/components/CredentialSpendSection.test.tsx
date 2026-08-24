import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import {
  CredentialSpendSection,
  formatarMes,
  formatarUsd,
} from './CredentialSpendSection';
// A instância REAL do app: o componente usa `useTranslation('models')` sem
// `I18nextProvider` próprio, e `formatarUsd`/`formatarMes` chamam
// `i18n.t`/`i18n.language` direto no singleton — mesmo padrão de
// `ProjectExecutorsTab.test.tsx`.
import i18n from '../lib/i18n';
import type { CredentialSpend } from '../lib/api-types';

const getCredentialSpend = vi.fn();

vi.mock('../lib/api-client', () => ({
  getCredentialSpend: (...a: unknown[]) => getCredentialSpend(...a),
}));

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CredentialSpendSection workspaceId="ws-1" />
    </QueryClientProvider>,
  );
}

const relatorio: CredentialSpend = {
  workspaceId: 'ws-1',
  ownerId: 'u-1',
  meses: 6,
  totalMicros: 1_250_000,
  porProvider: [
    {
      provider: 'openrouter',
      temCredencial: true,
      costMicros: 1_250_000,
      inputTokens: 10,
      outputTokens: 5,
      chamadas: 42,
      costMicrosAgentes: 900_000,
      costMicrosPessoas: 350_000,
      porMes: [{ mes: '2026-08-01T00:00:00.000Z', costMicros: 1_250_000, chamadas: 42 }],
    },
  ],
};

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
  getCredentialSpend.mockResolvedValue(relatorio);
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

/**
 * O relatório existe porque a RN-058 mudou de quem é a conta: os agentes
 * gastam a chave do owner do workspace. Quem paga precisa ver o que saiu.
 */
describe('CredentialSpendSection', () => {
  it('mostra o total e a quebra por provider', async () => {
    montar();

    // O mesmo valor aparece no total, na linha do provider e no mês — é a
    // mesma conta vista de três ângulos, e o teste não escolhe um deles.
    expect((await screen.findAllByText('US$ 1,25')).length).toBeGreaterThan(0);
    expect(screen.getByText('OpenRouter')).toBeTruthy();
  });

  /** As duas saem da MESMA chave, e a pergunta de cada uma é diferente. */
  it('separa o que gastou agente do que gastou você no chat', async () => {
    montar();
    await screen.findByText('OpenRouter');

    expect(screen.getByText('US$ 0,90')).toBeTruthy();
    expect(screen.getByText('US$ 0,35')).toBeTruthy();
  });

  it('gasto de chave já removida é marcado, e não some', async () => {
    getCredentialSpend.mockResolvedValue({
      ...relatorio,
      porProvider: [{ ...relatorio.porProvider[0], temCredencial: false }],
    });
    montar();

    expect(await screen.findByText('chave não cadastrada')).toBeTruthy();
    expect(screen.getAllByText('US$ 1,25').length).toBeGreaterThan(0);
  });

  it('sem gasto nenhum explica, em vez de mostrar tabela vazia', async () => {
    getCredentialSpend.mockResolvedValue({
      ...relatorio,
      totalMicros: 0,
      porProvider: [],
    });
    montar();

    expect(await screen.findByText(/Nenhuma chamada de LLM registrada/)).toBeTruthy();
  });

  it('falha de leitura não sugere que o consumo se perdeu', async () => {
    getCredentialSpend.mockRejectedValue(new Error('502'));
    montar();

    expect(
      await screen.findByText(/O consumo continua registrado/),
    ).toBeTruthy();
  });
});

/**
 * O bucket do mês vem de `date_trunc('month', …)` em UTC. Renderizar no fuso
 * local jogava 1º de agosto às 00:00Z para 31 de julho: o relatório mostrava
 * o mês anterior, sempre, para quem está a oeste de Greenwich.
 */
describe('formatarMes', () => {
  it('mostra o mês do BUCKET, não o do fuso de quem olha', () => {
    expect(formatarMes('2026-08-01T00:00:00.000Z')).toContain('ago');
    expect(formatarMes('2026-01-01T00:00:00.000Z')).toContain('jan');
  });
});

describe('formatarUsd', () => {
  /** Sub-centavo virando `US$ 0,00` apagaria a diferença que o relatório mostra. */
  it('abaixo de um centavo não vira zero', () => {
    // `Intl.NumberFormat('pt-BR', …)` separa símbolo e valor com NBSP
    // (U+00A0), não espaço comum — comparação exata precisa do caractere real.
    expect(formatarUsd(0)).toBe('US$ 0,00');
    expect(formatarUsd(1_811)).toBe('< US$ 0,01');
    expect(formatarUsd(1_250_000)).toBe('US$ 1,25');
  });
});

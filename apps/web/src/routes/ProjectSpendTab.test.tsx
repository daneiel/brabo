import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../lib/i18n';
import { ProjectSpendTab } from './ProjectSpendTab';
import type { MySpend, WorkspaceSpendReport } from '../lib/spend';

/**
 * A instância REAL do i18next, não uma isolada como em `AccountPage.test.tsx`
 * — `lib/spend.ts` (`rotuloDoAtor`/`tituloDoDia`/`alertaDeOrcamento`) é módulo
 * NÃO-React e resolve texto direto no singleton de `../lib/i18n` (mesmo
 * padrão de `session-kind.ts`), fora do contexto de qualquer
 * `I18nextProvider` local. Uma instância isolada aqui divergiria da língua
 * usada por essas funções, e o texto renderizado ficaria metade num idioma,
 * metade noutro. `changeLanguage('pt-BR')` mantém as asserções abaixo
 * idênticas ao texto que já existia antes da extração.
 */
beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});

const getMySpend = vi.fn();
const getWorkspaceSpendReport = vi.fn();
const getProject = vi.fn();
const getProjectBudget = vi.fn();
const getCredentialSpend = vi.fn();
const listWorkspaces = vi.fn();
const getProjectSpendTeam = vi.fn();
const setProjectBudget = vi.fn();
const listModelCatalog = vi.fn();

vi.mock('../lib/api-client', () => ({
  getMySpend: (...a: unknown[]) => getMySpend(...a),
  getWorkspaceSpendReport: (...a: unknown[]) => getWorkspaceSpendReport(...a),
  getProject: (...a: unknown[]) => getProject(...a),
  getProjectBudget: (...a: unknown[]) => getProjectBudget(...a),
  getCredentialSpend: (...a: unknown[]) => getCredentialSpend(...a),
  listWorkspaces: (...a: unknown[]) => listWorkspaces(...a),
  getProjectSpendTeam: (...a: unknown[]) => getProjectSpendTeam(...a),
  setProjectBudget: (...a: unknown[]) => setProjectBudget(...a),
  listModelCatalog: (...a: unknown[]) => listModelCatalog(...a),
}));

function serie(dias: number) {
  return Array.from({ length: dias }, (_, i) => ({
    dia: `2026-08-${String(i + 1).padStart(2, '0')}`,
    costMicros: i * 1_000,
    chamadas: i,
  }));
}

const doWorkspace: WorkspaceSpendReport = {
  workspaceId: 'ws-1',
  ownerId: 'u-dono',
  dias: 30,
  totalMicros: 2_500_000,
  inputTokens: 1_000,
  outputTokens: 400,
  chamadas: 42,
  porModelo: [
    {
      chave: 'caro/modelo',
      rotulo: null,
      actorKind: null,
      costMicros: 2_000_000,
      inputTokens: 800,
      outputTokens: 300,
      chamadas: 30,
    },
  ],
  porProjeto: [
    {
      chave: 'p-1',
      rotulo: 'Loja',
      actorKind: null,
      costMicros: 2_500_000,
      inputTokens: 1_000,
      outputTokens: 400,
      chamadas: 42,
    },
  ],
  porProvider: [
    {
      chave: 'anthropic',
      rotulo: null,
      actorKind: null,
      costMicros: 2_500_000,
      inputTokens: 1_000,
      outputTokens: 400,
      chamadas: 42,
    },
  ],
  porAtor: [
    {
      chave: 'criativo',
      rotulo: null,
      actorKind: 'agent',
      costMicros: 2_000_000,
      inputTokens: 800,
      outputTokens: 300,
      chamadas: 30,
    },
    {
      chave: 'a1b2c3d4-0000-0000-0000-000000000000',
      rotulo: null,
      actorKind: 'user',
      costMicros: 500_000,
      inputTokens: 200,
      outputTokens: 100,
      chamadas: 12,
    },
  ],
  porOwner: [
    {
      chave: 'a1b2c3d4-0000-0000-0000-000000000000',
      rotulo: null,
      actorKind: 'user',
      costMicros: 500_000,
      inputTokens: 200,
      outputTokens: 100,
      chamadas: 12,
    },
  ],
  porAgente: [
    {
      chave: 'criativo',
      rotulo: null,
      actorKind: 'agent',
      costMicros: 2_000_000,
      inputTokens: 800,
      outputTokens: 300,
      chamadas: 30,
    },
  ],
  porDia: serie(5),
};

const meu: MySpend = {
  projectId: 'p-1',
  dias: 30,
  actorId: 'u-membro',
  totalMicros: 700,
  inputTokens: 10,
  outputTokens: 5,
  chamadas: 1,
  porSessao: [
    {
      chave: 'a1b2c3d4-1111-2222-3333-444455556666',
      rotulo: null,
      actorKind: null,
      costMicros: 700,
      inputTokens: 10,
      outputTokens: 5,
      chamadas: 1,
    },
  ],
  porDia: serie(5),
};

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ProjectSpendTab projectId="p-1" />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getProject.mockResolvedValue({ id: 'p-1', workspaceId: 'ws-1' });
  getWorkspaceSpendReport.mockResolvedValue(doWorkspace);
  getMySpend.mockResolvedValue(meu);
  listModelCatalog.mockResolvedValue({});
  getProjectSpendTeam.mockResolvedValue({
    projectId: 'p-1',
    dias: 30,
    totalMicros: 3_000_000,
    inputTokens: 100,
    outputTokens: 50,
    chamadas: 9,
    porAgente: [
      { chave: 'criativo', rotulo: null, actorKind: 'agent', costMicros: 3_000_000, inputTokens: 100, outputTokens: 50, chamadas: 9 },
    ],
    porArea: [
      { chave: 'produto', rotulo: null, actorKind: null, costMicros: 3_000_000, inputTokens: 100, outputTokens: 50, chamadas: 9 },
    ],
  });
  // Sem orçamento por padrão: a maioria dos testes não é sobre o bloco
  // "por projeto" — cada teste dele sobrescreve.
  getProjectBudget.mockResolvedValue(null);
  getCredentialSpend.mockResolvedValue({
    workspaceId: 'ws-1',
    ownerId: 'u-dono',
    meses: 6,
    totalMicros: 0,
    porProvider: [],
  });
});

describe('ProjectSpendTab — enquanto o papel é desconhecido', () => {
  /**
   * Ramificar antes de saber o papel cairia na visão do MEMBRO e dispararia a
   * requisição dela, para depois trocar tudo — um pedido inútil por montagem e
   * um piscar de conteúdo errado.
   */
  it('não escolhe audiência nenhuma, e não pede nada', async () => {
    let liberar: (v: unknown) => void = () => {};
    listWorkspaces.mockReturnValue(
      new Promise((resolve) => {
        liberar = resolve;
      }),
    );

    montar();

    expect(await screen.findByText('Carregando…')).toBeInTheDocument();
    expect(getMySpend).not.toHaveBeenCalled();
    expect(getWorkspaceSpendReport).not.toHaveBeenCalled();
    // O orçamento é de PROJETO, mas só entra depois do papel resolver — senão
    // pediria antes de saber se há algo mais pra mostrar ao lado dele.
    expect(getProjectBudget).not.toHaveBeenCalled();

    liberar([{ id: 'ws-1', role: 'developer' }]);
    expect(await screen.findByText('O meu consumo')).toBeInTheDocument();
  });

  it('papel indisponível vira erro com botão, não a visão errada', async () => {
    listWorkspaces.mockRejectedValue(new Error('429'));

    montar();

    expect(
      await screen.findByText(/Não consegui descobrir o seu papel/i),
    ).toBeInTheDocument();
    expect(getMySpend).not.toHaveBeenCalled();
    expect(getWorkspaceSpendReport).not.toHaveBeenCalled();
  });
});

describe('ProjectSpendTab — a audiência do owner', () => {
  beforeEach(() => {
    listWorkspaces.mockResolvedValue([{ id: 'ws-1', role: 'owner' }]);
  });

  it('mostra os cinco recortes do workspace, incluindo provider', async () => {
    montar();

    expect(await screen.findByText('Gastos do projeto')).toBeInTheDocument();
    expect(await screen.findByText('Por modelo')).toBeInTheDocument();
    expect(screen.getByText('Por provider')).toBeInTheDocument();
    // SÓ o projeto (RN-952): recorte por sessão no lugar do por projeto.
    expect(screen.getByText('Por sessão')).toBeInTheDocument();
    expect(screen.queryByText('Por projeto')).not.toBeInTheDocument();
    expect(getWorkspaceSpendReport).toHaveBeenCalledWith('ws-1', 30, 'p-1');
    expect(screen.getByText('Por agente e pessoa')).toBeInTheDocument();
    expect(screen.getByText('Gasto por dia')).toBeInTheDocument();

    expect(screen.getByText('caro/modelo')).toBeInTheDocument();
    // RN-211: o rótulo humano do provider, não o slug cru.
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
    expect(screen.getByText('criativo')).toBeInTheDocument();
    expect(screen.getByText('a1b2c3d4 (pessoa)')).toBeInTheDocument();
  });

  /** A fatura por chave é GLOBAL (página Gastos): a aba do projeto não a traz. */
  it('não traz a seção de credencial, e nunca chama a rota do membro', async () => {
    montar();

    await screen.findByText('Gastos do projeto');
    expect(screen.queryByText('Gasto das suas chaves')).not.toBeInTheDocument();
    expect(getCredentialSpend).not.toHaveBeenCalled();
    expect(getMySpend).not.toHaveBeenCalled();
    expect(getProjectSpendTeam).not.toHaveBeenCalled();
  });

  it('modelo de assinatura sem preço aparece "assinatura — sem preço registrado", nunca US$ 0', async () => {
    getWorkspaceSpendReport.mockResolvedValue({
      ...doWorkspace,
      porModelo: [
        { chave: 'cc/claude', rotulo: null, actorKind: null, costMicros: 0, inputTokens: 5, outputTokens: 5, chamadas: 2 },
      ],
    });
    listModelCatalog.mockResolvedValue({
      chat: { '9router': [{ name: 'cc/claude', billing: 'subscription' }] },
    });
    montar();

    expect(await screen.findByText('assinatura — sem preço registrado')).toBeInTheDocument();
  });
});

describe('ProjectSpendTab — a audiência do membro', () => {
  beforeEach(() => {
    listWorkspaces.mockResolvedValue([{ id: 'ws-1', role: 'developer' }]);
  });

  /**
   * O membro não pede a rota de owner nem a de credencial: pedir um 403 de
   * propósito é ruído no log de segurança, e a tela sabe que não é para ele.
   */
  it('mostra só o próprio consumo, sem provider e sem tocar a rota do owner', async () => {
    montar();

    expect(await screen.findByText('O meu consumo')).toBeInTheDocument();
    expect(await screen.findByText('Por sessão')).toBeInTheDocument();
    expect(screen.getByText('#a1b2c3d4')).toBeInTheDocument();
    // ADR 0233: o total do projeto e o custo por agente e por área.
    expect(await screen.findByText('Por agente')).toBeInTheDocument();
    expect(screen.getByText('Por área')).toBeInTheDocument();
    expect(getProjectSpendTeam).toHaveBeenCalledWith('p-1', 30);

    expect(getWorkspaceSpendReport).not.toHaveBeenCalled();
    expect(getCredentialSpend).not.toHaveBeenCalled();
    expect(screen.queryByText('Por provider')).not.toBeInTheDocument();
    expect(screen.queryByText('Por modelo')).not.toBeInTheDocument();
    expect(screen.queryByText('Gasto das suas chaves')).not.toBeInTheDocument();
    expect(getMySpend).toHaveBeenCalledWith('p-1', 30);
  });

  it('diz que o custo é estimado e por que não há provider', async () => {
    montar();

    expect(
      await screen.findByText(/quem paga a chamada é a chave do dono/i),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/não há quebra por provider nem por credencial/i),
    ).toBeInTheDocument();
  });

  /** RN-088: carregando, erro e vazio são três estados, e o erro vem antes. */
  it('erro tem mensagem e botão, e não cai no vazio', async () => {
    getMySpend.mockRejectedValue(new Error('429'));
    montar();

    expect(
      await screen.findByText(/Não consegui carregar o seu consumo agora/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Tentar de novo' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Por sessão')).not.toBeInTheDocument();
  });

  it('sem consumo, explica de quem é a conta em vez de mostrar zero mudo', async () => {
    getMySpend.mockResolvedValue({
      ...meu,
      totalMicros: 0,
      chamadas: 0,
      porSessao: [],
    });
    montar();

    expect(
      await screen.findByText(/sai da chave do dono do workspace/i),
    ).toBeInTheDocument();
  });
});

/**
 * O bloco "por projeto" (RN-212) e o alerta de custo (RN-213). É de PROJETO,
 * não de audiência — os testes cobrem só a audiência do owner (papel mais
 * simples de montar), mas o bloco é o MESMO componente para as duas.
 */
describe('ProjectSpendTab — o orçamento do projeto', () => {
  beforeEach(() => {
    listWorkspaces.mockResolvedValue([{ id: 'ws-1', role: 'owner' }]);
  });

  it('sem orçamento definido, mostra a nota em vez do medidor', async () => {
    getProjectBudget.mockResolvedValue(null);
    montar();

    expect(
      await screen.findByText(/Nenhum orçamento definido para este projeto/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('token-meter')).not.toBeInTheDocument();
  });

  it('com orçamento abaixo de 70%, mostra o medidor sem alerta', async () => {
    getProjectBudget.mockResolvedValue({
      id: 'b-1',
      projectId: 'p-1',
      sessionId: null,
      limitMicros: 10_000_000,
      spentMicros: 2_000_000,
      policy: 'allow',
      lastThresholdNotified: 0,
    });
    montar();

    expect(await screen.findByTestId('token-meter')).toBeInTheDocument();
    expect(
      screen.queryByText(/já passou de/i),
    ).not.toBeInTheDocument();
  });

  /** RN-213: leitura pura de `lastThresholdNotified`, nunca recalculado aqui. */
  it('cruzou 90%, mostra o alerta de nível danger', async () => {
    getProjectBudget.mockResolvedValue({
      id: 'b-1',
      projectId: 'p-1',
      sessionId: null,
      limitMicros: 10_000_000,
      spentMicros: 9_200_000,
      policy: 'allow',
      lastThresholdNotified: 90,
    });
    montar();

    const alerta = await screen.findByText(/já passou de 90%/i);
    expect(alerta.closest('[role="alert"]')).not.toBeNull();
  });

  it('política block e teto atingido, avisa que novas chamadas estão bloqueadas', async () => {
    getProjectBudget.mockResolvedValue({
      id: 'b-1',
      projectId: 'p-1',
      sessionId: null,
      limitMicros: 10_000_000,
      spentMicros: 10_000_000,
      policy: 'block',
      lastThresholdNotified: 100,
    });
    montar();

    expect(
      await screen.findByText(/estão BLOQUEADAS até o teto subir/i),
    ).toBeInTheDocument();
  });

  /** 403 (quem não é maintainer no projeto) fica silencioso — nunca banner. */
  it('erro ao ler o orçamento não vira banner nenhum', async () => {
    getProjectBudget.mockRejectedValue(new Error('403'));
    montar();

    await screen.findByText('Gastos do projeto');
    expect(
      screen.queryByText(/Nenhum orçamento definido/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('token-meter')).not.toBeInTheDocument();
  });
});

describe('ProjectSpendTab — o editor do orçamento', () => {
  it('maintainer+ grava o teto (PUT) e a política escolhida', async () => {
    listWorkspaces.mockResolvedValue([{ id: 'ws-1', role: 'owner' }]);
    setProjectBudget.mockResolvedValue({});
    montar();

    const campo = await screen.findByLabelText(/Teto em US\$/);
    fireEvent.change(campo, { target: { value: '12,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar orçamento' }));

    await waitFor(() =>
      expect(setProjectBudget).toHaveBeenCalledWith('p-1', { limitUsd: 12.5, policy: 'block' }),
    );
    expect(await screen.findByText('Orçamento salvo.')).toBeInTheDocument();
  });

  it('teto inválido não chama a api', async () => {
    listWorkspaces.mockResolvedValue([{ id: 'ws-1', role: 'owner' }]);
    montar();

    await screen.findByLabelText(/Teto em US\$/);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar orçamento' }));

    expect(await screen.findByText('Informe um teto maior que zero.')).toBeInTheDocument();
    expect(setProjectBudget).not.toHaveBeenCalled();
  });

  it('abaixo de maintainer o controle fica inerte e o motivo é dito em texto', async () => {
    listWorkspaces.mockResolvedValue([{ id: 'ws-1', role: 'developer' }]);
    montar();

    expect(await screen.findByText(/exige o papel de maintainer/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Teto em US\$/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Salvar orçamento' })).toBeDisabled();
  });
});

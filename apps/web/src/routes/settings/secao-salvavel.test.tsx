import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import settingsPtBR from '../../locales/pt-BR/settings.json';
import { ToastProvider } from '../../components/ui/ToastProvider';
import { ApiError } from '../../lib/api-client';

const listAgentAreas = vi.fn();
const setAreaMaxParallel = vi.fn();
const setAreaBudget = vi.fn();

vi.mock('../../lib/api-client', async () => {
  // `mensagemDaApi` e `ApiError` entram de verdade: o desfecho parcial precisa
  // mostrar a mensagem que a api DEU, e é a extração dela que se exercita aqui.
  const real =
    await vi.importActual<typeof import('../../lib/api-client')>(
      '../../lib/api-client',
    );
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    listAgentAreas: (...args: unknown[]) => listAgentAreas(...args),
    setAreaMaxParallel: (...args: unknown[]) => setAreaMaxParallel(...args),
    setAreaBudget: (...args: unknown[]) => setAreaBudget(...args),
  };
});

const { ParallelismSection } = await import('./ParallelismSection');
const { BudgetSection } = await import('./BudgetSection');

function montarSecao(secao: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    resources: { 'pt-BR': { settings: settingsPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'settings',
    ns: ['settings'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ToastProvider>{secao}</ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

function area(over: Record<string, unknown> = {}) {
  return {
    id: 'area-1',
    projectId: 'proj-1',
    key: 'dev',
    leadAgentId: 'dev-lead',
    maxParallel: 2,
    budgetMicros: null,
    spentMicros: 0,
    members: ['dev-api'],
    ...over,
  };
}

const areaQa = area({
  id: 'area-2',
  key: 'qa',
  leadAgentId: 'qa-lead',
  maxParallel: 3,
  budgetMicros: 5_000_000,
});

function tetoDe(chave: string) {
  return screen.getByLabelText(`Teto de agentes da área ${chave}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  listAgentAreas.mockResolvedValue([area(), areaQa]);
  setAreaMaxParallel.mockResolvedValue({});
  setAreaBudget.mockResolvedValue({});
});

/**
 * O contador é a contrapartida de trocar N botões por um: sem ele, "Salvar"
 * fica idêntico com uma linha suja e com cinco.
 */
describe('marca de alterações não salvas', () => {
  it('conta as linhas sujas, e não só diz que há algo pendente', async () => {
    montarSecao(<ParallelismSection projectId="proj-1" />);
    await screen.findByLabelText('Teto de agentes da área dev');

    // Nada editado: a marca não existe.
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.change(tetoDe('dev'), { target: { value: '5' } });
    expect(
      await screen.findByText('1 alteração não salva nesta seção'),
    ).toBeInTheDocument();

    fireEvent.change(tetoDe('qa'), { target: { value: '6' } });
    expect(
      await screen.findByText('2 alterações não salvas nesta seção'),
    ).toBeInTheDocument();
  });

  it('voltar ao valor do servidor limpa a marca — a comparação é por VALOR', async () => {
    // `2` e `2.0` são o mesmo teto: comparar TEXTO deixaria a seção suja para
    // sempre e mandaria uma chamada que a api trata como no-op.
    montarSecao(<ParallelismSection projectId="proj-1" />);
    await screen.findByLabelText('Teto de agentes da área dev');

    fireEvent.change(tetoDe('dev'), { target: { value: '5' } });
    expect(
      await screen.findByText('1 alteração não salva nesta seção'),
    ).toBeInTheDocument();

    fireEvent.change(tetoDe('dev'), { target: { value: '2.0' } });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });

  it('valor inválido substitui a contagem pelo que BLOQUEIA o botão', async () => {
    montarSecao(<ParallelismSection projectId="proj-1" />);
    await screen.findByLabelText('Teto de agentes da área dev');

    fireEvent.change(tetoDe('dev'), { target: { value: '5' } });
    fireEvent.change(tetoDe('qa'), { target: { value: '0' } });

    expect(
      await screen.findByText('1 valor inválido — corrija para salvar'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/alterações não salvas/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
    expect(setAreaMaxParallel).not.toHaveBeenCalled();
  });
});

describe('um salvar por seção', () => {
  it('um clique persiste TODAS as linhas sujas, e só elas', async () => {
    montarSecao(<ParallelismSection projectId="proj-1" />);
    await screen.findByLabelText('Teto de agentes da área dev');

    fireEvent.change(tetoDe('dev'), { target: { value: '5' } });
    fireEvent.change(tetoDe('qa'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(setAreaMaxParallel).toHaveBeenCalledTimes(2));
    expect(setAreaMaxParallel).toHaveBeenNthCalledWith(1, 'proj-1', 'dev', 5);
    expect(setAreaMaxParallel).toHaveBeenNthCalledWith(2, 'proj-1', 'qa', 6);
    expect(await screen.findByText('2 alterações salvas')).toBeInTheDocument();
  });

  it('o teto de gasto salva número e null no mesmo clique', async () => {
    // `null` é um VALOR aqui ("sem teto"), não uma linha por salvar: limpar o
    // teto de qa tem de sair na mesma leva que definir o de dev.
    montarSecao(<BudgetSection projectId="proj-1" />);
    const dev = await screen.findByLabelText(
      'Teto de gasto da área dev, em dólares',
    );
    const qa = screen.getByLabelText('Teto de gasto da área qa, em dólares');

    fireEvent.change(dev, { target: { value: '30' } });
    fireEvent.change(qa, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(setAreaBudget).toHaveBeenCalledTimes(2));
    expect(setAreaBudget).toHaveBeenNthCalledWith(1, 'proj-1', 'dev', 30);
    expect(setAreaBudget).toHaveBeenNthCalledWith(2, 'proj-1', 'qa', null);
  });
});

/**
 * As N chamadas não são uma transação, e não há endpoint que as torne uma. O
 * que a tela deve, então, é nunca afirmar um desfecho que não obteve.
 */
describe('falha parcial', () => {
  function recusaQa() {
    setAreaMaxParallel.mockImplementation(
      (_projectId: string, chave: string) =>
        chave === 'qa'
          ? Promise.reject(
              new ApiError(400, { message: 'max_parallel precisa ser <= 8' }),
            )
          : Promise.resolve({}),
    );
  }

  it('não diz "salvo": diz quantas de quantas e NOMEIA a que ficou', async () => {
    recusaQa();
    montarSecao(<ParallelismSection projectId="proj-1" />);
    await screen.findByLabelText('Teto de agentes da área dev');

    fireEvent.change(tetoDe('dev'), { target: { value: '5' } });
    fireEvent.change(tetoDe('qa'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('Salvou 1 de 2')).toBeInTheDocument();
    expect(
      screen.getByText('Não salvou: qa. max_parallel precisa ser <= 8'),
    ).toBeInTheDocument();
    expect(screen.queryByText('2 alterações salvas')).toBeNull();
  });

  it('a seção continua marcada como não salva pelas linhas que falharam', async () => {
    recusaQa();
    montarSecao(<ParallelismSection projectId="proj-1" />);
    await screen.findByLabelText('Teto de agentes da área dev');

    fireEvent.change(tetoDe('dev'), { target: { value: '5' } });
    fireEvent.change(tetoDe('qa'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    // De 2 para 1: o rascunho confirmado some, o recusado permanece — e é ele
    // que ainda aparece no campo, para não perder o que a pessoa digitou.
    expect(
      await screen.findByText('1 alteração não salva nesta seção'),
    ).toBeInTheDocument();
    expect(tetoDe('qa')).toHaveValue(9);
  });

  it('clicar de novo tenta SÓ a linha que faltou', async () => {
    recusaQa();
    montarSecao(<ParallelismSection projectId="proj-1" />);
    await screen.findByLabelText('Teto de agentes da área dev');

    fireEvent.change(tetoDe('dev'), { target: { value: '5' } });
    fireEvent.change(tetoDe('qa'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Salvou 1 de 2');

    setAreaMaxParallel.mockClear();
    setAreaMaxParallel.mockResolvedValue({});
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(setAreaMaxParallel).toHaveBeenCalledTimes(1));
    expect(setAreaMaxParallel).toHaveBeenCalledWith('proj-1', 'qa', 9);
  });

  it('uma falha NÃO interrompe as linhas seguintes', async () => {
    // Abortar na primeira recusa deixaria linhas sem tentativa nenhuma, e a
    // tela não teria como dizer quais.
    setAreaMaxParallel.mockImplementation((_p: string, chave: string) =>
      chave === 'dev'
        ? Promise.reject(new ApiError(500, { message: 'indisponível' }))
        : Promise.resolve({}),
    );
    montarSecao(<ParallelismSection projectId="proj-1" />);
    await screen.findByLabelText('Teto de agentes da área dev');

    fireEvent.change(tetoDe('dev'), { target: { value: '5' } });
    fireEvent.change(tetoDe('qa'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(setAreaMaxParallel).toHaveBeenCalledTimes(2));
    expect(setAreaMaxParallel).toHaveBeenCalledWith('proj-1', 'qa', 6);
    expect(await screen.findByText('Salvou 1 de 2')).toBeInTheDocument();
  });

  it('nenhuma passando, o toast é a mensagem da API — não a contagem', async () => {
    setAreaMaxParallel.mockRejectedValue(
      new ApiError(400, { message: 'max_parallel precisa ser inteiro >= 1' }),
    );
    montarSecao(<ParallelismSection projectId="proj-1" />);
    await screen.findByLabelText('Teto de agentes da área dev');

    fireEvent.change(tetoDe('dev'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(
      await screen.findByText('max_parallel precisa ser inteiro >= 1'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Salvou/)).toBeNull();
    expect(
      screen.getByText('1 alteração não salva nesta seção'),
    ).toBeInTheDocument();
  });
});

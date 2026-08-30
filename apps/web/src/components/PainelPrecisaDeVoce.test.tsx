import { useState } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
// Instância REAL do app (mesmo motivo de `ApprovalCard.test.tsx`, que este
// teste monta por dentro): as asserções conferem o texto em pt-BR de verdade.
import i18n from '../lib/i18n';
import { PainelPrecisaDeVoce } from './PainelPrecisaDeVoce';
import { montarFilas } from '../lib/precisa-de-voce';
import type {
  ArchitecturePendency,
  Epic,
  ProposedAction,
  PsychologistHypothesis,
  Story,
} from '../lib/api-types';

const approveAction = vi.fn();
const denyAction = vi.fn();
const approveAlwaysAction = vi.fn();

vi.mock('../lib/api-client', () => ({
  approveAction: (...args: unknown[]) => approveAction(...args),
  denyAction: (...args: unknown[]) => denyAction(...args),
  approveAlwaysAction: (...args: unknown[]) => approveAlwaysAction(...args),
}));

function acao(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'acao-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    seq: 1,
    actionType: 'terminal',
    payload: { command: 'pnpm test' },
    status: 'pending',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'dev-api' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: '2026-08-30T10:00:00.000Z',
    updatedAt: '2026-08-30T10:00:00.000Z',
    ...overrides,
  };
}

function historia(overrides: Partial<Story> = {}): Story {
  return {
    id: 'story-1',
    epicId: 'epic-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    title: 'Checkout com um clique',
    description: '',
    rf: [],
    rnf: [],
    businessRuleIds: [],
    dod: [],
    dor: [],
    status: 'draft',
    proposedReady: true,
    returnedReason: null,
    returnedAt: null,
    createdAt: '2026-08-30T08:00:00.000Z',
    updatedAt: '2026-08-30T09:00:00.000Z',
    tasks: [],
    ...overrides,
  };
}

function epico(stories: Story[]): Epic {
  return {
    id: 'epic-1',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    title: 'Checkout',
    description: '',
    createdAt: '2026-08-30T08:00:00.000Z',
    updatedAt: '2026-08-30T08:00:00.000Z',
    stories,
  };
}

const HIPOTESE: PsychologistHypothesis = {
  id: 'hip-1',
  projectId: 'proj-1',
  sessionId: 'sess-1',
  analysisId: 'an-1',
  agenteAlvo: 'dev-api',
  observacao: '',
  hipotese: 'O agente reescreve o teste em vez do código',
  sugestao: '',
  confiancaPercent: 70,
  evidenceEventIds: [],
  terminationAnalysis: null,
  status: 'proposed',
  decidedBy: null,
  decidedAt: null,
  createdAt: '2026-08-30T07:00:00.000Z',
  updatedAt: '2026-08-30T07:00:00.000Z',
};

const PENDENCIA: ArchitecturePendency = {
  storyId: 'story-orfa',
  title: 'Relatório de conciliação',
  status: 'draft',
  reason: 'missing_module',
  missing: ['pagamentos'],
};

/** As CINCO filas com item — o caso que o painel existe para mostrar. */
const CINCO_FILAS = montarFilas({
  acoesDaSessao: [acao({ id: 'a1' }), acao({ id: 'a2' })],
  merges: [acao({ id: 'm1', actionType: 'git_merge', sessionId: 'sess-antiga' })],
  epicos: [
    epico([
      historia({ id: 's1' }),
      historia({ id: 's2', title: 'Reembolso parcial' }),
      historia({ id: 's3', title: 'Cupom de primeira compra' }),
    ]),
  ],
  pendenciasDeArquitetura: [PENDENCIA],
  hipoteses: [HIPOTESE],
});

const NENHUMA_FILA = montarFilas({
  acoesDaSessao: [],
  merges: [],
  epicos: [],
  pendenciasDeArquitetura: [],
  hipoteses: [],
});

const onIrParaAba = vi.fn();

/**
 * `open` é CONTROLADO pelo pai (contrato do componente), então o teste monta
 * um pai de verdade — é a única forma de provar que `Esc` e o clique-fora
 * chegam mesmo a fechar, e não só a chamar um callback.
 */
function Hospedeiro({ filas = CINCO_FILAS }: { filas?: typeof CINCO_FILAS }) {
  const [aberto, setAberto] = useState(false);
  return (
    <PainelPrecisaDeVoce
      projectId="proj-1"
      filas={filas}
      open={aberto}
      onOpenChange={setAberto}
      onIrParaAba={onIrParaAba}
    />
  );
}

function montar(filas: typeof CINCO_FILAS = CINCO_FILAS) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <Hospedeiro filas={filas} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

async function abrir(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Precisa de você/ }));
  return screen.getByRole('dialog');
}

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PainelPrecisaDeVoce — as cinco filas, separadas', () => {
  it('abre pelo chip e mostra as cinco filas como grupos próprios, cada um com a SUA contagem', async () => {
    const user = userEvent.setup();
    montar();
    const painel = await abrir(user);

    const cabecalhos = within(painel).getAllByRole('heading', { level: 3 });
    expect(cabecalhos.map((h) => h.textContent)).toEqual([
      'Aprovações de ação2',
      'Merges de PR1',
      'Promoções de história3',
      'Pendências de arquitetura1',
      'Hipóteses do Psicólogo1',
    ]);
  });

  it('não soma nada: o total 8 não aparece em cabeçalho nenhum, nem no chip', async () => {
    const user = userEvent.setup();
    montar();

    // O chip anuncia PRESENÇA, não quantidade — nenhum dígito nele.
    const chip = screen.getByRole('button', { name: /Precisa de você/ });
    expect(chip.textContent).toBe('Precisa de você');

    const painel = await abrir(user);
    const contagens = within(painel)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent?.replace(/\D/g, ''));
    expect(contagens).toEqual(['2', '1', '3', '1', '1']);
    expect(contagens).not.toContain('8');
  });

  it('cada fila mantém a ordem de urgência declarada — aprovações primeiro, hipóteses por último', async () => {
    const user = userEvent.setup();
    montar();
    const painel = await abrir(user);

    const titulos = within(painel).getAllByRole('heading', { level: 3 });
    expect(titulos[0]).toHaveTextContent('Aprovações de ação');
    expect(titulos[4]).toHaveTextContent('Hipóteses do Psicólogo');
  });

  it('o vazio tem a frase DELE, não uma genérica', async () => {
    const user = userEvent.setup();
    montar(NENHUMA_FILA);
    const painel = await abrir(user);

    expect(within(painel).getByText('Nada esperando decisão sua.')).toBeInTheDocument();
    expect(within(painel).queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });
});

describe('PainelPrecisaDeVoce — decidir sem sair do painel', () => {
  it('a linha de aprovação renderiza um ApprovalCard e aprova pela sessão da PRÓPRIA ação', async () => {
    const user = userEvent.setup();
    approveAction.mockResolvedValue(undefined);
    montar();
    const painel = await abrir(user);

    const aprovar = within(painel).getAllByRole('button', { name: 'Aprovar' });
    // Duas aprovações + o merge — os três são `ApprovalCard`.
    expect(aprovar).toHaveLength(3);

    await user.click(aprovar[0]!);
    await waitFor(() => expect(approveAction).toHaveBeenCalledTimes(1));
    expect(approveAction).toHaveBeenCalledWith('proj-1', 'sess-1', 'a1');
  });

  it('o merge decide pela sessão que o PROPÔS, não pela mais recente', async () => {
    const user = userEvent.setup();
    approveAction.mockResolvedValue(undefined);
    montar();
    const painel = await abrir(user);

    // O terceiro card é o da fila de PRs (aprovações vêm antes, e são duas).
    const aprovar = within(painel).getAllByRole('button', { name: 'Aprovar' });
    await user.click(aprovar[2]!);

    await waitFor(() => expect(approveAction).toHaveBeenCalledTimes(1));
    expect(approveAction).toHaveBeenCalledWith('proj-1', 'sess-antiga', 'm1');
  });

  it('NÃO oferece "Modo automático": o painel decide a ação, nunca muda a política do agente', async () => {
    const user = userEvent.setup();
    montar();
    const painel = await abrir(user);

    expect(within(painel).queryByRole('button', { name: /Modo automático/ })).toBeNull();
  });

  it('as três filas sem card levam à aba onde a decisão mora, e fecham o painel', async () => {
    const user = userEvent.setup();
    montar();
    const painel = await abrir(user);

    await user.click(within(painel).getByText('Reembolso parcial'));

    expect(onIrParaAba).toHaveBeenCalledWith('backlog');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('PainelPrecisaDeVoce — a pendência de arquitetura sem data própria', () => {
  it('renderiza sem quebrar e DIZ que não tem data quando a história não veio', async () => {
    const user = userEvent.setup();
    montar();
    const painel = await abrir(user);

    // `PENDENCIA` aponta para `story-orfa`, que não está no backlog do
    // fixture: sem história de onde emprestar, a tela não inventa um instante.
    const linha = within(painel).getByText('Relatório de conciliação').closest('button')!;
    expect(within(linha).getByText('sem data')).toBeInTheDocument();
  });

  it('quando a história existe, a data aparece MARCADA como emprestada dela', async () => {
    const user = userEvent.setup();
    const filas = montarFilas({
      acoesDaSessao: [],
      merges: [],
      epicos: [epico([historia({ id: 'story-1', proposedReady: false })])],
      pendenciasDeArquitetura: [{ ...PENDENCIA, storyId: 'story-1' }],
      hipoteses: [],
    });
    montar(filas);
    const painel = await abrir(user);

    const linha = within(painel).getByText('Relatório de conciliação').closest('button')!;
    // A frase distingue a data da história da data da própria pendência — é
    // o que impede a tela de afirmar precisão que o dado não tem.
    expect(linha.textContent).toContain('história atualizada');
  });
});

describe('PainelPrecisaDeVoce — a mecânica que o NotificationBell não tinha', () => {
  it('o gatilho anuncia o estado do painel (`aria-expanded`) e o painel é um diálogo com nome', async () => {
    const user = userEvent.setup();
    montar();

    const chip = screen.getByRole('button', { name: /Precisa de você/ });
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(chip).toHaveAttribute('aria-haspopup', 'dialog');

    const painel = await abrir(user);
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(painel).toHaveAttribute('aria-modal', 'true');
    expect(painel).toHaveAccessibleName('Precisa de você');
  });

  it('Esc fecha, e o foco VOLTA para o chip', async () => {
    const user = userEvent.setup();
    montar();
    await abrir(user);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /Precisa de você/ })).toHaveFocus();
  });

  it('clicar fora (no scrim) fecha', async () => {
    const user = userEvent.setup();
    montar();
    await abrir(user);

    await user.click(screen.getByTestId('precisa-de-voce-scrim'));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clicar DENTRO do painel não fecha', async () => {
    const user = userEvent.setup();
    montar();
    const painel = await abrir(user);

    await user.click(within(painel).getByRole('heading', { name: 'Precisa de você' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('abrir leva o foco para dentro do painel', async () => {
    const user = userEvent.setup();
    montar();
    const painel = await abrir(user);

    expect(painel).toHaveFocus();
  });

  it('Tab dá a volta DENTRO do painel — o foco não escapa para trás do scrim', async () => {
    const user = userEvent.setup();
    montar(NENHUMA_FILA);
    const painel = await abrir(user);

    // No vazio o único focável é o botão de fechar: `Tab` a partir dele tem
    // de voltar para ele mesmo, nunca sair para o documento.
    const fechar = within(painel).getByRole('button', { name: 'Fechar o painel' });
    await user.tab();
    expect(fechar).toHaveFocus();
    await user.tab();
    expect(fechar).toHaveFocus();
  });

  it('o botão de fechar fecha e devolve o foco ao chip', async () => {
    const user = userEvent.setup();
    montar();
    const painel = await abrir(user);

    await user.click(within(painel).getByRole('button', { name: 'Fechar o painel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /Precisa de você/ })).toHaveFocus();
  });
});

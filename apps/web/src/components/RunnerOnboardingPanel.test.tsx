import type { ReactElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import terminalPtBR from '../locales/pt-BR/terminal.json';
import { COMANDO_DO_INSTALADOR, RunnerOnboardingPanel } from './RunnerOnboardingPanel';

/**
 * Onboarding do runner — desde o ADR 0203 (RN-687) ele manda para o
 * `install.sh`, e o fluxo do navegador do ADR 0118 (Web Crypto, download,
 * File System Access) não existe mais. Mesmo padrão de i18n isolado de
 * `FolderBrowserModal.test.tsx`/`TerminalPanel.test.tsx` irmãos.
 */

function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: { 'pt-BR': { terminal: terminalPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'terminal',
    ns: ['terminal'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

/**
 * `QueryClientProvider` entrou junto com a `EsperaDoRunner` (RN-474), que o
 * painel passa a montar depois de configurar a pasta: ela sonda
 * `['project', id]` para saber se o runner apareceu. Completar o dublê aqui é
 * o mínimo — o que a espera decide tem prova PRÓPRIA em
 * `EsperaDoRunner.test.tsx`; aqui ela só precisa montar sem estourar.
 */
function renderComI18n(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={novaInstanciaI18n()}>{ui}</I18nextProvider>
    </QueryClientProvider>,
  );
}

const { listWorkspacesMock, listRunnerDeviceKeysMock } = vi.hoisted(() => ({
  listWorkspacesMock: vi.fn(),
  listRunnerDeviceKeysMock: vi.fn(),
}));

vi.mock('../lib/api-client', () => ({
  API_URL: 'https://api.brabo.example',
  // Campo explícito e não parâmetro-propriedade: `erasableSyntaxOnly` recusa
  // o atalho, e o `tsconfig` do web o liga.
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number) {
      super(`api error ${status}`);
      this.status = status;
    }
  },
  // A `EsperaDoRunner` sonda o projeto; sem runner nenhum, o carimbo fica
  // nulo e ela permanece em "procurando" — que é o estado certo aqui.
  getProject: () =>
    Promise.resolve({ id: 'proj-1', workspaceVerifiedAt: null, workspacePath: null }),
  // As duas perguntas do reconhecimento de máquina já pareada (RN-548): o
  // papel de quem olha e as chaves de dispositivo dele. O default é o estado
  // de ANTES da FASE 30 — papel que alcança, e nenhuma chave de máquina — para
  // que os testes que já existiam continuem afirmando o mesmo painel.
  listWorkspaces: (...a: unknown[]) => listWorkspacesMock(...a),
  listRunnerDeviceKeys: (...a: unknown[]) => listRunnerDeviceKeysMock(...a),
}));

beforeEach(() => {
  listWorkspacesMock.mockReset();
  listRunnerDeviceKeysMock.mockReset();
  listWorkspacesMock.mockResolvedValue([{ workspace: { id: 'ws-1' }, role: 'maintainer' }]);
  listRunnerDeviceKeysMock.mockResolvedValue([]);
});

/**
 * O caminho é o instalador (ADR 0203, RN-687). O que o painel decide é O QUE
 * oferece: o comando do `install.sh`, copiável, e o comando manual de sempre
 * no `<details>` — e nunca mais o fluxo do navegador do ADR 0118.
 */
describe('RunnerOnboardingPanel — o caminho é o instalador (ADR 0203)', () => {
  it('sem chave pareada: mostra o comando do instalador, que copia, e a espera do runner', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderComI18n(<RunnerOnboardingPanel projectId="proj-1" />);

    expect(await screen.findByText(COMANDO_DO_INSTALADOR)).toBeInTheDocument();
    expect(COMANDO_DO_INSTALADOR).toMatch(/^curl -fsSLO .+\/install\.sh && bash install\.sh$/);
    expect(screen.getByText(/instalador do Brabo/i)).toBeInTheDocument();
    // O passo humano é dito ao lado do comando, não escondido.
    expect(
      screen.getByText(/o navegador não executa programas na sua máquina/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copiar' }));
    expect(writeText).toHaveBeenCalledWith(COMANDO_DO_INSTALADOR);
    expect(await screen.findByRole('button', { name: 'Copiado!' })).toBeInTheDocument();

    // Depois do instalador, o que falta é o agente CONECTAR — a espera é UMA.
    expect(screen.getAllByText(/procurando o runner/i)).toHaveLength(1);

    cleanup();
  });

  it('o fluxo do navegador SAIU: nenhum botão de configurar pasta nem de baixar arquivos, e nenhum chmod', async () => {
    renderComI18n(<RunnerOnboardingPanel projectId="proj-1" />);

    await screen.findByText(COMANDO_DO_INSTALADOR);
    expect(
      screen.queryByRole('button', { name: /configurar pasta automaticamente/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /baixar arquivos/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/chmod \+x/)).not.toBeInTheDocument();
    // O único botão além do de copiar é nenhum: o painel não tem ação de rede.
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Copiar']);

    cleanup();
  });

  it('CASO DE FALHA: clipboard recusado não quebra a tela — o comando segue lá, à mão', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('negado')) },
      configurable: true,
    });

    renderComI18n(<RunnerOnboardingPanel projectId="proj-1" />);

    await user.click(await screen.findByRole('button', { name: 'Copiar' }));
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(COMANDO_DO_INSTALADOR)).toBeInTheDocument();

    cleanup();
  });

  it('o comando manual (PAT) segue no `<details>`, nomeado como o caminho da OUTRA máquina', async () => {
    renderComI18n(<RunnerOnboardingPanel projectId="proj-1" />);

    expect(await screen.findByText(/outra máquina, ou rodar manualmente/i)).toBeInTheDocument();
    expect(screen.getByText(/brabo-runner --project proj-1/)).toBeInTheDocument();
    expect(screen.getByText(/--token/)).toBeInTheDocument();

    cleanup();
  });

  it('sem projectId (projeto ainda não existe): instalador e comando manual com placeholder, sem espera', async () => {
    renderComI18n(<RunnerOnboardingPanel projectId={null} />);

    expect(
      screen.getByText(/depois de criar o projeto, você pode configurar o runner aqui/i),
    ).toBeInTheDocument();
    expect(screen.getByText(COMANDO_DO_INSTALADOR)).toBeInTheDocument();
    expect(screen.getByText(/<id do projeto>/)).toBeInTheDocument();
    expect(screen.queryByText(/procurando o runner/i)).not.toBeInTheDocument();

    cleanup();
  });

  it('`mostrarEspera={false}` (quem montou já espera): o instalador aparece sem segunda espera', async () => {
    renderComI18n(<RunnerOnboardingPanel projectId="proj-1" mostrarEspera={false} />);

    expect(await screen.findByText(COMANDO_DO_INSTALADOR)).toBeInTheDocument();
    expect(screen.queryByText(/procurando o runner/i)).not.toBeInTheDocument();

    cleanup();
  });

  it('`mensagem` explícita sobrepõe o texto default (uso de `TerminalPanel`/`FolderBrowserModal`)', async () => {
    renderComI18n(
      <RunnerOnboardingPanel projectId="proj-1" mensagem="nenhum runner conectado a este projeto" />,
    );

    expect(screen.getByText('nenhum runner conectado a este projeto')).toBeInTheDocument();
    cleanup();
  });
});

/**
 * O reconhecimento de agente local de MÁQUINA já pareado (RN-548, ADR 0154).
 *
 * O que a derivação decide tem prova PRÓPRIA em `lib/agente-de-maquina.test.ts`
 * (sete estados, nenhum virando o outro). Aqui se prova o que só o componente
 * pode provar: o que a tela DIZ, e — sobretudo — o que ela NÃO diz.
 */
describe('RunnerOnboardingPanel — reconhece máquina já pareada (RN-548)', () => {
  const chaveDeMaquina = {
    id: 'chave-1',
    name: 'laptop',
    projectId: null,
    especie: 'maquina' as const,
    createdAt: '2026-09-01T10:00:00.000Z',
    revokedAt: null,
    lastUsedAt: '2026-09-10T08:00:00.000Z',
  };

  it('com chave de máquina ativa: anuncia o pareamento, o gesto é o SERVIÇO, e o instalador sai', async () => {
    listRunnerDeviceKeysMock.mockResolvedValue([chaveDeMaquina]);

    renderComI18n(<RunnerOnboardingPanel projectId="proj-1" />);

    expect(
      await screen.findByText(/sua conta já tem máquina pareada: laptop/i),
    ).toBeInTheDocument();
    // O gesto é conferir o serviço na máquina pareada — nunca refazer o
    // pareamento que ela já tem. E o serviço é o da ESPÉCIE (AT-106): chave de
    // máquina é servida pela unit de MÁQUINA (RN-545), então a pergunta é
    // `--machine`; a por projeto responderia sobre uma unit que não existe.
    expect(screen.getByText('brabo-runner service status --machine')).toBeInTheDocument();
    expect(screen.queryByText(/service status --project/)).not.toBeInTheDocument();

    // Reconhecida a máquina, mandar instalar de novo seria responder à
    // pergunta errada: o instalador sai, e quem está em OUTRA máquina tem o
    // comando manual no `<details>` (ADR 0203).
    expect(screen.queryByText(COMANDO_DO_INSTALADOR)).not.toBeInTheDocument();
    expect(screen.getByText(/outra máquina, ou rodar manualmente/i)).toBeInTheDocument();

    cleanup();
  });

  it('reconhecer NÃO é dizer que o agente está de pé, nem que ESTA máquina é a pareada', async () => {
    listRunnerDeviceKeysMock.mockResolvedValue([chaveDeMaquina]);

    renderComI18n(<RunnerOnboardingPanel projectId="proj-1" />);

    expect(
      await screen.findByText(/chave registrada não é agente rodando/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/a lista é da sua CONTA, não deste navegador/i),
    ).toBeInTheDocument();
    // E o custo da ESPÉCIE é dito: ela atende todos os projetos do dono.
    expect(
      screen.getByText(/revogá-la derruba o agente local em todos eles/i),
    ).toBeInTheDocument();
    // A espera da RN-474 continua sendo quem responde pelo AGORA — e é UMA só.
    expect(screen.getAllByText(/procurando o runner/i)).toHaveLength(1);

    cleanup();
  });

  it('chave de máquina REVOGADA não vira pareamento: o painel volta a mandar para o instalador', async () => {
    listRunnerDeviceKeysMock.mockResolvedValue([
      { ...chaveDeMaquina, revokedAt: '2026-09-11T00:00:00.000Z' },
    ]);

    renderComI18n(<RunnerOnboardingPanel projectId="proj-1" />);

    expect(await screen.findByText(/está revogada/i)).toBeInTheDocument();
    expect(screen.getByText(COMANDO_DO_INSTALADOR)).toBeInTheDocument();

    cleanup();
  });

  it('consulta falhada diz que NÃO SABE — nunca que não há máquina pareada', async () => {
    listRunnerDeviceKeysMock.mockRejectedValue(new Error('boom'));

    renderComI18n(<RunnerOnboardingPanel projectId="proj-1" />);

    expect(await screen.findByText(/quer dizer que não sei/i)).toBeInTheDocument();
    expect(screen.queryByText(/sua conta já tem máquina pareada/i)).not.toBeInTheDocument();
    // E o painel de sempre segue de pé: ignorância não tranca o instalador.
    expect(screen.getByText(COMANDO_DO_INSTALADOR)).toBeInTheDocument();

    cleanup();
  });

  it('papel abaixo de developer: a tela não pergunta, e diz por quê UMA vez, em texto', async () => {
    listWorkspacesMock.mockResolvedValue([{ workspace: { id: 'ws-1' }, role: 'viewer' }]);

    renderComI18n(<RunnerOnboardingPanel projectId="proj-1" />);

    expect(await screen.findByText(/exige papel developer neste projeto/i)).toBeInTheDocument();
    // Quem recusa é o `RolesGuard`: a tela só para de perguntar o que a api
    // negaria — e por isso não chega a chamar a rota.
    expect(listRunnerDeviceKeysMock).not.toHaveBeenCalled();

    cleanup();
  });

  it('sem projectId (wizard antes da criação antecipada) não há a quem perguntar', async () => {
    listRunnerDeviceKeysMock.mockResolvedValue([chaveDeMaquina]);

    renderComI18n(<RunnerOnboardingPanel projectId={null} />);

    await waitFor(() => expect(listRunnerDeviceKeysMock).not.toHaveBeenCalled());
    expect(screen.queryByText(/sua conta já tem máquina pareada/i)).not.toBeInTheDocument();

    cleanup();
  });
});

describe('RunnerOnboardingPanel — reconhece chave de PROJETO já pareada (AT-107)', () => {
  const chaveDeProjeto = {
    id: 'chave-p',
    name: 'kit-do-navegador',
    projectId: 'proj-1',
    especie: 'projeto' as const,
    createdAt: '2026-09-01T10:00:00.000Z',
    revokedAt: null,
    lastUsedAt: '2026-09-10T08:00:00.000Z',
  };

  it('chave de projeto ativa (registrada pelo navegador ANTES do ADR 0203): segue reconhecida, e o instalador sai', async () => {
    listRunnerDeviceKeysMock.mockResolvedValue([chaveDeProjeto]);

    renderComI18n(<RunnerOnboardingPanel projectId="proj-1" />);

    expect(
      await screen.findByText(/este projeto já está pareado: kit-do-navegador/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/chave registrada não é agente rodando/i)).toBeInTheDocument();
    expect(screen.getByText(/derruba o agente local aqui, não nos seus outros projetos/i)).toBeInTheDocument();
    expect(screen.queryByText(/todos eles/i)).not.toBeInTheDocument();
    // Chave de PROJETO é servida pela unit do projeto: o comando continua o
    // por projeto, e o `--machine` não aparece (AT-106).
    expect(screen.getByText('brabo-runner service status --project proj-1')).toBeInTheDocument();
    expect(screen.queryByText(/service status --machine/)).not.toBeInTheDocument();
    expect(screen.queryByText(COMANDO_DO_INSTALADOR)).not.toBeInTheDocument();
    expect(screen.getAllByText(/procurando o runner/i)).toHaveLength(1);

    cleanup();
  });

  it('as DUAS espécies ativas: cada bloco oferece o comando da SUA unit, e a espera segue UMA', async () => {
    listRunnerDeviceKeysMock.mockResolvedValue([
      chaveDeProjeto,
      {
        ...chaveDeProjeto,
        id: 'chave-m',
        name: 'laptop',
        projectId: null,
        especie: 'maquina' as const,
      },
    ]);

    renderComI18n(<RunnerOnboardingPanel projectId="proj-1" />);

    expect(await screen.findByText(/sua conta já tem máquina pareada: laptop/i)).toBeInTheDocument();
    expect(screen.getByText('brabo-runner service status --machine')).toBeInTheDocument();
    expect(screen.getByText('brabo-runner service status --project proj-1')).toBeInTheDocument();
    expect(screen.getAllByText(/procurando o runner/i)).toHaveLength(1);

    cleanup();
  });

  it('chave de projeto REVOGADA: avisa e o painel volta a mandar para o instalador', async () => {
    listRunnerDeviceKeysMock.mockResolvedValue([
      { ...chaveDeProjeto, revokedAt: '2026-09-11T00:00:00.000Z' },
    ]);

    renderComI18n(<RunnerOnboardingPanel projectId="proj-1" />);

    expect(await screen.findByText(/está revogada/i)).toBeInTheDocument();
    expect(screen.queryByText(/já está pareado/i)).not.toBeInTheDocument();
    expect(screen.getByText(COMANDO_DO_INSTALADOR)).toBeInTheDocument();

    cleanup();
  });

  it('chave ativa de OUTRO projeto não reconhece este', async () => {
    listRunnerDeviceKeysMock.mockResolvedValue([{ ...chaveDeProjeto, projectId: 'proj-2' }]);

    renderComI18n(<RunnerOnboardingPanel projectId="proj-1" />);

    await waitFor(() => expect(listRunnerDeviceKeysMock).toHaveBeenCalled());
    expect(screen.queryByText(/já está pareado/i)).not.toBeInTheDocument();
    expect(screen.getByText(COMANDO_DO_INSTALADOR)).toBeInTheDocument();

    cleanup();
  });
});

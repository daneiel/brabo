import type { ReactElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import terminalPtBR from '../locales/pt-BR/terminal.json';
import { RunnerOnboardingPanel } from './RunnerOnboardingPanel';

/**
 * Onboarding do runner sem PAT (ver `lib/runner-bootstrap.ts`) — o módulo é
 * substituído por um dublê, porque o que este componente decide é a
 * ORQUESTRAÇÃO visual (qual botão aparece, o estado de loading/erro/sucesso),
 * não o protocolo de Web Crypto/File System Access em si (coberto em
 * `runner-bootstrap.test.ts`). Mesmo padrão de i18n isolado de
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

const {
  suportaEscritaDeArquivosMock,
  detectarPlataformaMock,
  configurarPastaAutomaticamenteMock,
  baixarKitManualMock,
} = vi.hoisted(() => ({
  suportaEscritaDeArquivosMock: vi.fn(),
  detectarPlataformaMock: vi.fn(),
  configurarPastaAutomaticamenteMock: vi.fn(),
  baixarKitManualMock: vi.fn(),
}));

vi.mock('../lib/runner-bootstrap', () => ({
  suportaEscritaDeArquivos: suportaEscritaDeArquivosMock,
  detectarPlataforma: detectarPlataformaMock,
  configurarPastaAutomaticamente: configurarPastaAutomaticamenteMock,
  baixarKitManual: baixarKitManualMock,
  plataformasSuportadas: () => ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'],
}));

vi.mock('../lib/api-client', () => ({
  API_URL: 'https://api.brabo.example',
  // A `EsperaDoRunner` sonda o projeto; sem runner nenhum, o carimbo fica
  // nulo e ela permanece em "procurando" — que é o estado certo aqui.
  getProject: () =>
    Promise.resolve({ id: 'proj-1', workspaceVerifiedAt: null, workspacePath: null }),
}));

beforeEach(() => {
  suportaEscritaDeArquivosMock.mockReset();
  detectarPlataformaMock.mockReset();
  configurarPastaAutomaticamenteMock.mockReset();
  baixarKitManualMock.mockReset();
});

describe('RunnerOnboardingPanel', () => {
  it('Chromium com plataforma detectada: caminho feliz da configuração automática', async () => {
    const user = userEvent.setup();
    suportaEscritaDeArquivosMock.mockReturnValue(true);
    detectarPlataformaMock.mockResolvedValue('linux-x64');
    configurarPastaAutomaticamenteMock.mockResolvedValue({
      instrucaoFinal: 'chmod +x ./brabo-runner && ./brabo-runner',
      pasta: 'minha-pasta',
      falhaDoBinario: null,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderComI18n(<RunnerOnboardingPanel projectId="proj-1" />);

    const botao = await screen.findByRole('button', { name: 'Configurar pasta automaticamente' });
    await user.click(botao);

    expect(
      await screen.findByText('chmod +x ./brabo-runner && ./brabo-runner'),
    ).toBeInTheDocument();
    expect(configurarPastaAutomaticamenteMock).toHaveBeenCalledWith({
      projectId: 'proj-1',
      apiUrl: 'https://api.brabo.example',
      platform: 'linux-x64',
    });

    await user.click(screen.getByRole('button', { name: 'Copiar' }));
    expect(writeText).toHaveBeenCalledWith('chmod +x ./brabo-runner && ./brabo-runner');
    expect(await screen.findByRole('button', { name: 'Copiado!' })).toBeInTheDocument();

    cleanup();
  });

  it('binário indisponível: a pasta configurada é ANUNCIADA mesmo assim, com o motivo e o comando alternativo (RN-473)', async () => {
    const user = userEvent.setup();
    suportaEscritaDeArquivosMock.mockReturnValue(true);
    detectarPlataformaMock.mockResolvedValue('linux-x64');
    configurarPastaAutomaticamenteMock.mockResolvedValue({
      instrucaoFinal: 'npm install -g @brabo/runner && brabo-runner',
      pasta: 'meu-projeto',
      falhaDoBinario:
        'Não foi possível baixar o binário do runner para "linux-x64" (HTTP 502).',
    });

    renderComI18n(<RunnerOnboardingPanel projectId="proj-1" />);

    await user.click(
      await screen.findByRole('button', { name: 'Configurar pasta automaticamente' }),
    );

    // A escolha da pasta NÃO foi descartada — é o coração do pedido.
    expect(await screen.findByText(/Pasta "meu-projeto" configurada/)).toBeInTheDocument();
    // O motivo aparece, e a saída também.
    expect(screen.getByText(/HTTP 502/)).toBeInTheDocument();
    expect(
      screen.getByText('npm install -g @brabo/runner && brabo-runner'),
    ).toBeInTheDocument();
    // E a espera já está rodando, sem a pessoa clicar em nada.
    expect(screen.getByText('Procurando o runner…')).toBeInTheDocument();

    cleanup();
  });

  it('cancelar o seletor de pasta volta ao estado inicial, sem alerta de erro', async () => {
    const user = userEvent.setup();
    suportaEscritaDeArquivosMock.mockReturnValue(true);
    detectarPlataformaMock.mockResolvedValue('linux-x64');
    const cancelamento = new Error('The user aborted a request.');
    cancelamento.name = 'AbortError';
    configurarPastaAutomaticamenteMock.mockRejectedValue(cancelamento);

    renderComI18n(<RunnerOnboardingPanel projectId="proj-1" />);

    const botao = await screen.findByRole('button', { name: 'Configurar pasta automaticamente' });
    await user.click(botao);

    await waitFor(() => expect(configurarPastaAutomaticamenteMock).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Configurar pasta automaticamente' }),
    ).toBeInTheDocument();

    cleanup();
  });

  it('falha da configuração automática mostra o erro sem quebrar a tela, e o comando manual continua acessível', async () => {
    const user = userEvent.setup();
    suportaEscritaDeArquivosMock.mockReturnValue(true);
    detectarPlataformaMock.mockResolvedValue('linux-x64');
    configurarPastaAutomaticamenteMock.mockRejectedValue(
      new Error('usuário cancelou o seletor de pasta'),
    );

    renderComI18n(<RunnerOnboardingPanel projectId="proj-1" />);

    const botao = await screen.findByRole('button', { name: 'Configurar pasta automaticamente' });
    await user.click(botao);

    expect(await screen.findByText('usuário cancelou o seletor de pasta')).toBeInTheDocument();
    // A tela não quebrou: o comando manual (colapsado) continua no DOM.
    expect(screen.getByText(/brabo-runner --project proj-1/)).toBeInTheDocument();
    expect(screen.getByText(/--token/)).toBeInTheDocument();

    cleanup();
  });

  it('fora do Chromium (sem suporte a escrita de arquivos): mostra "Baixar arquivos" em vez do botão automático', async () => {
    const user = userEvent.setup();
    suportaEscritaDeArquivosMock.mockReturnValue(false);
    detectarPlataformaMock.mockResolvedValue('darwin-x64');
    baixarKitManualMock.mockResolvedValue({
      instrucaoFinal: 'chmod +x ./brabo-runner && ./brabo-runner',
      falhaDoBinario: null,
    });

    renderComI18n(<RunnerOnboardingPanel projectId="proj-1" />);

    expect(
      screen.queryByRole('button', { name: 'Configurar pasta automaticamente' }),
    ).not.toBeInTheDocument();
    const botao = await screen.findByRole('button', { name: 'Baixar arquivos' });
    await user.click(botao);

    await waitFor(() =>
      expect(baixarKitManualMock).toHaveBeenCalledWith({
        projectId: 'proj-1',
        apiUrl: 'https://api.brabo.example',
        platform: 'darwin-x64',
      }),
    );
    expect(
      await screen.findByText(/downloads iniciados/i),
    ).toBeInTheDocument();

    cleanup();
  });

  it('sem projectId (projeto ainda não existe): nenhuma ação automática, só o comando manual com placeholder', async () => {
    suportaEscritaDeArquivosMock.mockReturnValue(true);
    detectarPlataformaMock.mockResolvedValue('linux-x64');

    renderComI18n(<RunnerOnboardingPanel projectId={null} />);

    expect(
      screen.queryByRole('button', { name: 'Configurar pasta automaticamente' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Baixar arquivos' })).not.toBeInTheDocument();
    expect(
      screen.getByText(/depois de criar o projeto, você pode configurar o runner aqui/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/<id do projeto>/)).toBeInTheDocument();

    cleanup();
  });

  it('`mensagem` explícita sobrepõe o texto default (uso de `TerminalPanel`/`FolderBrowserModal`)', async () => {
    suportaEscritaDeArquivosMock.mockReturnValue(true);
    detectarPlataformaMock.mockResolvedValue('linux-x64');

    renderComI18n(
      <RunnerOnboardingPanel projectId="proj-1" mensagem="nenhum runner conectado a este projeto" />,
    );

    expect(screen.getByText('nenhum runner conectado a este projeto')).toBeInTheDocument();
    cleanup();
  });
});

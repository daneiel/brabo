import type { ReactElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import terminalPtBR from '../../locales/pt-BR/terminal.json';
import { TerminalPanel } from './TerminalPanel';
import type { TerminalChannelHandlers } from '../../lib/terminal-channel';

/**
 * Os TRÊS estados da RN-088 (carregando / erro / conectado). `xterm-runtime`
 * e `terminal-channel` são substituídos por dublês — não há PTY nem
 * WebSocket de verdade em jsdom, e o que importa aqui é a ORQUESTRAÇÃO: qual
 * estado a tela mostra em cada resposta do canal, e se o que chega por
 * `pty_data` vira `terminal.write(...)`.
 *
 * Instância própria de i18next (mesmo padrão de `AccountPage.test.tsx`), só
 * com o namespace `terminal` e `lng: 'pt-BR'` — mantém as asserções em
 * português que este teste já fazia antes da extração.
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

function renderComI18n(ui: ReactElement) {
  return render(<I18nextProvider i18n={novaInstanciaI18n()}>{ui}</I18nextProvider>);
}

const {
  fakeTerminal,
  fakeFitAddon,
  fakeChannel,
  createXtermTerminalMock,
  connectTerminalChannelMock,
  capturarHandlers,
} = vi.hoisted(() => {
    const fakeTerminal = {
      cols: 80,
      rows: 24,
      open: vi.fn(),
      write: vi.fn(),
      onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      dispose: vi.fn(),
    };
    const fakeFitAddon = { fit: vi.fn() };
    const createXtermTerminalMock = vi
      .fn()
      .mockResolvedValue({ terminal: fakeTerminal, fitAddon: fakeFitAddon });

    let handlersCapturados: TerminalChannelHandlers | null = null;
    const fakeChannel = {
      abrirPty: vi.fn(),
      enviarInput: vi.fn(),
      redimensionar: vi.fn(),
      fechar: vi.fn(),
    };
    const connectTerminalChannelMock = vi.fn((_projectId: string, handlers: TerminalChannelHandlers) => {
      handlersCapturados = handlers;
      return fakeChannel;
    });
    function capturarHandlers(): TerminalChannelHandlers {
      if (!handlersCapturados) throw new Error('connectTerminalChannel ainda não foi chamado');
      return handlersCapturados;
    }

    return {
      fakeTerminal,
      fakeFitAddon,
      fakeChannel,
      createXtermTerminalMock,
      connectTerminalChannelMock,
      capturarHandlers,
    };
  });

vi.mock('../../lib/xterm-runtime', () => ({
  createXtermTerminal: createXtermTerminalMock,
}));

vi.mock('../../lib/terminal-channel', () => ({
  connectTerminalChannel: connectTerminalChannelMock,
}));

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TerminalPanel (RN-088)', () => {
  it('estado de carregamento: aparece antes de qualquer resposta do canal', async () => {
    renderComI18n(<TerminalPanel projectId="proj-1" />);
    expect(screen.getByText('Abrindo terminal…')).toBeInTheDocument();
    await flush();
    cleanup();
  });

  it('pty_error (sem runner) mostra a mensagem e a instrução com o projectId real', async () => {
    renderComI18n(<TerminalPanel projectId="proj-1" />);
    await flush();

    capturarHandlers().onErro('nenhum runner conectado a este projeto');

    expect(
      await screen.findByText('nenhum runner conectado a este projeto'),
    ).toBeInTheDocument();
    expect(
      screen.getByText((texto) => texto.includes('--project proj-1')),
    ).toBeInTheDocument();
    expect(screen.queryByText('Abrindo terminal…')).not.toBeInTheDocument();
    cleanup();
  });

  it('pty_opened + pty_data: o terminal aparece e escreve o que chegou', async () => {
    renderComI18n(<TerminalPanel projectId="proj-1" />);
    await flush();

    const handlers = capturarHandlers();
    // abrirPty é chamado com o tamanho do terminal mockado (80x24) assim que
    // ele monta — antes mesmo do `pty_opened` voltar.
    expect(connectTerminalChannelMock).toHaveBeenCalledWith('proj-1', expect.anything());

    act(() => handlers.onAberto());
    expect(screen.queryByText('Abrindo terminal…')).not.toBeInTheDocument();

    act(() => handlers.onDados('echo do runner\n'));
    expect(fakeTerminal.write).toHaveBeenCalledWith('echo do runner\n');
    // `FitAddon.fit()` roda antes do `abrirPty` — é ele que dá o tamanho
    // inicial que vai no `pty_open`.
    expect(fakeFitAddon.fit).toHaveBeenCalled();
    cleanup();
  });

  it('cleanup no unmount: fecha o canal e destrói o terminal', async () => {
    const { unmount } = renderComI18n(<TerminalPanel projectId="proj-1" />);
    await flush();

    unmount();

    expect(fakeChannel.fechar).toHaveBeenCalledTimes(1);
    expect(fakeTerminal.dispose).toHaveBeenCalledTimes(1);
  });
});

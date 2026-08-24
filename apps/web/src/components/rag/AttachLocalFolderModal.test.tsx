import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import sessionsPtBR from '../../locales/pt-BR/sessions.json';
import uiPtBR from '../../locales/pt-BR/ui.json';
import { AttachLocalFolderModal } from './AttachLocalFolderModal';
import { ToastProvider } from '../ui/ToastProvider';

const attachLocalFolder = vi.fn();

vi.mock('../../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../../lib/api-client')>('../../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    attachLocalFolder: (...args: unknown[]) => attachLocalFolder(...args),
  };
});

// Mesmo padrão de `AccountPage.test.tsx`/`ProjectRagTab.test.tsx`.
function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: { 'pt-BR': { sessions: sessionsPtBR, ui: uiPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'sessions',
    ns: ['sessions', 'ui'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

/** Um `File` com `webkitRelativePath` — a mesma forma que `<input webkitdirectory>` produz. */
function makeFile(caminhoRelativo: string, conteudo: string): File {
  const nome = caminhoRelativo.split('/').pop()!;
  const arquivo = new File([conteudo], nome, { type: 'text/plain' });
  Object.defineProperty(arquivo, 'webkitRelativePath', {
    value: caminhoRelativo,
    configurable: true,
  });
  return arquivo;
}

function montar(onAttached = vi.fn(), onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const i18n = novaInstanciaI18n();
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <AttachLocalFolderModal projectId="p-1" onClose={onClose} onAttached={onAttached} />
        </ToastProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { onAttached, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AttachLocalFolderModal', () => {
  it('caminho feliz: mostra o resumo (incluindo pulados) e confirma o upload com os caminhos RELATIVOS à pasta', async () => {
    attachLocalFolder.mockResolvedValue({
      folderName: 'meu-projeto',
      filesIndexed: 2,
      filesSkipped: 1,
      chunksCreated: 2,
      embedding: { available: true, embedded: 2, skipped: 0 },
    });
    const user = userEvent.setup();
    const { onAttached } = montar();

    const input = screen.getByLabelText('Escolher pasta…');
    await user.upload(input, [
      makeFile('meu-projeto/README.md', '# Título'),
      makeFile('meu-projeto/src/index.ts', 'export const x = 1;'),
      makeFile('meu-projeto/logo.png', 'não é texto de verdade'),
    ]);

    expect(await screen.findByText(/2 arquivo\(s\) de/)).toBeInTheDocument();
    expect(screen.getByText(/1 pulado/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Anexar 2 arquivo/ }));

    await waitFor(() =>
      expect(attachLocalFolder).toHaveBeenCalledWith('p-1', {
        folderName: 'meu-projeto',
        files: [
          { path: 'README.md', content: '# Título' },
          { path: 'src/index.ts', content: 'export const x = 1;' },
        ],
      }),
    );
    await waitFor(() => expect(onAttached).toHaveBeenCalledWith(expect.objectContaining({ folderName: 'meu-projeto' })));
  });

  it('CASO DE FALHA: pasta sem nenhum arquivo elegível mostra estado honesto, sem botão de confirmar', async () => {
    const user = userEvent.setup();
    montar();

    const input = screen.getByLabelText('Escolher pasta…');
    await user.upload(input, [makeFile('pasta/logo.png', 'binário')]);

    expect(await screen.findByText(/Nenhum arquivo elegível/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Anexar \d/ })).not.toBeInTheDocument();
    expect(attachLocalFolder).not.toHaveBeenCalled();
  });
});

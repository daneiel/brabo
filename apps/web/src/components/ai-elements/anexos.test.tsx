import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../../lib/i18n';
import { adicionarAnexos, subirAnexosPendentes } from '../../lib/anexos';
import { AnexosDaMensagem, AnexosPendentes, BotaoDeAnexar } from './anexos';

const api = vi.hoisted(() => ({
  uploadAttachment: vi.fn(),
  lerAnexoComoDataUrl: vi.fn(),
  sendAgentMessage: vi.fn(),
}));
vi.mock('../../lib/api-client', () => api);

const png = (nome = 'a.png') => new File([new Uint8Array([1, 2, 3])], nome, { type: 'image/png' });
let n = 0;
const sid = () => `s${++n}`;

function tela(sessionId: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <BotaoDeAnexar sessionId={sessionId} />
      <AnexosPendentes sessionId={sessionId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('anexos no composer', () => {
  it('anexar imagem cria chip com miniatura data:', async () => {
    const s = sid();
    tela(s);
    const input = screen.getByTestId('anexo-input');
    await act(async () => {
      fireEvent.change(input, { target: { files: [png()] } });
    });
    await waitFor(() => expect(screen.getAllByTestId('anexo-chip')).toHaveLength(1));
    expect(screen.getByText('a.png')).toBeTruthy();
    expect(document.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png/);
  });

  it('tipo inválido dá erro no cliente', async () => {
    const s = sid();
    tela(s);
    await act(async () => {
      await adicionarAnexos(s, [new File(['x'], 'a.exe', { type: 'application/x-msdownload' })]);
    });
    expect(screen.getByRole('alert').textContent).toMatch(/Unsupported type/);
  });

  it('o 5º anexo é recusado', async () => {
    const s = sid();
    tela(s);
    await act(async () => {
      await adicionarAnexos(s, [1, 2, 3, 4, 5].map((i) => png(`${i}.png`)));
    });
    expect(screen.getAllByTestId('anexo-chip')).toHaveLength(4);
    expect(screen.getByRole('alert').textContent).toMatch(/At most 4/);
  });

  it('enviar faz upload e devolve os ids; erro de upload lança e mantém os chips', async () => {
    const s = sid();
    await adicionarAnexos(s, [png()]);
    api.uploadAttachment.mockResolvedValueOnce({ id: 'x1', nome: 'a.png', mime: 'image/png', tamanho: 3 });
    expect(await subirAnexosPendentes('p', s)).toEqual(['x1']);
    expect(api.uploadAttachment).toHaveBeenCalledWith('p', s, 'a.png', expect.any(String));
    expect(await subirAnexosPendentes('p', s)).toEqual([]);

    const s2 = sid();
    await adicionarAnexos(s2, [png()]);
    api.uploadAttachment.mockRejectedValueOnce(new Error('413'));
    await expect(subirAnexosPendentes('p', s2)).rejects.toThrow('413');
    tela(s2);
    expect(screen.getAllByTestId('anexo-chip')).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toMatch(/message was not sent/);
  });
});

describe('anexos no fio', () => {
  it('mostra chips e lê cada imagem uma vez por id', async () => {
    api.lerAnexoComoDataUrl.mockResolvedValue('data:image/png;base64,AAA');
    const anexos = [
      { id: 'i1', nome: 'foto.png', mime: 'image/png', tamanho: 10 },
      { id: 't1', nome: 'nota.md', mime: 'text/markdown', tamanho: 2048 },
    ];
    const qc = new QueryClient();
    const ui = (
      <QueryClientProvider client={qc}>
        <AnexosDaMensagem projectId="p" sessionId="s" anexos={anexos} />
      </QueryClientProvider>
    );
    const { rerender } = render(ui);
    expect(screen.getAllByTestId('anexo-chip')).toHaveLength(2);
    expect(screen.getByText('2.0 KB')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('img')).toBeTruthy());
    rerender(ui);
    expect(api.lerAnexoComoDataUrl).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RedeDoContainer } from './RedeDoContainer';
import { ToastProvider } from './ui/ToastProvider';
import { ApiError } from '../lib/api-client';
import type { ContainerOverviewItem, Role } from '../lib/api-types';
import i18n from '../lib/i18n';

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});

const getRede = vi.fn();
const putRede = vi.fn();
const propor = vi.fn();
let sessao: { id: string } | undefined = { id: 's1' };
vi.mock('../lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api-client')>();
  return {
    ...original,
    getRedeDoContainer: (...a: unknown[]) => getRede(...a),
    putRedeDoContainer: (...a: unknown[]) => putRede(...a),
    proposeAction: (...a: unknown[]) => propor(...a),
  };
});
vi.mock('../lib/hooks', () => ({ useLatestSession: () => ({ latest: sessao }) }));
vi.mock('../lib/auth', () => ({ userIdDaSessao: () => 'u' }));

function item(o: Partial<ContainerOverviewItem> = {}): ContainerOverviewItem {
  return {
    projectId: 'p1',
    projectName: 'core',
    projectSlug: 'core',
    executionMode: 'container',
    registrado: {
      status: 'running',
      imageVersion: 1,
      imagem: 'node:22',
      resources: { cpus: 1, memoryMb: 512, pidsLimit: 64 },
      failureReason: null,
      createdAt: '2026-08-01T10:00:00.000Z',
      statusChangedAt: '2026-08-01T10:05:00.000Z',
    },
    temImagemDecidida: true,
    workspaceVerifiedAt: null,
    observado: null,
    naoObservado: null,
    detalheDaObservacao: null,
    naoVerificado: null,
    acaoPendente: null,
    brokerConfigurado: true,
    decisaoVigente: null,
    imagemDesatualizada: false,
    ...o,
  };
}

function montar(i = item(), papel: Role = 'maintainer') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RedeDoContainer item={i} papel={papel} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const rede = { ports: [{ host: 8080, container: 80, protocol: 'tcp' }], dns: ['1.1.1.1'], extraHosts: [], version: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  sessao = { id: 's1' };
  getRede.mockResolvedValue(rede);
});

describe('RedeDoContainer', () => {
  it('mostra a rede declarada, a versão e os avisos de loopback e de recriação', async () => {
    montar();
    expect(await screen.findByDisplayValue('8080:80')).toBeTruthy();
    expect(screen.getByText('Versão declarada: 3')).toBeTruthy();
    expect(screen.getByText(/só em 127\.0\.0\.1/)).toBeTruthy();
    expect(screen.getByText(/só vale depois de recriar/)).toBeTruthy();
  });

  it('rede nula tem texto próprio', async () => {
    getRede.mockResolvedValue(null);
    montar();
    expect(await screen.findByText('Nenhuma rede declarada para este container.')).toBeTruthy();
  });

  it('salva num PUT só e recusa no cliente porta da instalação', async () => {
    putRede.mockResolvedValue({ ...rede, version: 4 });
    montar();
    const campo = await screen.findByDisplayValue('8080:80');
    fireEvent.change(campo, { target: { value: '5432:80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rede' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(putRede).not.toHaveBeenCalled();
    fireEvent.change(campo, { target: { value: '9090:80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rede' }));
    await waitFor(() => expect(putRede).toHaveBeenCalledTimes(1));
    expect(putRede.mock.calls[0][1].ports).toEqual([{ host: 9090, container: 80, protocol: 'tcp' }]);
  });

  it('mostra a recusa 400 rede_invalida com o campo e o 409 sem_sessao', async () => {
    montar();
    const campo = await screen.findByDisplayValue('8080:80');
    fireEvent.change(campo, { target: { value: '9090:80' } });
    putRede.mockRejectedValueOnce(new ApiError(400, { code: 'rede_invalida', campo: 'ports[0]', message: 'porta ruim' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rede' }));
    expect(await screen.findByText('ports[0]: porta ruim')).toBeTruthy();
    putRede.mockRejectedValueOnce(new ApiError(409, { code: 'sem_sessao', message: 'x' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rede' }));
    expect(await screen.findByText('O projeto não tem sessão onde registrar a rede.')).toBeTruthy();
  });

  it('abaixo de maintainer fica inerte e diz o motivo uma vez', async () => {
    montar(item(), 'developer');
    expect((await screen.findByDisplayValue('8080:80')).hasAttribute('disabled')).toBe(true);
    expect(screen.getAllByText(/exige o papel de mantenedor/)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Aplicar e subir de novo' }).hasAttribute('disabled')).toBe(true);
  });

  it('propõe container_recreate', async () => {
    propor.mockResolvedValue({});
    montar();
    await screen.findByDisplayValue('8080:80');
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar e subir de novo' }));
    await waitFor(() => expect(propor).toHaveBeenCalledTimes(1));
    expect(propor.mock.calls[0][2].actionType).toBe('container_recreate');
  });

  it('runner fica inerte com o motivo em texto', async () => {
    montar(item({ executionMode: 'runner' }));
    await screen.findByDisplayValue('8080:80');
    expect(screen.getByRole('button', { name: 'Aplicar e subir de novo' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/modo runner/)).toBeTruthy();
  });

  it('lista as portas observadas sem sonda', async () => {
    montar(
      item({
        observado: {
          containerId: 'c',
          nome: 'n',
          estado: 'running',
          imagem: 'node:22',
          iniciadoEm: null,
          portasPublicadas: [{ ip: '127.0.0.1', host: 8080, container: 80 }],
        },
      }),
    );
    expect(await screen.findByText('http://127.0.0.1:8080')).toBeTruthy();
    expect(screen.getByText(/nada garante que algo escute/)).toBeTruthy();
  });
});

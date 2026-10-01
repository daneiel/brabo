import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import machineKeysEn from '../locales/en/machineKeys.json';
import machineKeysPtBR from '../locales/pt-BR/machineKeys.json';
import uiEn from '../locales/en/ui.json';
import uiPtBR from '../locales/pt-BR/ui.json';
import { ToastProvider } from '../components/ui/ToastProvider';
import { ApiError } from '../lib/api-client';
import type { RunnerDeviceKeyListItem } from '../lib/api-types';
import { MachineDeviceKeysSection } from './MachineDeviceKeysSection';

/**
 * As chaves de MÁQUINA na Conta (RN-611, AT-118).
 *
 * O que pode dar errado aqui não é a chamada — é o que a tela AFIRMA e o que
 * ela deixa de SINCRONIZAR:
 *
 * 1. **O alcance.** Revogar uma de máquina derruba o agente local em TODOS os
 *    projetos do dono em modo runner em que ele se conectou com ELA — e, desde
 *    o ADR 0201, só o que se conectou com ela; a confirmação tem de dizer isso
 *    antes do clique.
 * 2. **Os vazios.** Carregando, falhou, vazio, revogada e nunca usada são
 *    cinco estados com cinco textos (RN-088/RN-470), e "ativa" nunca vira
 *    "conectada".
 * 3. **A invalidação.** A chave de máquina aparece também na listagem de TODO
 *    projeto (`['runner-device-keys', projectId]`, lida pelo
 *    `RunnerOnboardingPanel` e pela seção `device-keys`). Revogar aqui e não
 *    invalidar as de projeto deixaria o painel anunciando a revogada.
 *
 * Os dois idiomas são montados de propósito: esta seção nasce com as duas
 * traduções, e o teste de paridade de chaves não prova que o texto diz a
 * mesma coisa nos dois.
 */

const listMachineDeviceKeys = vi.fn();
const revokeMachineDeviceKey = vi.fn();

vi.mock('../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    listMachineDeviceKeys: (...args: unknown[]) => listMachineDeviceKeys(...args),
    revokeMachineDeviceKey: (...args: unknown[]) => revokeMachineDeviceKey(...args),
  };
});

const ATIVA: RunnerDeviceKeyListItem = {
  id: 'key-maquina',
  name: 'thinkpad-do-dani',
  projectId: null,
  especie: 'maquina',
  createdAt: '2026-09-20T10:00:00.000Z',
  revokedAt: null,
  lastUsedAt: '2026-09-21T08:00:00.000Z',
};

const ORFA: RunnerDeviceKeyListItem = {
  ...ATIVA,
  id: 'key-orfa',
  name: 'instalacao-interrompida',
  lastUsedAt: null,
};

const REVOGADA: RunnerDeviceKeyListItem = {
  ...ATIVA,
  id: 'key-antiga',
  name: 'maquina-reinstalada',
  revokedAt: '2026-09-19T10:00:00.000Z',
  lastUsedAt: '2026-09-18T10:00:00.000Z',
};

function montar(lng: 'en' | 'pt-BR' = 'en') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    resources: {
      en: { machineKeys: machineKeysEn, ui: uiEn },
      'pt-BR': { machineKeys: machineKeysPtBR, ui: uiPtBR },
    },
    lng,
    fallbackLng: 'en',
    defaultNS: 'machineKeys',
    ns: ['machineKeys', 'ui'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <MachineDeviceKeysSection />
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { client };
}

beforeEach(() => {
  listMachineDeviceKeys.mockReset();
  revokeMachineDeviceKey.mockReset();
});

describe('MachineDeviceKeysSection (RN-611)', () => {
  it('lista as chaves de máquina, com "nunca usada" e "revogada" por texto — e a revogada sem botão', async () => {
    listMachineDeviceKeys.mockResolvedValue([ATIVA, ORFA, REVOGADA]);
    montar();

    expect(await screen.findByText('thinkpad-do-dani')).toBeInTheDocument();
    expect(screen.getByText('never used')).toBeInTheDocument();
    expect(screen.getByText('revoked')).toBeInTheDocument();
    // A órfã e a substituição por reinstalação ganham, cada uma, o motivo.
    expect(screen.getByText(/usually from an install/)).toBeInTheDocument();
    expect(screen.getByText(/Installing again on the same account/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke thinkpad-do-dani' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Revoke maquina-reinstalada' }),
    ).not.toBeInTheDocument();
    // Vocabulário da RN-561: nunca "conectada".
    expect(screen.queryByText(/connected/i)).not.toBeInTheDocument();
  });

  it('vazio é dito como vazio, e falhar é dito como "não sei" — nunca um pelo outro', async () => {
    listMachineDeviceKeys.mockResolvedValueOnce([]);
    montar();
    expect(await screen.findByText(/Your account has no machine key/)).toBeInTheDocument();
  });

  it('CASO DE FALHA: a leitura que falha não vira lista vazia', async () => {
    listMachineDeviceKeys.mockRejectedValue(new ApiError(500, { message: 'banco fora do ar' }));
    montar();
    expect(await screen.findByText(/I couldn't read your machine keys/)).toBeInTheDocument();
    expect(screen.queryByText(/Your account has no machine key/)).not.toBeInTheDocument();
  });

  it('revogar: a confirmação diz o ALCANCE, chama a rota da Conta e invalida a da Conta E as de TODO projeto', async () => {
    listMachineDeviceKeys.mockResolvedValue([ATIVA]);
    revokeMachineDeviceKey.mockResolvedValue(undefined);
    const { client } = montar();
    const invalidar = vi.spyOn(client, 'invalidateQueries');

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke thinkpad-do-dani' }));
    expect(screen.getByText(/drops the local agent in EVERY project/)).toBeInTheDocument();
    // ADR 0201 (RN-685): o alvo é a CHAVE — a frase do alvo antigo não volta.
    expect(screen.getByText(/^Only what connected with THIS key falls/)).toBeInTheDocument();
    expect(screen.queryByText(/\{project, user\}/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(revokeMachineDeviceKey).toHaveBeenCalledWith('key-maquina'));
    await waitFor(() => {
      const chaves = invalidar.mock.calls.map(([filtro]) => filtro?.queryKey);
      // Por PREFIXO: casa `['runner-device-keys', <qualquer projeto>]`.
      expect(chaves).toContainEqual(['runner-device-keys']);
      expect(chaves).toContainEqual(['machine-device-keys']);
    });
  });

  it('a invalidação por prefixo alcança de fato a listagem de um projeto no cache', async () => {
    listMachineDeviceKeys.mockResolvedValue([ATIVA]);
    revokeMachineDeviceKey.mockResolvedValue(undefined);
    const { client } = montar();
    client.setQueryData(['runner-device-keys', 'proj-1'], [ATIVA]);

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke thinkpad-do-dani' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() =>
      expect(client.getQueryState(['runner-device-keys', 'proj-1'])?.isInvalidated).toBe(true),
    );
  });

  it('CASO DE FALHA: revogação recusada mostra a frase da api e a linha continua ativa', async () => {
    listMachineDeviceKeys.mockResolvedValue([ATIVA]);
    revokeMachineDeviceKey.mockRejectedValue(
      new ApiError(404, { message: 'Chave de máquina não encontrada' }),
    );
    montar();

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke thinkpad-do-dani' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    expect(await screen.findByText('Chave de máquina não encontrada')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('em pt-BR, os mesmos fatos: nunca usada, e o alcance na confirmação', async () => {
    listMachineDeviceKeys.mockResolvedValue([ORFA]);
    montar('pt-BR');

    expect(await screen.findByRole('heading', { name: 'Chaves de máquina' })).toBeInTheDocument();
    expect(await screen.findByText('nunca usada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revogar instalacao-interrompida' }));
    expect(screen.getByText(/derruba o agente local em TODOS os seus projetos/)).toBeInTheDocument();
  });
});

import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import settingsPtBR from '../../locales/pt-BR/settings.json';
import uiPtBR from '../../locales/pt-BR/ui.json';
import { ToastProvider } from '../../components/ui/ToastProvider';
import { ApiError } from '../../lib/api-client';
import type { Role, RunnerDeviceKeyListItem } from '../../lib/api-types';
import { RunnerDeviceKeysSection } from './RunnerDeviceKeysSection';

/**
 * A seção de chaves de dispositivo — a TELA que a RN-519 declarou faltar
 * (RN-561).
 *
 * ## O que este arquivo prova, e por quê
 *
 * A tela consome duas rotas que já existiam e não abre nenhuma. O que pode dar
 * errado nela não é a chamada — é o que ela AFIRMA:
 *
 * 1. **A espécie.** Uma chave de MÁQUINA aparece na lista de TODO projeto do
 *    dono, e revogá-la derruba o agente local em todos. Uma tela que a
 *    mostrasse como "a chave deste projeto" mentiria sobre o alcance da única
 *    ação irreversível que oferece — por isso o alcance é asserido nas DUAS
 *    espécies, e as duas frases têm de ser diferentes.
 * 2. **Os vazios.** "Nenhuma chave", "revogada", "nunca usada" (a órfã),
 *    "ainda não carregou" e "não consegui ler" são CINCO estados, e nenhum se
 *    lê pelo texto do outro (RN-088/RN-470).
 * 3. **O papel.** O mínimo é o do ENDPOINT — `developer`, nas três rotas de
 *    `RunnerDeviceKeysController` —, e é o EFETIVO do projeto que decide
 *    (`projectRole ?? workspaceRole`, RN-471), não o de workspace.
 *
 * ## Só `pt-BR`
 *
 * Mesma justificativa de `papel-na-secao-de-membros.test.tsx`: o que se prova
 * é a chegada (ou não) de uma chamada na api, qual frase de alcance aparece e
 * a mensagem que a PRÓPRIA api mandou. Nenhum dos três muda com o idioma.
 */

const listProjectMembers = vi.fn();
const listRunnerDeviceKeys = vi.fn();
const revokeRunnerDeviceKey = vi.fn();
const useCurrentWorkspaceWithRole = vi.fn();
const userIdDaSessao = vi.fn();

vi.mock('../../lib/hooks', () => ({
  useCurrentWorkspaceWithRole: (...args: unknown[]) =>
    useCurrentWorkspaceWithRole(...args),
}));

vi.mock('../../lib/auth', () => ({
  userIdDaSessao: (...args: unknown[]) => userIdDaSessao(...args),
}));

// `ApiError` e `mensagemDaApi` entram de VERDADE: o desfecho de falha prova que
// a frase da api CHEGA à tela, e um dublê deles provaria só o dublê.
vi.mock('../../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../../lib/api-client')>(
    '../../lib/api-client',
  );
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    listProjectMembers: (...args: unknown[]) => listProjectMembers(...args),
    listRunnerDeviceKeys: (...args: unknown[]) => listRunnerDeviceKeys(...args),
    revokeRunnerDeviceKey: (...args: unknown[]) => revokeRunnerDeviceKey(...args),
  };
});

const MEU_ID = 'user-eu';

const CHAVE_DE_PROJETO: RunnerDeviceKeyListItem = {
  id: 'key-projeto',
  name: 'Chrome do laptop',
  projectId: 'proj-1',
  especie: 'projeto',
  createdAt: '2026-09-01T10:00:00.000Z',
  revokedAt: null,
  lastUsedAt: '2026-09-09T18:30:00.000Z',
};

const CHAVE_DE_MAQUINA: RunnerDeviceKeyListItem = {
  id: 'key-maquina',
  name: 'thinkpad-do-dani',
  projectId: null,
  especie: 'maquina',
  createdAt: '2026-09-02T10:00:00.000Z',
  revokedAt: null,
  lastUsedAt: '2026-09-10T08:00:00.000Z',
};

/** A ÓRFÃ: registrada pelo fluxo do navegador e nunca usada por runner nenhum. */
const CHAVE_ORFA: RunnerDeviceKeyListItem = {
  id: 'key-orfa',
  name: 'aba que fechou',
  projectId: 'proj-1',
  especie: 'projeto',
  createdAt: '2026-09-03T10:00:00.000Z',
  revokedAt: null,
  lastUsedAt: null,
};

const CHAVE_REVOGADA: RunnerDeviceKeyListItem = {
  id: 'key-revogada',
  name: 'desktop antigo',
  projectId: 'proj-1',
  especie: 'projeto',
  createdAt: '2026-08-01T10:00:00.000Z',
  revokedAt: '2026-08-20T10:00:00.000Z',
  lastUsedAt: '2026-08-15T10:00:00.000Z',
};

function montar(secao: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    resources: { 'pt-BR': { settings: settingsPtBR, ui: uiPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'settings',
    ns: ['settings', 'ui'],
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

/**
 * Monta a seção com um papel de WORKSPACE e, opcionalmente, uma linha PRÓPRIA
 * em `project_members` — os dois insumos do papel efetivo.
 */
function cenario({
  noWorkspace = 'developer' as Role,
  noProjeto,
}: {
  noWorkspace?: Role;
  noProjeto?: Role;
} = {}) {
  useCurrentWorkspaceWithRole.mockReturnValue({
    data: { workspace: { id: 'ws-1' }, role: noWorkspace },
  });
  listProjectMembers.mockResolvedValue(
    noProjeto ? [{ userId: MEU_ID, role: noProjeto, email: 'eu@brabo.dev' }] : [],
  );
  return montar(<RunnerDeviceKeysSection projectId="proj-1" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  userIdDaSessao.mockReturnValue(MEU_ID);
  listRunnerDeviceKeys.mockResolvedValue([]);
  revokeRunnerDeviceKey.mockResolvedValue(undefined);
});

describe('chaves de dispositivo — a listagem', () => {
  it('marca a ESPÉCIE de cada linha: a de máquina não se disfarça de chave deste projeto', async () => {
    listRunnerDeviceKeys.mockResolvedValue([CHAVE_DE_PROJETO, CHAVE_DE_MAQUINA]);
    cenario();

    await screen.findByText('thinkpad-do-dani');
    expect(screen.getByText('Chrome do laptop')).toBeInTheDocument();
    // As duas marcas, e elas são diferentes — sem isso a de máquina seria
    // invisível, que é o defeito que a RN-543 fechou.
    expect(screen.getByText('máquina')).toBeInTheDocument();
    expect(screen.getByText('projeto')).toBeInTheDocument();
    expect(listRunnerDeviceKeys).toHaveBeenCalledWith('proj-1');
  });

  it('a REVOGADA continua na lista, marcada, e sem botão de revogar', async () => {
    listRunnerDeviceKeys.mockResolvedValue([CHAVE_DE_PROJETO, CHAVE_REVOGADA]);
    cenario();

    // Sumir com a linha faria a tela afirmar que a chave nunca existiu (RN-519).
    await screen.findByText('desktop antigo');
    expect(screen.getByText('revogada')).toBeInTheDocument();

    // Ativa tem botão; revogada não — revogar de novo é idempotente na api, mas
    // oferecer o gesto sugeriria que sobrou efeito a produzir.
    expect(
      screen.getByRole('button', { name: 'Revogar Chrome do laptop' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Revogar desktop antigo' }),
    ).not.toBeInTheDocument();
  });

  it('`lastUsedAt` nulo diz "nunca usada" e ganha a explicação da chave ÓRFÃ', async () => {
    listRunnerDeviceKeys.mockResolvedValue([CHAVE_ORFA]);
    cenario();

    await screen.findByText('aba que fechou');
    expect(screen.getByText('nunca usada')).toBeInTheDocument();
    expect(
      screen.getByText(/sobra de um fluxo de configuração interrompido/),
    ).toBeInTheDocument();
  });

  it('sem chave ORFÃ a explicação dela não aparece — texto sobre nada é ruído', async () => {
    listRunnerDeviceKeys.mockResolvedValue([CHAVE_DE_PROJETO]);
    cenario();

    await screen.findByText('Chrome do laptop');
    expect(
      screen.queryByText(/sobra de um fluxo de configuração interrompido/),
    ).not.toBeInTheDocument();
  });

  it('lista VAZIA e consulta FALHADA têm textos diferentes: "não sei" nunca vira "não tem"', async () => {
    listRunnerDeviceKeys.mockResolvedValue([]);
    const vazio = cenario();
    await screen.findByText('Nenhuma chave de dispositivo sua serve este projeto.');
    expect(screen.queryByText(/quer dizer que não sei/)).not.toBeInTheDocument();
    vazio.unmount();

    vi.clearAllMocks();
    userIdDaSessao.mockReturnValue(MEU_ID);
    listRunnerDeviceKeys.mockRejectedValue(new Error('fetch failed'));
    cenario();

    await screen.findByText(/quer dizer que não sei/);
    expect(
      screen.queryByText('Nenhuma chave de dispositivo sua serve este projeto.'),
    ).not.toBeInTheDocument();
  });

  it('a ressalva de que uso registrado NÃO é agente de pé está sempre em texto', async () => {
    listRunnerDeviceKeys.mockResolvedValue([CHAVE_DE_PROJETO]);
    cenario();

    await screen.findByText('Chrome do laptop');
    expect(
      screen.getByText(/Chave registrada não é agente rodando/),
    ).toBeInTheDocument();
  });
});

describe('chaves de dispositivo — revogar diz o ALCANCE antes de agir', () => {
  it('chave de MÁQUINA: o aviso nomeia todos os projetos, e confirmar chama a rota', async () => {
    listRunnerDeviceKeys.mockResolvedValue([CHAVE_DE_MAQUINA]);
    cenario();

    fireEvent.click(await screen.findByRole('button', { name: 'Revogar thinkpad-do-dani' }));

    // A frase que separa esta espécie da outra — sem ela a pessoa clicaria
    // achando que derruba o agente só aqui. O casamento é pela abertura do
    // parágrafo do MODAL: a legenda da seção também fala do alcance da espécie
    // de máquina, e um regex sobre o meio da frase acharia as duas.
    expect(
      screen.getByText(/^Esta é uma chave de MÁQUINA/),
    ).toBeInTheDocument();
    // E o custo colateral da RN-520, que vale para as duas espécies.
    expect(screen.getByText(/\{projeto, usuário\}/)).toBeInTheDocument();

    // Nada saiu antes de confirmar: o modal é a confirmação, não um aviso
    // depois do fato.
    expect(revokeRunnerDeviceKey).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Revogar' }));
    await waitFor(() =>
      expect(revokeRunnerDeviceKey).toHaveBeenCalledWith('proj-1', 'key-maquina'),
    );
  });

  it('chave de PROJETO: o aviso é OUTRO — não diz "todos os seus projetos"', async () => {
    listRunnerDeviceKeys.mockResolvedValue([CHAVE_DE_PROJETO]);
    cenario();

    fireEvent.click(await screen.findByRole('button', { name: 'Revogar Chrome do laptop' }));

    expect(
      screen.getByText(/^Esta é uma chave de PROJETO/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/^Esta é uma chave de MÁQUINA/),
    ).not.toBeInTheDocument();
  });

  it('cancelar não revoga nada', async () => {
    listRunnerDeviceKeys.mockResolvedValue([CHAVE_DE_PROJETO]);
    cenario();

    fireEvent.click(await screen.findByRole('button', { name: 'Revogar Chrome do laptop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await waitFor(() =>
      expect(
        screen.queryByText(/^Esta é uma chave de PROJETO/),
      ).not.toBeInTheDocument(),
    );
    expect(revokeRunnerDeviceKey).not.toHaveBeenCalled();
  });

  it('FALHA na revogação: a frase da api chega à tela e a chave continua na lista', async () => {
    listRunnerDeviceKeys.mockResolvedValue([CHAVE_DE_PROJETO]);
    revokeRunnerDeviceKey.mockRejectedValue(
      new ApiError(404, { message: 'Chave não encontrada' }),
    );
    cenario();

    fireEvent.click(await screen.findByRole('button', { name: 'Revogar Chrome do laptop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revogar' }));

    // A mensagem é a que a api mandou, não uma nossa.
    await screen.findByText('Chave não encontrada');
    expect(screen.getByText('Chrome do laptop')).toBeInTheDocument();
  });
});

describe('chaves de dispositivo — o papel é o do ENDPOINT, e é o EFETIVO do projeto', () => {
  it('`viewer`: a rota NÃO é chamada e o motivo é dito uma vez, em texto', async () => {
    cenario({ noWorkspace: 'viewer' });

    await screen.findByText(/exige papel developer neste projeto/);
    // A tela para de perguntar o que a api negaria (RN-548) — e um 403
    // previsível não vira "não consegui ler".
    expect(listRunnerDeviceKeys).not.toHaveBeenCalled();
    expect(screen.queryByText(/quer dizer que não sei/)).not.toBeInTheDocument();
    // Nenhum controle de revogação sobra na tela.
    expect(
      screen.queryByRole('button', { name: /^Revogar / }),
    ).not.toBeInTheDocument();
  });

  it('`developer` alcança: a rota é chamada e o texto de papel some', async () => {
    listRunnerDeviceKeys.mockResolvedValue([CHAVE_DE_PROJETO]);
    cenario({ noWorkspace: 'developer' });

    await screen.findByText('Chrome do laptop');
    expect(
      screen.queryByText(/exige papel developer neste projeto/),
    ).not.toBeInTheDocument();
  });

  it('a linha de projeto SOBREPÕE o workspace: `owner` lá, `viewer` aqui, não pergunta', async () => {
    // `projectRole ?? workspaceRole` (RN-471) — uma sobreposição nos dois
    // sentidos, e nunca "o maior dos dois".
    cenario({ noWorkspace: 'owner', noProjeto: 'viewer' });

    await screen.findByText(/exige papel developer neste projeto/);
    expect(listRunnerDeviceKeys).not.toHaveBeenCalled();
  });

  it('e no outro sentido: `viewer` no workspace, `developer` no projeto, pergunta', async () => {
    listRunnerDeviceKeys.mockResolvedValue([CHAVE_DE_PROJETO]);
    cenario({ noWorkspace: 'viewer', noProjeto: 'developer' });

    await screen.findByText('Chrome do laptop');
    expect(listRunnerDeviceKeys).toHaveBeenCalledWith('proj-1');
  });

  it('papel AUSENTE não é papel insuficiente: enquanto a lista de membros não volta, a tela diz que está verificando', async () => {
    useCurrentWorkspaceWithRole.mockReturnValue({ data: undefined });
    // Uma promessa que nunca resolve: o estado em voo, congelado.
    listProjectMembers.mockReturnValue(new Promise(() => {}));
    montar(<RunnerDeviceKeysSection projectId="proj-1" />);

    await screen.findByText('Carregando suas chaves de dispositivo…');
    // Acusar quem lê de não alcançar `developer` por ignorância é o defeito
    // que este caso fecha.
    expect(
      screen.queryByText(/exige papel developer neste projeto/),
    ).not.toBeInTheDocument();
  });
});

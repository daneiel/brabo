import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import settingsPtBR from '../../locales/pt-BR/settings.json';
import settingsEn from '../../locales/en/settings.json';
// A instância REAL do app: o `FolderBrowserModal` que esta seção passou a
// montar usa `useTranslation('terminal')` sem provider próprio, e os rótulos
// dos modos vêm do namespace `newProject`. Montar uma instância só com
// `settings` deixaria o modal renderizando chaves cruas.
import i18n from '../../lib/i18n';
import { ToastProvider } from '../../components/ui/ToastProvider';
import type { Project } from '../../lib/api-types';
import { ExecutionModeSection } from './ExecutionModeSection';

/**
 * A conversão de `execution_mode` parando de mentir sobre DUAS coisas.
 *
 * ## RN-559 — o navegador de pastas chega ao ramo `mounted`
 *
 * `ExecutionModeSection` era o único dos cinco lugares em que se digita o
 * caminho da pasta NO ESCURO; os outros quatro já abriam o
 * `FolderBrowserModal`. Aqui ele entra com `origem: { tipo: 'api',
 * workspaceId }` — o mesmo transporte que o wizard usa para `mounted`
 * (RN-504/RN-533), porque a pasta mora dentro da base do SERVIDOR e é o
 * servidor quem a enxerga.
 *
 * O ramo `runner` fica FORA de propósito, e não por esquecimento: o
 * transporte dele exige um runner conectado a ESTE projeto, que só passa a
 * existir depois da conversão — a ordem "converte, depois onboarda" é
 * decisão de produto declarada no `CLAUDE.md`. O que muda é a seção passar a
 * DIZER isso em texto, que é a régua do ADR 0064: tira-se o controle, nunca
 * a informação.
 *
 * E a base é um estado de QUATRO valores, não dois (RN-088/RN-468):
 * "consultando", "não consegui saber", "não existe" e "existe" têm textos
 * DIFERENTES, porque "não sei" nunca vira "não tem".
 *
 * ## RN-560 — o aviso para de prometer migração
 *
 * O texto dizia *"isto migra a pasta de trabalho do agente"*. O caso de uso
 * (`convert-project-execution-mode.use-case.ts`) move o `permissions.json`,
 * zera `workspaceVerifiedAt`/`mirrorPath` e desprovisiona o container — e
 * não tem UMA linha que copie ou mova conteúdo de pasta. O órfão no disco
 * antigo já era lacuna declarada; o que esta regra fecha é a tela afirmando
 * o contrário do que o servidor faz.
 */

const getProject = vi.fn();
const getProjectsBase = vi.fn();
const convertProjectExecutionMode = vi.fn();
const listProjectFolders = vi.fn();
const useCurrentWorkspaceWithRole = vi.fn();

vi.mock('../../lib/hooks', () => ({
  useCurrentWorkspaceWithRole: (...args: unknown[]) =>
    useCurrentWorkspaceWithRole(...args),
}));

vi.mock('../../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../../lib/api-client')>(
    '../../lib/api-client',
  );
  return {
    ...real,
    getProject: (...args: unknown[]) => getProject(...args),
    getProjectsBase: (...args: unknown[]) => getProjectsBase(...args),
    convertProjectExecutionMode: (...args: unknown[]) =>
      convertProjectExecutionMode(...args),
    listProjectFolders: (...args: unknown[]) => listProjectFolders(...args),
  };
});

function projeto(over: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    workspaceId: 'ws-1',
    name: 'Loja',
    slug: 'loja',
    executionMode: 'container',
    workspacePath: null,
    workspaceVerifiedAt: null,
    mirrorPath: null,
    ...over,
  } as Project;
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

async function montar() {
  render(
    <Wrapper>
      <ExecutionModeSection projectId="proj-1" />
    </Wrapper>,
  );
  // A seção devolve `null` até o projeto chegar.
  await screen.findByText(settingsPtBR.executionMode.title);
}

function trocarModoPara(modo: string) {
  fireEvent.change(screen.getByLabelText(settingsPtBR.executionMode.selectAria), {
    target: { value: modo },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('pt-BR');
  useCurrentWorkspaceWithRole.mockReturnValue({
    data: { workspace: { id: 'ws-1' }, role: 'maintainer' },
  });
  getProject.mockResolvedValue(projeto());
  getProjectsBase.mockResolvedValue({ projectsBase: '/home/dani/projetos' });
  convertProjectExecutionMode.mockResolvedValue(projeto());
  listProjectFolders.mockResolvedValue({
    base: '/home/dani/projetos',
    path: '/home/dani/projetos',
    entries: ['loja'],
    truncado: false,
    arquivos: 0,
    simbolicos: 0,
  });
});

afterEach(() => cleanup());

describe('RN-559 — o navegador de pastas no ramo `mounted`', () => {
  it('caminho feliz: escolher uma pasta no navegador preenche o campo, e a conversão envia o que foi ESCOLHIDO', async () => {
    await montar();
    trocarModoPara('mounted');

    // A base existe, então o botão está vivo e a seção diz onde o navegador
    // vai abrir — nomeando a base, que é o dado que a pessoa não tem como
    // adivinhar.
    const procurar = await screen.findByRole('button', { name: /Procurar pasta/ });
    await waitFor(() => expect(procurar).not.toBeDisabled());
    expect(
      screen.getByText(/base de projetos desta instalação \(\/home\/dani\/projetos\)/),
    ).toBeTruthy();

    fireEvent.click(procurar);

    // O transporte é o de API — o mesmo do wizard para `mounted` —, e é ele
    // que lista. `origem: { tipo: 'runner' }` aqui seria um runner que não
    // existe ainda.
    await waitFor(() => expect(listProjectFolders).toHaveBeenCalled());
    expect(listProjectFolders.mock.calls[0][0]).toBe('ws-1');

    const pasta = await screen.findByText('loja');
    fireEvent.click(pasta);
    fireEvent.click(screen.getByRole('button', { name: 'Usar esta pasta' }));

    const campo = screen.getByLabelText(
      settingsPtBR.executionMode.pathAria,
    ) as HTMLInputElement;
    await waitFor(() => expect(campo.value).toBe('/home/dani/projetos/loja'));

    // O valor escolhido é DIGITADO no mesmo sentido do campo: ele só vai para
    // a api quando alguém confirma no botão da seção (RN-469 — esta seção não
    // vira autosave).
    expect(convertProjectExecutionMode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Converter' }));
    await waitFor(() =>
      expect(convertProjectExecutionMode).toHaveBeenCalledWith('proj-1', {
        executionMode: 'mounted',
        workspacePath: '/home/dani/projetos/loja',
      }),
    );
  });

  it('caso de falha: a consulta da base FALHA — o botão fica inerte, o motivo é dito em texto, e "não sei" não vira "não tem"', async () => {
    getProjectsBase.mockRejectedValue(new Error('rede'));
    await montar();
    trocarModoPara('mounted');

    const procurar = await screen.findByRole('button', { name: /Procurar pasta/ });
    await waitFor(() => expect(procurar).toBeDisabled());

    // O texto do estado "falhou" é PRÓPRIO, e não o de "não existe": um diz
    // que não deu para saber, o outro afirma ausência.
    expect(screen.getByText(settingsPtBR.executionMode.path.baseUnknown)).toBeTruthy();
    expect(screen.queryByText(settingsPtBR.executionMode.path.noBase)).toBeNull();

    // O campo continua editável — a base indisponível tira o NAVEGADOR, nunca
    // a capacidade de converter.
    const campo = screen.getByLabelText(settingsPtBR.executionMode.pathAria);
    expect(campo).not.toBeDisabled();

    // E o modal não monta nem à força: sem base não há de onde listar.
    fireEvent.click(procurar);
    expect(listProjectFolders).not.toHaveBeenCalled();
  });

  it('base AUSENTE tem texto próprio, e é diferente do de base em consulta', async () => {
    getProjectsBase.mockResolvedValue({ projectsBase: null });
    await montar();
    trocarModoPara('mounted');

    expect(await screen.findByText(settingsPtBR.executionMode.path.noBase)).toBeTruthy();
    expect(screen.queryByText(settingsPtBR.executionMode.path.baseUnknown)).toBeNull();
    expect(screen.queryByText(settingsPtBR.executionMode.path.baseLoading)).toBeNull();
  });

  it('o ramo `runner` NÃO ganha navegador, e a seção diz por quê em texto', async () => {
    await montar();
    trocarModoPara('runner');

    expect(screen.queryByRole('button', { name: /Procurar pasta/ })).toBeNull();
    expect(screen.getByText(settingsPtBR.executionMode.path.runnerTyped)).toBeTruthy();
    // O campo segue lá, digitável: o que falta é o navegador, não a conversão.
    expect(screen.getByLabelText(settingsPtBR.executionMode.pathAria)).not.toBeDisabled();
  });

  it('quem não alcança `maintainer` — o mínimo do ENDPOINT — não recebe controle nenhum, nem a consulta da base', async () => {
    useCurrentWorkspaceWithRole.mockReturnValue({
      data: { workspace: { id: 'ws-1' }, role: 'developer' },
    });
    getProject.mockResolvedValue(projeto({ executionMode: 'mounted', workspacePath: '/home/dani/projetos/loja' }));
    await montar();

    expect(screen.getByLabelText(settingsPtBR.executionMode.selectAria)).toBeDisabled();
    expect(screen.getByLabelText(settingsPtBR.executionMode.pathAria)).toBeDisabled();
    expect(screen.getByRole('button', { name: /Procurar pasta/ })).toBeDisabled();
    // O motivo é dito UMA vez, em TEXTO (`title` em `disabled` não abre no
    // Chromium).
    expect(
      screen.getByText(new RegExp(settingsPtBR.executionMode.needsMaintainer)),
    ).toBeTruthy();
    // A INFORMAÇÃO fica: o caminho vigente continua visível.
    expect(
      (screen.getByLabelText(settingsPtBR.executionMode.pathAria) as HTMLInputElement).value,
    ).toBe('/home/dani/projetos/loja');
    // A rota da base pede o mesmo `maintainer`: perguntar seria um 403 certo.
    expect(getProjectsBase).not.toHaveBeenCalled();
  });
});

describe('RN-560 — o aviso da conversão', () => {
  it('caminho feliz: o aviso NOMEIA o caminho antigo e diz que o conteúdo NÃO vai junto', async () => {
    getProject.mockResolvedValue(
      projeto({ executionMode: 'mounted', workspacePath: '/home/dani/projetos/loja' }),
    );
    await montar();

    expect(screen.getByText(settingsPtBR.executionMode.warning.refuses)).toBeTruthy();
    expect(screen.getByText(settingsPtBR.executionMode.warning.carries)).toBeTruthy();
    const leva = screen.getByText(/NÃO copia nem move o conteúdo da pasta/);
    expect(leva.textContent).toContain('/home/dani/projetos/loja');
    expect(leva.textContent).toContain('trabalho não commitado');
  });

  it('caso de falha do texto antigo: a promessa de migração não sobrevive em NENHUM dos dois idiomas', () => {
    // O aviso vive em duas línguas, e `en` é o idioma default do app (RN-425)
    // — corrigir só o pt-BR seria a mesma mentira com sotaque.
    expect(JSON.stringify(settingsPtBR.executionMode)).not.toContain('migra a pasta');
    expect(JSON.stringify(settingsEn.executionMode)).not.toContain('migrates the');
    for (const bundle of [settingsPtBR, settingsEn]) {
      expect(typeof bundle.executionMode.warning).toBe('object');
      expect(bundle.executionMode.warning.refuses.length).toBeGreaterThan(0);
      expect(bundle.executionMode.warning.carries.length).toBeGreaterThan(0);
      expect(bundle.executionMode.warning.leavesPath).toContain('{{caminho}}');
      expect(bundle.executionMode.warning.leavesManaged.length).toBeGreaterThan(0);
    }
  });

  it('sem caminho antigo (o projeto é `container`), o aviso aponta a pasta GERENCIADA em vez de um caminho vazio', async () => {
    await montar();

    expect(screen.getByText(settingsPtBR.executionMode.warning.leavesManaged)).toBeTruthy();
    // Nada de "fica em ``" — a variante com caminho não é renderizada.
    expect(screen.queryByText(/O que estiver em \s*—/)).toBeNull();
  });
});

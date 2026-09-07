import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NewProjectWizard } from './NewProjectWizard';
import { ToastProvider } from '../components/ui/ToastProvider';
// A instância REAL do app: `FolderBrowserModal`/`Modal` usam
// `useTranslation('terminal'|'ui')` sem `I18nextProvider` próprio (mesmo
// padrão de `Dashboard.test.tsx`) — `NewProjectWizard.tsx` em si ainda não
// foi migrado, então só o modal de pasta depende disto.
import i18n from '../lib/i18n';

const createProject = vi.fn();
const listCredentials = vi.fn();
const registerGitCredential = vi.fn();
const listProjectFolders = vi.fn();
const getProjectsBase = vi.fn();

vi.mock('../lib/api-client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    // `body` entrou porque a recusa do caminho Local (RN-170) é lida DALI: a
    // mensagem que ensina como montar a pasta vem no corpo da resposta, não
    // no `message` do erro de transporte.
    constructor(status: number, body?: unknown) {
      super(`api error ${status}`);
      this.status = status;
      this.body = body;
    }
  },
  createProject: (...a: unknown[]) => createProject(...a),
  listCredentials: (...a: unknown[]) => listCredentials(...a),
  registerGitCredential: (...a: unknown[]) => registerGitCredential(...a),
  // O navegador de pastas passou a ser servido pela api (RN-504): o modal
  // usa `criarFsBrowserViaApi`, que fala com estas duas.
  listProjectFolders: (...a: unknown[]) => listProjectFolders(...a),
  // A base dos projetos montados (ADR 0141/0146 ponto 4, RN-513): é ELA que
  // decide se o card "Pasta montada" é sequer oferecido, então todo teste
  // que chega ao passo de workspace passa por aqui.
  getProjectsBase: (...a: unknown[]) => getProjectsBase(...a),
  mensagemDaApi: (erro: unknown) => (erro instanceof Error ? erro.message : 'Erro'),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

// O `FolderBrowserModal` real é montado quando "Procurar pasta" abre. Desde a
// RN-504 ele fala com a API (`listProjectFolders`, mockada acima) e não mais
// com o canal Phoenix — este dublê fica porque o módulo do canal segue
// importado pelo componente, e sem ele o `Socket` do phoenix.js tentaria
// conectar de verdade se algum caminho voltasse a usá-lo.
const { connectFsBrowserChannelMock } = vi.hoisted(() => {
  const fakeChannel = {
    listarDiretorio: vi.fn().mockResolvedValue({ path: '/home/user', entradas: [] }),
    diretorioInicial: vi.fn().mockResolvedValue({ path: '/home/user' }),
    fechar: vi.fn(),
  };
  const connectFsBrowserChannelMock = vi.fn(() => fakeChannel);
  return { connectFsBrowserChannelMock };
});

vi.mock('../lib/fs-browser-channel', () => ({
  connectFsBrowserChannel: connectFsBrowserChannelMock,
}));

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <NewProjectWizard workspaceId="ws-1" onClose={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** Avança do passo 1 (modo) e 2 (provider) até o de nome e visibilidade. */
async function ateVisibilidade(provider: 'GitHub' | 'Local') {
  montar();
  fireEvent.click(screen.getByText('Criar novo'));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  fireEvent.click(screen.getByText(provider));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

  // O GitHub tem um passo de credencial no meio; com uma já cadastrada ele
  // auto-seleciona num efeito, e só ENTÃO o Continuar libera. Clicar antes
  // disso não avança — foi o que fez este helper parar no passo 3.
  if (provider === 'GitHub') {
    const continuar = await screen.findByRole('button', { name: 'Continuar' });
    await waitFor(() => expect(continuar).not.toBeDisabled());
    fireEvent.click(continuar);
  }
}

/** Do passo 1 até o de workspace, no provider Local (sem credencial). */
async function ateWorkspace() {
  await ateVisibilidade('Local');
  fireEvent.change(screen.getByLabelText('Nome do projeto'), {
    target: { value: 'Loja' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await screen.findByText('Onde o código vai morar');
}

const BASE = '/home/user/projetos-brabo';

/**
 * O mesmo caminho, numa instalação COM base consentida (ADR 0146 ponto 4).
 *
 * O mock precisa ser armado ANTES de montar o assistente: a consulta nasce
 * com ele, não com o passo. O `findByText` do card espera a resposta chegar
 * — até lá o card não existe, por decisão (RN-513).
 */
async function ateWorkspaceComBase(base: string = BASE) {
  getProjectsBase.mockResolvedValue({ projectsBase: base });
  await ateWorkspace();
  await screen.findByText('Pasta montada');
}

/** A classe do card selecionado é hasheada pelo CSS module — só o sufixo importa. */
function estaSelecionado(rotulo: string): boolean {
  const botao = screen.getByText(rotulo).closest('button');
  return /selected/.test(botao?.className ?? '');
}

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
  vi.clearAllMocks();
  // O default dos testes é a instalação SEM base — o estado de quem clonou
  // o produto e ainda não rodou o consentimento do `pnpm bootstrap`. Quem
  // precisa do modo Pasta montada liga a base explicitamente.
  getProjectsBase.mockResolvedValue({ projectsBase: null });
  listProjectFolders.mockResolvedValue({
    base: '/home/user/brabo',
    path: '/home/user/brabo',
    entries: [],
    truncado: false,
    arquivos: 0,
    simbolicos: 0,
  });
  listCredentials.mockResolvedValue([
    {
      id: 'cred-1',
      provider: 'github',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
  ]);
});
afterAll(() => {
  void i18n.changeLanguage('en');
});

/**
 * O aviso do repositório privado no GitHub.
 *
 * No plano gratuito, repositório privado NÃO aceita proteção de branch — e o
 * bootstrap descobre isso no último passo, com o repositório já criado e a
 * mensagem crua da API na tela. Era tarde demais para uma decisão que se toma
 * dois passos antes.
 */
describe('NewProjectWizard — aviso de repositório privado', () => {
  it('avisa quando o provider é GitHub e a visibilidade é privada', async () => {
    await ateVisibilidade('GitHub');

    expect(
      await screen.findByText(/não aceita proteção de branch/i),
    ).toBeTruthy();
  });

  it('some ao escolher Público — lá a proteção funciona', async () => {
    await ateVisibilidade('GitHub');
    await screen.findByText(/não aceita proteção de branch/i);

    fireEvent.click(screen.getByRole('button', { name: 'Público' }));

    expect(screen.queryByText(/não aceita proteção de branch/i)).toBeNull();
  });

  /** O limite é do GitHub. Repetir o aviso no Local seria mentira. */
  it('não aparece no provider Local, que não tem plano nenhum', async () => {
    await ateVisibilidade('Local');

    expect(screen.queryByText(/não aceita proteção de branch/i)).toBeNull();
  });
});

/**
 * O passo "Onde o código vai morar" (RN-169/RN-170, ADR 0072).
 *
 * Duas coisas são provadas aqui, e a segunda é o ponto da entrega: que o modo
 * escolhido CHEGA à api, e que a recusa dela — a mensagem que ensina a montar
 * a pasta — aparece NA TELA em vez de virar um toast genérico.
 */
describe('NewProjectWizard — onde o código vai morar', () => {
  it('Container é o pré-selecionado e vai para a api como tal — nada muda para quem não escolhe', async () => {
    createProject.mockResolvedValue({ id: 'proj-1' });
    await ateWorkspace();

    // Avança sem digitar nada: é o comportamento de sempre.
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Provisionar' }));

    await waitFor(() => expect(createProject).toHaveBeenCalled());
    expect(createProject.mock.calls[0][1]).toEqual({
      name: 'Loja',
      slug: 'loja',
      executionMode: 'container',
    });
  });

  it('Pasta montada manda o caminho digitado, e só ele', async () => {
    createProject.mockResolvedValue({ id: 'proj-1' });
    await ateWorkspaceComBase();

    fireEvent.click(screen.getByText('Pasta montada'));
    fireEvent.change(screen.getByLabelText('Caminho da pasta'), {
      target: { value: '/home/voce/projetos/loja' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Provisionar' }));

    await waitFor(() => expect(createProject).toHaveBeenCalled());
    expect(createProject.mock.calls[0][1]).toEqual({
      name: 'Loja',
      slug: 'loja',
      executionMode: 'mounted',
      workspacePath: '/home/voce/projetos/loja',
    });
  });

  /**
   * A sugestão `<base>/<slug>` preenche o campo (RN-501/RN-513) — apagá-la é
   * escolha do usuário, e a tela NÃO a reescreve por cima. Sem caminho
   * nenhum, o passo continua travado: a régua de avanço é
   * `canAdvanceFromWorkspace`, que a pré-seleção não relaxou.
   */
  it('Pasta montada com o campo apagado não avança, e a sugestão não volta sozinha', async () => {
    await ateWorkspaceComBase();

    fireEvent.click(screen.getByText('Pasta montada'));
    const campo = screen.getByLabelText('Caminho da pasta');
    expect(campo).toHaveValue(`${BASE}/loja`);

    fireEvent.change(campo, { target: { value: '' } });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled(),
    );
    expect(screen.getByLabelText('Caminho da pasta')).toHaveValue('');
  });

  it('a RECUSA da api aparece na tela com a instrução de montagem, não como toast genérico', async () => {
    const { ApiError } = await import('../lib/api-client');
    createProject.mockRejectedValue(
      new (ApiError as new (s: number, b: unknown) => Error)(400, {
        message:
          'A pasta /home/voce/projetos/loja não existe do lado de dentro da api. ' +
          'No docker/docker-compose.yml, acrescente a mesma linha aos serviços "api" e "engine".',
      }),
    );
    await ateWorkspaceComBase();

    fireEvent.click(screen.getByText('Pasta montada'));
    fireEvent.change(screen.getByLabelText('Caminho da pasta'), {
      target: { value: '/home/voce/projetos/loja' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Provisionar' }));

    expect(
      await screen.findByText(/não existe do lado de dentro da api/i),
    ).toBeTruthy();
    expect(screen.getByText(/docker-compose\.yml/)).toBeTruthy();
  });

  /**
   * "Procurar pasta..." em `mounted` NAVEGA de verdade desde a RN-504.
   *
   * Antes desta entrega o modal abria com `projectId: null` e mostrava um
   * estado declarado ("depois que o projeto existir…"), porque o único
   * transporte era o canal do runner e ele precisa de um projeto para
   * ancorar. A base de projetos montados não depende de projeto nenhum, e
   * NENHUM projeto é criado por abrir o navegador — que é o que o
   * `createProject` não chamado prova aqui.
   */
  it('"Procurar pasta..." navega pela base servida pela api, sem criar projeto', async () => {
    listProjectFolders.mockResolvedValue({
      base: '/home/user/brabo',
      path: '/home/user/brabo',
      entries: ['clientes'],
      truncado: false,
      arquivos: 0,
      simbolicos: 0,
    });
    await ateWorkspaceComBase();
    fireEvent.click(screen.getByText('Pasta montada'));

    fireEvent.click(screen.getByRole('button', { name: /Procurar pasta/i }));

    expect(await screen.findByText('clientes')).toBeTruthy();
    // O modal abre NA sugestão que a tela já tinha escrito no campo
    // (`<base>/<slug>`, RN-513) — antes dela existir, abria na base.
    expect(listProjectFolders).toHaveBeenCalledWith('ws-1', `${BASE}/loja`);
    expect(createProject).not.toHaveBeenCalled();
    // O canal do runner não é sequer aberto: o transporte é outro.
    expect(connectFsBrowserChannelMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    fireEvent.change(screen.getByLabelText('Caminho da pasta'), {
      target: { value: '/home/voce/projetos/loja' },
    });
    expect(screen.getByLabelText('Caminho da pasta')).toHaveValue(
      '/home/voce/projetos/loja',
    );
  });

  /** RN-423 (ADR 0104): sem bind-mount, o caminho só é confirmado quando o
   * runner conectar — nada aqui trava a criação nem promete recusa na hora. */
  it('Runner local manda o caminho digitado e mostra o comando pra confirmar depois', async () => {
    createProject.mockResolvedValue({ id: 'proj-1' });
    await ateWorkspace();

    fireEvent.click(screen.getByText('Runner local'));
    fireEvent.change(screen.getByLabelText('Caminho da pasta'), {
      target: { value: '/home/voce/projetos/loja' },
    });

    // Converge para o MESMO `RunnerOnboardingPanel` de `TerminalPanel`/
    // `FolderBrowserModal` — o comando manual (colapsado atrás de "Prefiro
    // rodar manualmente") agora inclui `--token`, o que a divergência de
    // antes não fazia.
    expect(screen.getByText(/brabo-runner --project/)).toBeTruthy();
    expect(screen.getByText(/--token/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Provisionar' }));

    await waitFor(() => expect(createProject).toHaveBeenCalled());
    expect(createProject.mock.calls[0][1]).toEqual({
      name: 'Loja',
      slug: 'loja',
      executionMode: 'runner',
      workspacePath: '/home/voce/projetos/loja',
    });
  });

  it('Runner local sem caminho não avança — mesma régua léxica de Pasta montada', async () => {
    await ateWorkspace();

    fireEvent.click(screen.getByText('Runner local'));

    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });
});

/**
 * A base decide o que a criação OFERECE (RN-513, ADR 0146 ponto 4).
 *
 * As duas metades já eram regra desde o ADR 0141 (RN-500, "não oferecer sem
 * base") e o ADR 0142 (RN-501, "sugerir `<base>/<slug>`"), e nenhuma das
 * duas tinha chegado ao cliente: `GET .../projects-base` não tinha chamador
 * nenhum, e o card era oferecido incondicionalmente. O que é NOVO aqui é a
 * pré-seleção, que revisa o default do ADR 0072 só para a instalação local.
 */
describe('NewProjectWizard — a base de projetos decide o que é oferecido', () => {
  it('com base, Pasta montada é o pré-selecionado e o campo abre com <base>/<slug>', async () => {
    await ateWorkspaceComBase();

    expect(estaSelecionado('Pasta montada')).toBe(true);
    expect(estaSelecionado('Container')).toBe(false);
    // O campo de caminho só existe fora do modo Container: a presença dele
    // já prova o modo vigente, e o valor prova a sugestão.
    expect(screen.getByLabelText('Caminho da pasta')).toHaveValue(
      `${BASE}/loja`,
    );
    expect(getProjectsBase).toHaveBeenCalledWith('ws-1');
  });

  it('a sugestão acompanha o nome enquanto ninguém digitou por cima', async () => {
    await ateWorkspaceComBase();
    expect(screen.getByLabelText('Caminho da pasta')).toHaveValue(
      `${BASE}/loja`,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    fireEvent.change(screen.getByLabelText('Nome do projeto'), {
      target: { value: 'Loja Nova' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    await waitFor(() =>
      expect(screen.getByLabelText('Caminho da pasta')).toHaveValue(
        `${BASE}/loja-nova`,
      ),
    );
  });

  it('caminho digitado NUNCA é sobrescrito pela sugestão, nem quando o nome muda', async () => {
    await ateWorkspaceComBase();
    fireEvent.change(screen.getByLabelText('Caminho da pasta'), {
      target: { value: `${BASE}/minha-pasta` },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    fireEvent.change(screen.getByLabelText('Nome do projeto'), {
      target: { value: 'Loja Nova' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByText('Onde o código vai morar');

    expect(screen.getByLabelText('Caminho da pasta')).toHaveValue(
      `${BASE}/minha-pasta`,
    );
  });

  /**
   * `projectsBase: null` é estado NORMAL — a instalação não tem
   * `BRABO_PROJECTS_BASE`. Oferecer o modo aqui terminaria na recusa da api
   * (400) depois de o usuário ter escolhido, digitado e chegado ao fim.
   */
  it('sem base, o card Pasta montada não existe e Container segue selecionado', async () => {
    getProjectsBase.mockResolvedValue({ projectsBase: null });
    await ateWorkspace();

    // Espera a resposta chegar: se o card fosse aparecer, apareceria aqui.
    await waitFor(() => expect(getProjectsBase).toHaveBeenCalled());
    expect(screen.queryByText('Pasta montada')).toBeNull();
    expect(estaSelecionado('Container')).toBe(true);
    // Os outros dois continuam onde estavam — nada além de `mounted` sai.
    expect(screen.getByText('Runner local')).toBeTruthy();
  });

  /**
   * Consulta que FALHA não é permissão para oferecer: "não sei" não vira
   * "tem", pela mesma régua da RN-088/RN-468 e dos ADRs 0041/0042
   * (capability só se declara quando provada).
   */
  it('consulta recusada (403) não oferece Pasta montada — desconhecido não vira oferta', async () => {
    const { ApiError } = await import('../lib/api-client');
    getProjectsBase.mockRejectedValue(
      new (ApiError as new (s: number, b: unknown) => Error)(403, {
        message: 'Forbidden',
      }),
    );
    await ateWorkspace();

    await waitFor(() => expect(getProjectsBase).toHaveBeenCalled());
    expect(screen.queryByText('Pasta montada')).toBeNull();
    expect(estaSelecionado('Container')).toBe(true);
  });

  /**
   * A base chega por rede, sempre DEPOIS do primeiro render. Trocar o modo
   * debaixo da mão de quem já clicou é defeito, não conveniência.
   */
  it('quem escolheu Container antes de a base chegar não é sobrescrito', async () => {
    let liberar!: (v: { projectsBase: string | null }) => void;
    getProjectsBase.mockReturnValue(
      new Promise<{ projectsBase: string | null }>((resolve) => {
        liberar = resolve;
      }),
    );
    await ateWorkspace();

    // Ainda DESCONHECIDA: só Container e Runner na tela.
    expect(screen.queryByText('Pasta montada')).toBeNull();
    fireEvent.click(screen.getByText('Container'));

    liberar({ projectsBase: BASE });

    // O card passa a existir (a base existe), mas a escolha humana fica.
    expect(await screen.findByText('Pasta montada')).toBeTruthy();
    expect(estaSelecionado('Container')).toBe(true);
    expect(estaSelecionado('Pasta montada')).toBe(false);
    expect(screen.queryByLabelText('Caminho da pasta')).toBeNull();
  });

  /**
   * O aviso do modo montado tem DOIS estados, e são os dois que o backend
   * tem (RN-500/RN-501): sob a base a criação passa e a pasta nem precisa
   * existir; fora dela a api recusa com 400.
   */
  it('caminho fora da base avisa da recusa nomeando a base; sob a base, nota neutra', async () => {
    await ateWorkspaceComBase();

    // `getAllByText`: o `<Trans>` quebra a frase em `<strong>`/`<code>`, e a
    // asserção é sobre a FRASE estar na tela, não sobre quantos nós a
    // carregam. As duas frases escolhidas são exclusivas de cada estado — o
    // card do modo já diz "dentro da base de projetos" o tempo todo.
    expect(
      screen.getAllByText(/não precisa existir ainda/i).length,
    ).toBeGreaterThan(0);
    expect(screen.queryAllByText(/recusa a criação/i)).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Caminho da pasta'), {
      target: { value: '/tmp/fora' },
    });

    await waitFor(() =>
      expect(screen.getAllByText(/recusa a criação/i).length).toBeGreaterThan(
        0,
      ),
    );
    expect(screen.queryAllByText(/não precisa existir ainda/i)).toHaveLength(0);
    // O aviso NOMEIA a base, em vez de mandar procurar a variável.
    expect(screen.getAllByText(BASE).length).toBeGreaterThan(0);
  });
});

/**
 * Navegação de pasta ANTECIPADA no modo Runner (RN-437, ADR 0108).
 *
 * `ADR 0107` tinha declarado como lacuna: "Procurar pasta..." não conseguia
 * ancorar num projeto porque ele só nascia na confirmação.
 *
 * Desde a RN-504 o MODAL já não depende disso — ele navega a base pela api,
 * nos dois modos. A criação antecipada, porém, CONTINUA no assistente, e é
 * por isso que estes casos seguem aqui: ela é removida no PR seguinte deste
 * plano, junto com o modo `runner` na criação, e até lá o comportamento tem
 * de continuar coberto.
 */
describe('NewProjectWizard — navegação de pasta antecipada no modo Runner', () => {
  async function ateWorkspaceRunner() {
    await ateWorkspace();
    fireEvent.click(screen.getByText('Runner local'));
  }

  it('"Procurar pasta..." cria o projeto antecipadamente e abre o modal com o id real', async () => {
    createProject.mockResolvedValue({ id: 'proj-runner-1' });
    await ateWorkspaceRunner();
    fireEvent.change(screen.getByLabelText('Caminho da pasta'), {
      target: { value: '/home/voce/projetos/loja' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Procurar pasta/i }));

    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(1));
    expect(createProject.mock.calls[0][1]).toEqual({
      name: 'Loja',
      slug: 'loja',
      executionMode: 'runner',
      workspacePath: '/home/voce/projetos/loja',
    });
    // A criação antecipada CONTINUA acontecendo (é o caminho que o PR
    // seguinte do plano remove); o que mudou é que o modal já não usa o id
    // criado — ele navega a base pela api. Manter esta asserção provaria o
    // contrário do código.
    // O caminho já digitado vira a pasta de abertura, e o workspace é o que
    // ancora o transporte.
    await waitFor(() =>
      expect(listProjectFolders).toHaveBeenCalledWith('ws-1', '/home/voce/projetos/loja'),
    );
    expect(connectFsBrowserChannelMock).not.toHaveBeenCalled();
  });

  it('sem digitar nada ainda, cria com o caminho PLACEHOLDER — nunca com o campo vazio', async () => {
    createProject.mockResolvedValue({ id: 'proj-runner-1' });
    await ateWorkspaceRunner();

    fireEvent.click(screen.getByRole('button', { name: /Procurar pasta/i }));

    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(1));
    expect(createProject.mock.calls[0][1]).toMatchObject({
      executionMode: 'runner',
      workspacePath: expect.stringMatching(/^\/\S+$/),
    });
    expect(createProject.mock.calls[0][1].workspacePath).not.toBe('');
  });

  it('clicar de novo sem mudar nada NÃO cria outro projeto — reusa o mesmo id', async () => {
    createProject.mockResolvedValue({ id: 'proj-runner-1' });
    await ateWorkspaceRunner();
    fireEvent.change(screen.getByLabelText('Caminho da pasta'), {
      target: { value: '/home/voce/projetos/loja' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Procurar pasta/i }));
    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: /Procurar pasta/i }));

    await waitFor(() => expect(listProjectFolders).toHaveBeenCalled());
    expect(createProject).toHaveBeenCalledTimes(1);
  });

  it('mudar o nome depois de navegar invalida o snapshot — uma nova navegada cria outro projeto', async () => {
    createProject
      .mockResolvedValueOnce({ id: 'proj-runner-1' })
      .mockResolvedValueOnce({ id: 'proj-runner-2' });
    await ateWorkspaceRunner();
    fireEvent.change(screen.getByLabelText('Caminho da pasta'), {
      target: { value: '/home/voce/projetos/loja' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Procurar pasta/i }));
    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));

    // Volta ao passo de detalhes e muda o nome — invalida o snapshot que
    // autorizou o projeto anterior.
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    fireEvent.change(screen.getByLabelText('Nome do projeto'), {
      target: { value: 'Loja Nova' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await screen.findByText('Onde o código vai morar');

    fireEvent.click(screen.getByRole('button', { name: /Procurar pasta/i }));

    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(2));
    expect(createProject.mock.calls[1][1]).toMatchObject({
      name: 'Loja Nova',
      slug: 'loja-nova',
    });
  });

  it('handleConfirm reaproveita o projeto criado ao navegar, sem duplicar', async () => {
    createProject.mockResolvedValue({ id: 'proj-runner-1' });
    await ateWorkspaceRunner();
    fireEvent.change(screen.getByLabelText('Caminho da pasta'), {
      target: { value: '/home/voce/projetos/loja' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Procurar pasta/i }));
    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' })); // workspace → policy
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' })); // policy → confirm
    fireEvent.click(screen.getByRole('button', { name: 'Provisionar' }));

    // `createProject` já tinha sido chamado uma vez ao navegar — este
    // `waitFor` só confirma que o clique em "Provisionar" foi processado
    // (o botão mostra "Criando…" enquanto `handleConfirm` está em voo).
    await screen.findByRole('button', { name: 'Criando…' });
    // Dá tempo pro resto do `handleConfirm` assíncrono (invalidateQueries)
    // terminar — sem isso, uma segunda chamada a `createProject` (o bug que
    // este teste existe pra provar que NÃO acontece) só apareceria depois.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(createProject).toHaveBeenCalledTimes(1);
  });
});

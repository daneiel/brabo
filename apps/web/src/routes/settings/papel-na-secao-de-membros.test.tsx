import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import settingsPtBR from '../../locales/pt-BR/settings.json';
import { ToastProvider } from '../../components/ui/ToastProvider';
import { ApiError } from '../../lib/api-client';
import type { Role } from '../../lib/api-types';
import { MembersSection } from './MembersSection';

/**
 * O PAPEL na seção de Membros — quem pode convidar, trocar papel e remover.
 *
 * ## O mínimo é `maintainer`, e NÃO o `developer` da seção de modelos
 *
 * É a régua do ENDPOINT, nunca da seção vizinha ([RN-102](docs/business-rules/custo.md#rn-102)),
 * e aqui as TRÊS ações pedem o mesmo (`projects.controller.ts`):
 *
 * | ação | endpoint | papel |
 * |---|---|---|
 * | convidar | `POST :projectId/members` | `maintainer` |
 * | trocar papel | `POST :projectId/members` (upsert) | `maintainer` |
 * | remover | `DELETE :projectId/members/:userId` | `maintainer` |
 * | ver a tabela | `GET :projectId/members` | `viewer` |
 *
 * É a SEGUNDA vez seguida que uma seção desta família tem mínimo diferente da
 * vizinha, e é por isso que o caso do `developer` abaixo existe: copiar o gate
 * de `ModelsSection` (que pede `developer`, e está certa) ofereceria aqui os
 * três controles a quem a api recusa.
 *
 * ## O papel é o EFETIVO do PROJETO, não o do workspace
 *
 * A #443 declarou a lacuna: `ModelsSection` lê o papel de WORKSPACE, e quem
 * autoriza do outro lado é `ResolveEffectiveRoleUseCase.forProject`. Esta seção
 * fecha essa lacuna em vez de repeti-la, porque tem com quê: `listProjectMembers`
 * já É `findMemberRole` para todo mundo, e `userIdDaSessao()` diz qual linha é a
 * minha. O par de casos em "papel efetivo" é o que prova a composição —
 * `projectRole ?? workspaceRole`, uma SOBREPOSIÇÃO nos dois sentidos, e nunca
 * "o maior dos dois" que três descrições de OpenAPI ainda prometem.
 *
 * ## Desabilitar, não esconder
 *
 * Quem não pode editar continua LENDO o papel de cada membro no próprio
 * `Select` (ADR 0064): some o controle, nunca a informação. O motivo é dito uma
 * vez, em TEXTO, na legenda — `title` em elemento `disabled` não abre no
 * Chromium.
 */

const listProjectMembers = vi.fn();
const addProjectMember = vi.fn();
const removeProjectMember = vi.fn();
const useCurrentWorkspaceWithRole = vi.fn();
const userIdDaSessao = vi.fn();

vi.mock('../../lib/hooks', () => ({
  useCurrentWorkspaceWithRole: (...args: unknown[]) =>
    useCurrentWorkspaceWithRole(...args),
}));

vi.mock('../../lib/auth', () => ({
  userIdDaSessao: (...args: unknown[]) => userIdDaSessao(...args),
}));

// `ApiError` e `mensagemDaApi` entram de VERDADE: o que se prova nos desfechos
// é que a frase da api CHEGA à tela, e um dublê deles provaria só o dublê.
vi.mock('../../lib/api-client', async () => {
  const real = await vi.importActual<typeof import('../../lib/api-client')>(
    '../../lib/api-client',
  );
  return {
    ApiError: real.ApiError,
    mensagemDaApi: real.mensagemDaApi,
    listProjectMembers: (...args: unknown[]) => listProjectMembers(...args),
    addProjectMember: (...args: unknown[]) => addProjectMember(...args),
    removeProjectMember: (...args: unknown[]) => removeProjectMember(...args),
  };
});

/** Quem está olhando. A linha dele na tabela é o que decide o papel efetivo. */
const MEU_ID = 'user-eu';

/** A outra pessoa da tabela — a linha sobre a qual as três ações agem. */
const ANA = {
  userId: 'user-ana',
  role: 'developer' as Role,
  name: 'Ana Lima',
  email: 'ana@brabo.dev',
};

/**
 * Só `pt-BR`: o que se prova aqui é `disabled`, a chegada (ou não) de uma
 * chamada na api e a frase que a PRÓPRIA api mandou — nenhum dos três muda com
 * o idioma.
 */
function montar(secao: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    resources: { 'pt-BR': { settings: settingsPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'settings',
    ns: ['settings'],
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
 * em `project_members` — os dois insumos de que o papel efetivo é composto.
 */
async function cenario({
  noWorkspace,
  noProjeto,
}: {
  noWorkspace?: Role;
  noProjeto?: Role;
}) {
  useCurrentWorkspaceWithRole.mockReturnValue({
    data: noWorkspace ? { workspace: { id: 'ws-1' }, role: noWorkspace } : undefined,
  });
  listProjectMembers.mockResolvedValue(
    noProjeto
      ? [
          { userId: MEU_ID, role: noProjeto, name: 'Eu Mesmo', email: 'eu@brabo.dev' },
          ANA,
        ]
      : [ANA],
  );

  montar(<MembersSection projectId="proj-1" />);
  await screen.findByText('Ana Lima');

  return {
    convidar: screen.getByRole('button', { name: 'Convidar' }),
    campoDeConvite: screen.getByPlaceholderText('ID do usuário (UUID)'),
    remover: screen.getByRole('button', { name: 'Remover Ana Lima' }),
    /** O `Select` da LINHA da Ana — o da barra de convite é o primeiro. */
    papelDaAna: screen.getAllByRole('combobox').at(-1)!,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  userIdDaSessao.mockReturnValue(MEU_ID);
  addProjectMember.mockResolvedValue(undefined);
  removeProjectMember.mockResolvedValue(undefined);
});

describe('membros — quem NÃO alcança `maintainer`', () => {
  it('viewer: os quatro controles ficam inertes e nenhuma chamada sai', async () => {
    const { convidar, campoDeConvite, remover, papelDaAna } = await cenario({
      noWorkspace: 'viewer',
    });

    expect(convidar).toBeDisabled();
    expect(campoDeConvite).toBeDisabled();
    expect(remover).toBeDisabled();
    expect(papelDaAna).toBeDisabled();

    // Inerte de verdade, não só na aparência — é o que separa esta correção de
    // um `opacity` no CSS.
    //
    // Só o BOTÃO é exercitado por evento. `fireEvent.change` num `<select>`
    // desabilitado dispara o `onChange` do React mesmo assim: jsdom implementa
    // a trava de `disabled` para `click`, e não para um `change` despachado à
    // mão — o que um navegador nunca faria, porque ninguém consegue abrir um
    // `select` desabilitado. Afirmar `not.toHaveBeenCalled()` ali estaria
    // testando o dispatcher do jsdom, não este componente; para o `Select`, o
    // `disabled` acima É a garantia.
    fireEvent.click(remover);
    expect(removeProjectMember).not.toHaveBeenCalled();
  });

  it('developer NÃO edita aqui — o caso que impede copiar o gate da seção de modelos', async () => {
    // `developer` é exatamente o mínimo de `ModelsSection`, e a MESMA pessoa vê
    // a tabela de modelo por agente habilitada e esta desabilitada. Se este
    // caso passar a falhar, alguém uniformizou duas seções cujos endpoints
    // pedem papéis diferentes.
    const { convidar, remover, papelDaAna } = await cenario({
      noWorkspace: 'developer',
    });

    expect(convidar).toBeDisabled();
    expect(remover).toBeDisabled();
    expect(papelDaAna).toBeDisabled();
  });

  it('papel ausente (consulta em voo ou que falhou) não alcança nada', async () => {
    useCurrentWorkspaceWithRole.mockReturnValue({ data: undefined });
    listProjectMembers.mockResolvedValue([ANA]);

    montar(<MembersSection projectId="proj-1" />);
    await screen.findByText('Ana Lima');

    expect(screen.getByRole('button', { name: 'Convidar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remover Ana Lima' })).toBeDisabled();
  });

  it('some o CONTROLE, nunca a informação: o papel de cada linha continua legível', async () => {
    const { papelDaAna } = await cenario({ noWorkspace: 'viewer' });

    // O `Select` está apagado, e ainda assim DIZ que a Ana é `developer` —
    // trocá-lo por texto para quem não edita esconderia o estado junto com a
    // ação. O nome e o e-mail da linha também sobrevivem.
    expect(papelDaAna).toHaveValue('developer');
    expect(screen.getByText('ana@brabo.dev')).toBeInTheDocument();
  });

  it('a legenda diz o motivo UMA vez, em texto, e só para quem não pode', async () => {
    await cenario({ noWorkspace: 'viewer' });
    expect(
      screen.getByText(/Exige papel maintainer para convidar/),
    ).toBeInTheDocument();
  });
});

describe('membros — quem alcança `maintainer`', () => {
  it('maintainer: os quatro controles ficam ativos e a legenda não cobra papel', async () => {
    const { convidar, campoDeConvite, remover, papelDaAna } = await cenario({
      noWorkspace: 'maintainer',
    });

    expect(convidar).toBeEnabled();
    expect(campoDeConvite).toBeEnabled();
    expect(remover).toBeEnabled();
    expect(papelDaAna).toBeEnabled();
    expect(screen.queryByText(/Exige papel maintainer/)).toBeNull();
  });

  it('trocar o papel de alguém chega na api com a linha que se clicou', async () => {
    const { papelDaAna } = await cenario({ noWorkspace: 'maintainer' });

    fireEvent.change(papelDaAna, { target: { value: 'viewer' } });

    await waitFor(() =>
      expect(addProjectMember).toHaveBeenCalledWith('proj-1', {
        userId: 'user-ana',
        role: 'viewer',
      }),
    );
  });

  it('remover chega na api com o userId da linha', async () => {
    const { remover } = await cenario({ noWorkspace: 'maintainer' });

    fireEvent.click(remover);

    await waitFor(() =>
      expect(removeProjectMember).toHaveBeenCalledWith('proj-1', 'user-ana'),
    );
  });
});

/**
 * O coração da correção, e o que a distingue de `papel-na-tabela-de-agentes`:
 * o papel é composto como a api o compõe — `projectRole ?? workspaceRole`.
 *
 * Os dois casos são um PAR e precisam ficar juntos: um sozinho passaria também
 * sob "o maior dos dois", que é o que a descrição do `POST` promete e o código
 * não faz.
 */
describe('membros — o papel EFETIVO sobrepõe o do workspace, nos DOIS sentidos', () => {
  it('para CIMA: `viewer` no workspace com linha `maintainer` no projeto EDITA', async () => {
    const { convidar, remover } = await cenario({
      noWorkspace: 'viewer',
      noProjeto: 'maintainer',
    });

    expect(convidar).toBeEnabled();
    expect(remover).toBeEnabled();
  });

  it('para BAIXO: `owner` no workspace com linha `viewer` no projeto NÃO edita', async () => {
    // O caso que a descrição de `POST :projectId/members` diz ser impossível
    // ("associating someone as `viewer` here doesn't downgrade a workspace
    // `owner`"). `ResolveEffectiveRoleUseCase.forProject` devolve a linha do
    // projeto quando ela existe, sem comparar com o workspace — então o
    // rebaixamento é real, e a tela que oferecesse os controles aqui prometeria
    // o que o `RolesGuard` recusa.
    const { convidar, remover } = await cenario({
      noWorkspace: 'owner',
      noProjeto: 'viewer',
    });

    expect(convidar).toBeDisabled();
    expect(remover).toBeDisabled();
  });

  it('sem linha no projeto, o papel de workspace vale — é o `??`, não um bloqueio', async () => {
    const { convidar } = await cenario({ noWorkspace: 'owner' });
    expect(convidar).toBeEnabled();
  });
});

/**
 * Os desfechos das duas ações que falhavam CALADAS — `handleRoleChange` e
 * `handleRemove` não tinham `try/catch` e eram chamadas de um `onChange`/
 * `onClick`, então toda recusa da api virava `unhandled promise rejection`:
 * silêncio na tela, ruído no console. Mesma classe que a #440/#441 fechou na
 * tabela de modelos.
 */
describe('membros — a recusa da api tem desfecho na tela', () => {
  it('trocar papel recusado: a frase da api chega ao toast', async () => {
    const { papelDaAna } = await cenario({ noWorkspace: 'maintainer' });
    addProjectMember.mockRejectedValue(
      new ApiError(403, { message: 'Papel insuficiente para esta ação' }),
    );

    fireEvent.change(papelDaAna, { target: { value: 'viewer' } });

    expect(
      await screen.findByText('Papel insuficiente para esta ação'),
    ).toBeInTheDocument();
  });

  it('trocar papel recusado: a tela NÃO passa a exibir o papel que a api negou', async () => {
    const { papelDaAna } = await cenario({ noWorkspace: 'maintainer' });
    addProjectMember.mockRejectedValue(new ApiError(403, { message: 'Recusado' }));

    fireEvent.change(papelDaAna, { target: { value: 'viewer' } });
    await screen.findByText('Recusado');

    // A lista só é relida no SUCESSO, e o `Select` não guarda a escolha em
    // estado local — a coluna continua mostrando o que a api de fato tem.
    expect(screen.getAllByRole('combobox').at(-1)!).toHaveValue('developer');
  });

  it('remover recusado: a frase da api chega ao toast', async () => {
    const { remover } = await cenario({ noWorkspace: 'maintainer' });
    removeProjectMember.mockRejectedValue(
      new ApiError(403, { message: 'Papel insuficiente para esta ação' }),
    );

    fireEvent.click(remover);

    expect(
      await screen.findByText('Papel insuficiente para esta ação'),
    ).toBeInTheDocument();
  });

  it('convidar mantém a DICA fixa, e não a frase da api — decisão, não descuido', async () => {
    // O `userId` daqui é DIGITADO, e o erro que se alcança de verdade é apontar
    // para um usuário que não existe: um UUID bem formado passa pelo
    // `@IsUUID()`, estoura a FK `project_members.user_id → users.id`, e nenhum
    // filtro global trata isso — o Nest responde o 500 padrão. `mensagemDaApi`
    // devolveria "Internal server error", que é PIOR do que a dica. Nas duas
    // ações acima o `userId` veio da lista e existe, então lá a frase da api é
    // a informação mais útil que há. Formas diferentes, por conteúdo.
    const { campoDeConvite, convidar } = await cenario({ noWorkspace: 'maintainer' });
    addProjectMember.mockRejectedValue(
      new ApiError(500, { message: 'Internal server error' }),
    );

    fireEvent.change(campoDeConvite, {
      target: { value: '3f1b2c8e-5a4d-4b7e-9c10-2d6f8a1b4c33' },
    });
    fireEvent.click(convidar);

    expect(
      await screen.findByText('Verifique se o ID do usuário existe'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Internal server error')).toBeNull();
  });
});

/**
 * A tabela lista ASSOCIAÇÕES, e o `Select` decide o papel do projeto — as duas
 * coisas que a legenda passou a dizer, porque nenhuma das duas é dedutível do
 * que está na tela e a segunda é perigosa se lida ao contrário.
 */
describe('membros — a legenda diz o que a coluna significa e o que a lista omite', () => {
  it('declara a sobreposição nos dois sentidos e quem não aparece na lista', async () => {
    await cenario({ noWorkspace: 'maintainer' });

    expect(
      screen.getByText(/substitui o do workspace neste projeto, nos dois sentidos/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/só pelo workspace não aparece na lista/),
    ).toBeInTheDocument();
  });
});

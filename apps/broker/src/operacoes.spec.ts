import { describe, expect, it } from 'vitest';
import {
  DockerPort,
  type ContainerIniciado,
  type EspecificacaoDeContainer,
  type EstadoObservadoDoContainer,
  type PedidoDeExec,
  type ResultadoDeExec,
} from '@brabo/docker-port';
import { lerConfiguracao } from './config.ts';
import type { ContextoDoProjeto } from './api-client.ts';
import {
  BaseDeProjetosNaoConfiguradaError,
  LocalizacaoIndisponivelError,
  ModoDeExecucaoNaoSuportadoError,
  RaizDeWorkspacesNaoConfiguradaError,
  start,
  type DependenciasDoBroker,
} from './operacoes.ts';

/**
 * A resolução das DUAS raízes (RN-501) — o teste da composição, sem HTTP no
 * meio. `servidor.spec.ts` prova a tabela de status; este prova a aritmética
 * do `-v`, que é onde a contenção mora.
 *
 * O que ele existe para não deixar acontecer: uma raiz escolhida por omissão.
 * Um `mounted` resolvido contra `PROJECT_WORKSPACES_HOST_ROOT` montaria a
 * pasta de outro projeto (a raiz gerenciada é nomeada por `workspace_dir_name`
 * e a base é nomeada pelo usuário — nada no schema impede a colisão), e um
 * `container` resolvido contra a base montaria uma pasta vazia. Os dois erros
 * são silenciosos: o container sobe, e o que está dentro dele é outra coisa.
 */

const RAIZ_GERENCIADA = '/srv/brabo/project-workspaces';
const BASE_MONTADA = '/home/voce/brabo';

class DockerDeTeste extends DockerPort {
  ultimaSpec: EspecificacaoDeContainer | null = null;
  chamadas = 0;

  async start(spec: EspecificacaoDeContainer): Promise<ContainerIniciado> {
    this.chamadas += 1;
    this.ultimaSpec = spec;
    return { containerId: 'c0ffee', nome: 'brabo-x', jaEstavaDePe: false };
  }
  async stop(): Promise<void> {}
  async remove(): Promise<void> {}
  async inspect(): Promise<EstadoObservadoDoContainer | null> {
    return null;
  }
  async exec(_nome: string, _pedido: PedidoDeExec): Promise<ResultadoDeExec> {
    return { exitCode: 0, output: '', timedOut: false };
  }
}

function contexto(overrides: Partial<ContextoDoProjeto> = {}): ContextoDoProjeto {
  return {
    projectId: 'p1',
    projectSlug: 'loja',
    workspaceId: 'ws1',
    workspaceDirName: 'loja-f52be111',
    executionMode: 'container',
    localizacao: { tipo: 'gerenciada', segmento: 'loja-f52be111' },
    imagem: {
      image: 'node:22-bookworm-slim',
      network: 'egress',
      resources: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
    },
    imagemVersao: 3,
    ...overrides,
  };
}

function montar(
  ctx: Partial<ContextoDoProjeto> = {},
  env: NodeJS.ProcessEnv = {},
): { deps: DependenciasDoBroker; docker: DockerDeTeste } {
  const docker = new DockerDeTeste();
  return {
    docker,
    deps: {
      docker,
      buscarContexto: async () => contexto(ctx),
      config: lerConfiguracao({
        PROJECT_WORKSPACES_HOST_ROOT: RAIZ_GERENCIADA,
        BRABO_PROJECTS_HOST_BASE: BASE_MONTADA,
        ...env,
      }),
    },
  };
}

describe('as duas raízes do broker (RN-501)', () => {
  it('`gerenciada` resolve contra PROJECT_WORKSPACES_HOST_ROOT', async () => {
    const { deps, docker } = montar();

    await start(deps, 'p1');

    expect(docker.ultimaSpec?.raizDoProjeto).toBe(
      `${RAIZ_GERENCIADA}/loja-f52be111`,
    );
  });

  it('`montada` resolve contra BRABO_PROJECTS_HOST_BASE, e não contra a gerenciada', async () => {
    const { deps, docker } = montar({
      executionMode: 'mounted',
      localizacao: { tipo: 'montada', segmento: 'loja' },
    });

    await start(deps, 'p1');

    expect(docker.ultimaSpec?.raizDoProjeto).toBe(`${BASE_MONTADA}/loja`);
  });

  it('o segmento montado pode ter mais de um nível', async () => {
    const { deps, docker } = montar({
      executionMode: 'mounted',
      localizacao: { tipo: 'montada', segmento: 'times/loja' },
    });

    await start(deps, 'p1');

    expect(docker.ultimaSpec?.raizDoProjeto).toBe(`${BASE_MONTADA}/times/loja`);
  });

  it('barra final na raiz configurada não vira barra dupla no `-v`', async () => {
    const { deps, docker } = montar(
      {
        executionMode: 'mounted',
        localizacao: { tipo: 'montada', segmento: 'loja' },
      },
      { BRABO_PROJECTS_HOST_BASE: `${BASE_MONTADA}/` },
    );

    await start(deps, 'p1');

    expect(docker.ultimaSpec?.raizDoProjeto).toBe(`${BASE_MONTADA}/loja`);
  });

  it('sem BRABO_PROJECTS_HOST_BASE, `mounted` recusa NOMEANDO a variável e nada é tocado', async () => {
    const { deps, docker } = montar(
      {
        executionMode: 'mounted',
        localizacao: { tipo: 'montada', segmento: 'loja' },
      },
      { BRABO_PROJECTS_HOST_BASE: '' },
    );

    await expect(start(deps, 'p1')).rejects.toBeInstanceOf(
      BaseDeProjetosNaoConfiguradaError,
    );
    await expect(start(deps, 'p1')).rejects.toThrowError(
      /BRABO_PROJECTS_HOST_BASE/,
    );
    expect(docker.chamadas).toBe(0);
  });

  it('a falta de uma raiz nunca é suprida pela OUTRA', async () => {
    // O erro que este teste existe para impedir: cair na raiz gerenciada
    // porque a base falta montaria a pasta de OUTRO projeto, em silêncio.
    const { deps, docker } = montar(
      {
        executionMode: 'mounted',
        localizacao: { tipo: 'montada', segmento: 'loja-f52be111' },
      },
      { BRABO_PROJECTS_HOST_BASE: '' },
    );

    await expect(start(deps, 'p1')).rejects.toBeInstanceOf(
      BaseDeProjetosNaoConfiguradaError,
    );
    expect(docker.chamadas).toBe(0);
  });

  it('sem PROJECT_WORKSPACES_HOST_ROOT, `container` recusa nomeando a OUTRA variável', async () => {
    const { deps } = montar({}, { PROJECT_WORKSPACES_HOST_ROOT: '' });

    await expect(start(deps, 'p1')).rejects.toBeInstanceOf(
      RaizDeWorkspacesNaoConfiguradaError,
    );
  });

  it('`localizacao: indisponivel` recusa REPETINDO o motivo da api', async () => {
    const { deps, docker } = montar({
      executionMode: 'mounted',
      localizacao: {
        tipo: 'indisponivel',
        motivo: 'a pasta do projeto está fora da base /home/voce/brabo',
      },
    });

    await expect(start(deps, 'p1')).rejects.toBeInstanceOf(
      LocalizacaoIndisponivelError,
    );
    await expect(start(deps, 'p1')).rejects.toThrowError(/fora da base/);
    expect(docker.chamadas).toBe(0);
  });

  it('`tipo` desconhecido é recusa nomeando o valor, nunca uma raiz default', async () => {
    const { deps, docker } = montar({
      localizacao: { tipo: 'nfs', segmento: 'loja' },
    });

    await expect(start(deps, 'p1')).rejects.toThrowError(/"nfs"/);
    expect(docker.chamadas).toBe(0);
  });

  it('`localizacao` ausente é recusa, não um mount adivinhado', async () => {
    const { deps, docker } = montar({ localizacao: undefined });

    await expect(start(deps, 'p1')).rejects.toBeInstanceOf(
      LocalizacaoIndisponivelError,
    );
    expect(docker.chamadas).toBe(0);
  });

  it.each([
    ['travessia', '../../etc'],
    ['absoluto', '/etc'],
    ['vazio', ''],
  ])(
    'segmento %s recusado antes de virar `-v` — a api errar não vira mount errado',
    async (_rotulo, segmento) => {
      const { deps, docker } = montar({
        executionMode: 'mounted',
        localizacao: { tipo: 'montada', segmento },
      });

      await expect(start(deps, 'p1')).rejects.toThrowError();
      expect(docker.chamadas).toBe(0);
    },
  );

  it('`runner` continua recusado — o broker nunca alcança a máquina do usuário', async () => {
    const { deps, docker } = montar({
      executionMode: 'runner',
      localizacao: { tipo: 'indisponivel', motivo: 'modo runner' },
    });

    await expect(start(deps, 'p1')).rejects.toBeInstanceOf(
      ModoDeExecucaoNaoSuportadoError,
    );
    expect(docker.chamadas).toBe(0);
  });

  it('modo que este broker não conhece nasce RECUSADO, não aceito por omissão', async () => {
    const { deps, docker } = montar({
      executionMode: 'kubernetes',
      localizacao: { tipo: 'gerenciada', segmento: 'loja-f52be111' },
    });

    await expect(start(deps, 'p1')).rejects.toBeInstanceOf(
      ModoDeExecucaoNaoSuportadoError,
    );
    expect(docker.chamadas).toBe(0);
  });
});

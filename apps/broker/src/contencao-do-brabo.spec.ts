import { describe, expect, it } from 'vitest';
import {
  DockerViaCli,
  PONTO_DE_MONTAGEM,
  type ResultadoDoCli,
  type RodarDocker,
} from '@brabo/docker-port';
import { lerConfiguracao } from './config.ts';
import type { ContextoDoProjeto } from './api-client.ts';
import { start, type DependenciasDoBroker } from './operacoes.ts';

/**
 * A condição do dono para manter a RN-603 no piloto automático (ADR 0189,
 * decisão de 01/10): o modo automático libera qualquer comando, inclusive fora
 * da pasta, "desde que seja conservado para que nenhum problema ocorra com o
 * código que o Brabo estiver rodando". A garantia NÃO é política — é a
 * contenção do container, e este arquivo a prova de ponta a ponta, do
 * `projectId` que o broker recebe ao `docker run` que o adaptador escreveria:
 *
 * 1. o container do projeto monta UMA pasta, e só uma, sempre em `/work`;
 * 2. essa pasta é `<raiz do broker>/<segmento>`, ESTRITAMENTE abaixo da raiz
 *    — nunca a raiz, nunca acima dela, nunca um caminho absoluto vindo de fora;
 * 3. nada mais do host entra: nem o socket do Docker, nem `--privileged`, nem
 *    a rede do host (`localhost` e os serviços do próprio Brabo).
 *
 * Somado às guardas que impedem a RAIZ de conter o checkout (a base:
 * `baseSobrepoeOCheckout` no `preflight.mjs`/`pnpm bootstrap`, testada em
 * `scripts/dev/base-de-projetos.spec.ts`, e a recusa de `consentir_base` no
 * `install.sh`, que NÃO tem teste próprio), o container não alcança o checkout nem os
 * arquivos do Brabo. E sem container `running` o comando não roda em lugar
 * nenhum (RN-502/RN-507, `terminal_executor.ex`). O que esta prova NÃO cobre
 * está escrito no ADR 0189.
 */

const CHECKOUT_DO_BRABO = '/home/voce/brabo';
const RAIZ_GERENCIADA = '/srv/brabo/project-workspaces';
const BASE_MONTADA = '/home/voce/projetos-brabo';

const OK: ResultadoDoCli = { exitCode: 0, stdout: '', stderr: '', timedOut: false };

function daemonDeTeste(): { rodar: RodarDocker; chamadas: string[][] } {
  const chamadas: string[][] = [];
  const rodar: RodarDocker = async (args) => {
    chamadas.push([...args]);
    if (args[0] === 'run') return { ...OK, stdout: 'c0ffee\n' };
    return OK;
  };
  return { rodar, chamadas };
}

function contexto(overrides: Partial<ContextoDoProjeto>): ContextoDoProjeto {
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

async function subir(ctx: Partial<ContextoDoProjeto>): Promise<string[] | null> {
  const { rodar, chamadas } = daemonDeTeste();
  const deps: DependenciasDoBroker = {
    docker: new DockerViaCli(rodar),
    buscarContexto: async () => contexto(ctx),
    config: lerConfiguracao({
      PROJECT_WORKSPACES_HOST_ROOT: RAIZ_GERENCIADA,
      BRABO_PROJECTS_HOST_BASE: BASE_MONTADA,
    }),
  };
  await start(deps, 'p1');
  return chamadas.find((c) => c[0] === 'run') ?? null;
}

function binds(run: string[]): string[] {
  return run.flatMap((arg, i) =>
    ['--volume', '-v', '--mount'].includes(arg) ? [run[i + 1] ?? ''] : [],
  );
}

function estritamenteAbaixo(caminho: string, raiz: string): boolean {
  return caminho.startsWith(`${raiz}/`) && caminho.length > raiz.length + 1;
}

const CASOS: Array<{ nome: string; ctx: Partial<ContextoDoProjeto>; raiz: string }> = [
  { nome: 'container (raiz gerenciada)', ctx: {}, raiz: RAIZ_GERENCIADA },
  {
    nome: 'mounted (base dos projetos montados)',
    ctx: {
      executionMode: 'mounted',
      localizacao: { tipo: 'montada', segmento: 'clientes/loja' },
    },
    raiz: BASE_MONTADA,
  },
];

describe('a contenção que sustenta o piloto automático (ADR 0189)', () => {
  for (const caso of CASOS) {
    it(`${caso.nome}: UM bind, em /work, estritamente abaixo da raiz — e o checkout fica fora`, async () => {
      const run = await subir(caso.ctx);
      expect(run).not.toBeNull();
      const montados = binds(run!);
      expect(montados).toHaveLength(1);

      const [origem, destino, modo] = montados[0]!.split(':');
      expect(destino).toBe(PONTO_DE_MONTAGEM);
      expect(modo).toBe('rw');
      expect(estritamenteAbaixo(origem!, caso.raiz)).toBe(true);
      expect(origem === CHECKOUT_DO_BRABO).toBe(false);
      expect(origem!.startsWith(`${CHECKOUT_DO_BRABO}/`)).toBe(false);
    });

    it(`${caso.nome}: nada mais do host entra — socket do Docker, privilégio, rede do host`, async () => {
      const run = (await subir(caso.ctx))!;
      expect(run.some((a) => a.includes('docker.sock'))).toBe(false);
      expect(run).not.toContain('--privileged');
      expect(run).not.toContain('--cap-add');
      expect(run).not.toContain('--pid');
      expect(run[run.indexOf('--network') + 1]).not.toBe('host');
      expect(run[run.indexOf('--cap-drop') + 1]).toBe('ALL');
    });
  }

  it.each([
    ['vazio (a raiz inteira)', ''],
    ['absoluto (o checkout do Brabo)', CHECKOUT_DO_BRABO],
    ['travessia para fora da base', '../brabo'],
    ['travessia no meio', 'clientes/../../brabo'],
    ['barra dupla', 'clientes//loja'],
  ])('segmento %s é RECUSADO antes de qualquer chamada ao Docker', async (_n, segmento) => {
    const { rodar, chamadas } = daemonDeTeste();
    const deps: DependenciasDoBroker = {
      docker: new DockerViaCli(rodar),
      buscarContexto: async () =>
        contexto({ executionMode: 'mounted', localizacao: { tipo: 'montada', segmento } }),
      config: lerConfiguracao({
        PROJECT_WORKSPACES_HOST_ROOT: RAIZ_GERENCIADA,
        BRABO_PROJECTS_HOST_BASE: BASE_MONTADA,
      }),
    };
    await expect(start(deps, 'p1')).rejects.toThrow();
    expect(chamadas.find((c) => c[0] === 'run')).toBeUndefined();
  });

  it('`runner` nunca sobe pelo broker: a pasta dele mora numa máquina que este host não enxerga', async () => {
    await expect(
      subir({
        executionMode: 'runner',
        localizacao: { tipo: 'indisponivel', motivo: 'runner' },
      }),
    ).rejects.toThrow();
  });
});

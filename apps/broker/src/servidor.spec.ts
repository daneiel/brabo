import { describe, expect, it } from 'vitest';
import {
  DockerIndisponivelError,
  DockerPort,
  PONTO_DE_MONTAGEM,
  type ContainerIniciado,
  type EspecificacaoDeContainer,
  type EstadoObservadoDoContainer,
  type PedidoDeExec,
  type ResultadoDeExec,
} from '@brabo/docker-port';
import { tratar, rotaDeContainer } from './servidor.ts';
import { lerConfiguracao } from './config.ts';
import type { ContextoDoProjeto } from './api-client.ts';
import type { DependenciasDoBroker } from './operacoes.ts';

/**
 * Tudo aqui passa por `tratar()` — a função, não o socket. Nenhum container
 * sobe, nenhum daemon é consultado, nenhuma api é chamada: os três são duplos.
 *
 * O que estes testes provam, e é o ponto do serviço inteiro: o corpo da
 * requisição NÃO chega ao `docker run`. A especificação que o duplo do Docker
 * recebe é composta do que a api disse sobre o PROJETO, e um chamador que tente
 * mandar imagem, rede ou mount não muda nada.
 */

const TOKEN = 'dev-service-token-change-me';

const CONTEXTO: ContextoDoProjeto = {
  projectId: 'f52be111-0000-4000-8000-000000000000',
  projectSlug: 'exp002',
  workspaceId: 'aaaaaaaa-0000-4000-8000-000000000000',
  workspaceDirName: 'exp002-f52be111',
  executionMode: 'container',
  localizacao: { tipo: 'gerenciada', segmento: 'exp002-f52be111' },
  imagem: {
    image: 'node:22-bookworm-slim',
    network: 'egress',
    resources: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
  },
  imagemVersao: 3,
};

class DockerDeTeste extends DockerPort {
  readonly chamadas: Array<{ operacao: string; argumento: unknown }> = [];
  observado: EstadoObservadoDoContainer | null = null;
  erroAoIniciar: Error | null = null;

  async start(spec: EspecificacaoDeContainer): Promise<ContainerIniciado> {
    this.chamadas.push({ operacao: 'start', argumento: spec });
    if (this.erroAoIniciar !== null) throw this.erroAoIniciar;
    return { containerId: 'c0ffee', nome: `brabo-${spec.workspaceDirName}`, jaEstavaDePe: false };
  }
  async stop(nome: string): Promise<void> {
    this.chamadas.push({ operacao: 'stop', argumento: nome });
  }
  async remove(nome: string): Promise<void> {
    this.chamadas.push({ operacao: 'remove', argumento: nome });
  }
  async inspect(nome: string): Promise<EstadoObservadoDoContainer | null> {
    this.chamadas.push({ operacao: 'inspect', argumento: nome });
    return this.observado;
  }
  async exec(nome: string, pedido: PedidoDeExec): Promise<ResultadoDeExec> {
    this.chamadas.push({ operacao: 'exec', argumento: { nome, pedido } });
    return { exitCode: 0, output: 'ok', timedOut: false };
  }
}

function montar(
  overrides: {
    contexto?: Partial<ContextoDoProjeto>;
    env?: NodeJS.ProcessEnv;
    buscarContexto?: DependenciasDoBroker['buscarContexto'];
  } = {},
): { deps: DependenciasDoBroker; docker: DockerDeTeste } {
  const docker = new DockerDeTeste();
  const contexto = { ...CONTEXTO, ...overrides.contexto };
  return {
    docker,
    deps: {
      docker,
      buscarContexto:
        overrides.buscarContexto ?? (async () => contexto),
      config: lerConfiguracao({
        PROJECT_WORKSPACES_HOST_ROOT: '/srv/brabo/project-workspaces',
        ...overrides.env,
      }),
    },
  };
}

function pedido(
  metodo: string,
  caminho: string,
  corpo?: unknown,
  token: string | null = TOKEN,
) {
  return { metodo, caminho, corpo, token };
}

describe('autenticação', () => {
  it('recusa sem token, e a recusa não vaza nada sobre o projeto', async () => {
    const { deps, docker } = montar();

    const r = await tratar(deps, pedido('POST', '/containers/abc/start', {}, null));

    expect(r.status).toBe(401);
    expect(docker.chamadas).toHaveLength(0);
  });

  it('recusa token errado', async () => {
    const { deps } = montar();

    const r = await tratar(deps, pedido('GET', '/containers/abc', undefined, 'outro'));

    expect(r.status).toBe(401);
  });

  it('aceita o token ANTERIOR durante a rotação', async () => {
    const { deps } = montar({
      env: {
        BRABO_SERVICE_TOKEN: 'token-novo-com-16+',
        BRABO_SERVICE_TOKEN_PREVIOUS: 'token-velho-com-16+',
      },
    });

    const novo = await tratar(deps, pedido('GET', '/containers/x', undefined, 'token-novo-com-16+'));
    const velho = await tratar(deps, pedido('GET', '/containers/x', undefined, 'token-velho-com-16+'));

    expect(novo.status).toBe(200);
    expect(velho.status).toBe(200);
  });

  it('`/health` é a única rota sem token, e ela fala do PROCESSO', async () => {
    const { deps } = montar();

    const r = await tratar(deps, pedido('GET', '/health', undefined, null));

    expect(r.status).toBe(200);
    // Nada aqui consulta o daemon: reiniciar o broker não conserta um Docker
    // fora do ar, então o healthcheck não pode reprovar por causa dele.
    expect(r.corpo).toEqual({ status: 'ok', servico: 'broker' });
  });
});

describe('a especificação é COMPUTADA, nunca recebida', () => {
  it('compõe imagem, rede, recursos e o único mount do que a api disse', async () => {
    const { deps, docker } = montar();

    const r = await tratar(deps, pedido('POST', '/containers/f52be111/start', {}));

    expect(r.status).toBe(200);
    const spec = docker.chamadas[0]?.argumento as EspecificacaoDeContainer;
    expect(spec.imagem).toBe('node:22-bookworm-slim');
    expect(spec.rede).toBe('egress');
    expect(spec.cpus).toBe(2);
    expect(spec.memoriaMb).toBe(4096);
    expect(spec.pidsLimit).toBe(512);
    // A raiz sai da CONFIGURAÇÃO deste processo mais o nome congelado na
    // criação do projeto (RN-109) — nunca de um caminho recebido.
    expect(spec.raizDoProjeto).toBe('/srv/brabo/project-workspaces/exp002-f52be111');
  });

  it('IGNORA imagem, rede, recursos e mount mandados no corpo', async () => {
    const { deps, docker } = montar();

    // Isto é a asserção central do serviço. Não há campo em que se escreva
    // nada disso — o corpo inteiro é descartado para `start`.
    await tratar(
      deps,
      pedido('POST', '/containers/f52be111/start', {
        imagem: 'attacker/evil:1',
        rede: 'host',
        privileged: true,
        cpus: 999,
        raizDoProjeto: '/',
        volumes: ['/var/run/docker.sock:/var/run/docker.sock'],
      }),
    );

    const spec = docker.chamadas[0]?.argumento as EspecificacaoDeContainer;
    expect(spec.imagem).toBe('node:22-bookworm-slim');
    expect(spec.rede).toBe('egress');
    expect(spec.cpus).toBe(2);
    expect(spec.raizDoProjeto).toBe('/srv/brabo/project-workspaces/exp002-f52be111');
    expect(Object.keys(spec)).not.toContain('privileged');
    expect(Object.keys(spec)).not.toContain('volumes');
  });

  it('recusa artefato cuja imagem não vira argumento seguro, com 422', async () => {
    const { deps, docker } = montar({
      contexto: {
        imagem: {
          image: '--privileged',
          network: 'none',
          resources: { cpus: 1, memoryMb: 512, pidsLimit: 64 },
        },
      },
    });

    const r = await tratar(deps, pedido('POST', '/containers/f52be111/start', {}));

    // Revalidar o que a api devolveu é o ponto: a contenção não pode depender
    // de o chamador estar correto.
    expect(r.status).toBe(422);
    expect(docker.chamadas).toHaveLength(0);
  });
});

describe('as cinco operações, e nada além', () => {
  it('stop/remove/inspect trabalham pelo NOME derivado, sem pedir imagem', async () => {
    const { deps, docker } = montar({ contexto: { imagem: null, imagemVersao: 0 } });

    expect((await tratar(deps, pedido('POST', '/containers/p/stop'))).status).toBe(200);
    expect((await tratar(deps, pedido('POST', '/containers/p/remove'))).status).toBe(200);
    const leitura = await tratar(deps, pedido('GET', '/containers/p'));

    expect(leitura.status).toBe(200);
    expect(leitura.corpo).toEqual({ observado: null });
    // Exigir decisão do Arquiteto para PARAR deixaria um container órfão
    // inalcançável justamente quando a decisão fosse revogada.
    expect(docker.chamadas.map((c) => c.argumento)).toEqual([
      'exp002-f52be111',
      'exp002-f52be111',
      'exp002-f52be111',
    ]);
  });

  it('`start` sem decisão do Arquiteto é 409, e nada é tocado', async () => {
    const { deps, docker } = montar({ contexto: { imagem: null, imagemVersao: 0 } });

    const r = await tratar(deps, pedido('POST', '/containers/p/start', {}));

    expect(r.status).toBe(409);
    expect(String((r.corpo as { erro: string }).erro)).toContain('RN-105');
    expect(docker.chamadas).toHaveLength(0);
  });

  it('uma sexta operação não existe — 404 que diz quais são as cinco', async () => {
    const { deps, docker } = montar();

    const r = await tratar(deps, pedido('POST', '/containers/p/run', { imagem: 'x:1' }));

    expect(r.status).toBe(404);
    expect(String((r.corpo as { erro: string }).erro)).toContain('São cinco');
    expect(docker.chamadas).toHaveLength(0);
  });

  it('o roteador é uma lista fechada de caminhos', () => {
    expect(rotaDeContainer('/containers/p')).toEqual({ projectId: 'p', operacao: '' });
    expect(rotaDeContainer('/containers/p/start')).toEqual({ projectId: 'p', operacao: 'start' });
    expect(rotaDeContainer('/containers')).toBeNull();
    expect(rotaDeContainer('/containers/p/start/extra')).toBeNull();
    expect(rotaDeContainer('/outra-coisa')).toBeNull();
  });
});

describe('exec', () => {
  it('executa o comando com o cwd dentro do ponto de montagem', async () => {
    const { deps, docker } = montar();

    const r = await tratar(
      deps,
      pedido('POST', '/containers/p/exec', {
        comando: 'npm test',
        cwd: `${PONTO_DE_MONTAGEM}/pacote`,
      }),
    );

    expect(r.status).toBe(200);
    expect(docker.chamadas[0]?.argumento).toEqual({
      nome: 'exp002-f52be111',
      pedido: {
        comando: 'npm test',
        cwd: '/work/pacote',
        timeoutMs: undefined,
        maxBytes: undefined,
      },
    });
  });

  it('recusa cwd fora de /work — inclusive o vizinho de nome parecido', async () => {
    const { deps, docker } = montar();

    for (const cwd of ['/etc', '/workspace', '/work/../etc', '/']) {
      const r = await tratar(
        deps,
        pedido('POST', '/containers/p/exec', { comando: 'ls', cwd }),
      );
      expect(r.status, `esperava recusa para ${cwd}`).toBe(422);
    }
    expect(docker.chamadas).toHaveLength(0);
  });

  it('recusa corpo sem comando', async () => {
    const { deps } = montar();

    const r = await tratar(deps, pedido('POST', '/containers/p/exec', {}));

    expect(r.status).toBe(422);
  });
});

describe('classificação de falha', () => {
  it('daemon fora do ar é 503 com origem infra', async () => {
    const { deps, docker } = montar();
    docker.erroAoIniciar = new DockerIndisponivelError('/var/run/docker.sock', 'não atendeu');

    const r = await tratar(deps, pedido('POST', '/containers/p/start', {}));

    expect(r.status).toBe(503);
    expect((r.corpo as { origem: string }).origem).toBe('infra');
  });

  it('projeto `runner` é 409 — quem sobe container lá é o runner, na máquina do usuário', async () => {
    const { deps, docker } = montar({
      contexto: {
        executionMode: 'runner',
        localizacao: { tipo: 'indisponivel', motivo: 'modo runner' },
      },
    });

    const r = await tratar(deps, pedido('POST', '/containers/p/start', {}));

    expect(r.status).toBe(409);
    expect((r.corpo as { origem: string }).origem).toBe('politica');
    expect(docker.chamadas).toHaveLength(0);
  });

  it('projeto `mounted` NÃO é mais recusado — a pasta dele passou a ser alcançável (RN-503)', async () => {
    const { deps, docker } = montar({
      contexto: {
        executionMode: 'mounted',
        localizacao: { tipo: 'montada', segmento: 'loja' },
      },
      env: { BRABO_PROJECTS_HOST_BASE: '/home/voce/brabo' },
    });

    const r = await tratar(deps, pedido('POST', '/containers/p/start', {}));

    expect(r.status).toBe(200);
    expect(docker.chamadas).toHaveLength(1);
  });

  it('sem PROJECT_WORKSPACES_HOST_ROOT, `start` recusa dizendo o que falta', async () => {
    const { deps, docker } = montar({ env: { PROJECT_WORKSPACES_HOST_ROOT: '' } });

    const r = await tratar(deps, pedido('POST', '/containers/p/start', {}));

    expect(r.status).toBe(503);
    // Adivinhar montaria uma pasta VAZIA no host e ninguém saberia por quê.
    expect(String((r.corpo as { erro: string }).erro)).toContain(
      'PROJECT_WORKSPACES_HOST_ROOT',
    );
    expect(docker.chamadas).toHaveLength(0);
  });

  it('api fora do ar é 502 com origem infra, e nada é tocado', async () => {
    const { deps, docker } = montar({
      buscarContexto: async () => {
        const { ApiIndisponivelError } = await import('./api-client.ts');
        throw new ApiIndisponivelError('http://api:3000/x', 'ECONNREFUSED');
      },
    });

    const r = await tratar(deps, pedido('POST', '/containers/p/start', {}));

    expect(r.status).toBe(502);
    expect((r.corpo as { origem: string }).origem).toBe('infra');
    expect(docker.chamadas).toHaveLength(0);
  });

  it('projectId que não é segmento de URL é 422', async () => {
    const { deps } = montar({
      buscarContexto: async (id) => {
        const { garantirIdDeProjeto } = await import('./api-client.ts');
        garantirIdDeProjeto(id);
        return CONTEXTO;
      },
    });

    const r = await tratar(deps, pedido('GET', '/containers/..%2Fetc'));

    expect(r.status).toBe(422);
  });
});

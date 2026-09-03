import { describe, expect, it, vi } from 'vitest';
import type { DockerPort, EspecificacaoDeContainer, PedidoDeExec } from '@brabo/docker-port';
import {
  tratarContainerRemove,
  tratarContainerStart,
  tratarContainerStop,
  tratarExec,
  type EstadoDoRunner,
} from './index.ts';
import type { ChannelLike, PushLike } from './channel.ts';
import { GerenciadorDePty } from './pty.ts';

/**
 * Testa os handlers exportados de `index.ts` (ADR 0137) diretamente, sem
 * canal Phoenix real nem `docker` real — mesmo raciocínio de `channel.spec.ts`
 * (mock mínimo da API que o módulo usa). `index.spec.ts` continua sendo só
 * o teste de PROCESSO da RN-475 (ver o docblock dele); este arquivo cobre a
 * lógica de roteamento host-vs-container que só existe DEPOIS do processo já
 * ter conectado.
 */

function pushFalso(): PushLike {
  const push: PushLike = { receive: () => push };
  return push;
}

class CanalFalso implements ChannelLike {
  pushes: { event: string; payload: unknown }[] = [];
  join(): PushLike {
    return pushFalso();
  }
  on(): void {}
  push(event: string, payload: unknown): PushLike {
    this.pushes.push({ event, payload });
    return pushFalso();
  }
  leave(): void {}
}

function dockerFalso(overrides: Partial<DockerPort> = {}): DockerPort {
  return {
    ping: vi.fn(async () => true as const),
    start: vi.fn(async (_spec: EspecificacaoDeContainer) => ({
      containerId: 'container-1',
      nome: 'brabo-proj-abc12345',
      jaEstavaDePe: false,
    })),
    stop: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    inspect: vi.fn(async () => null),
    exec: vi.fn(async (_nome: string, _pedido: PedidoDeExec) => ({
      exitCode: 0,
      output: 'via container',
      timedOut: false,
    })),
    ...overrides,
  } as DockerPort;
}

function estadoFalso(opts: {
  canal: ChannelLike;
  docker?: DockerPort;
  containerAtivo?: string | null;
  dir?: string;
}): EstadoDoRunner {
  return {
    canalAtual: opts.canal,
    dir: opts.dir ?? '/home/user/projetos/loja',
    gerenciadorPty: new GerenciadorDePty(
      '/home/user/projetos/loja',
      () => {},
      () => {},
      null as never,
    ),
    docker: opts.docker ?? dockerFalso(),
    containerAtivo: opts.containerAtivo ?? null,
  };
}

describe('tratarExec — roteamento host vs container (ADR 0137)', () => {
  it('sem container ativo, roda no HOST (comportamento de sempre)', async () => {
    const canal = new CanalFalso();
    const docker = dockerFalso();
    const estado = estadoFalso({ canal, docker, containerAtivo: null });

    await tratarExec(estado, {
      ref: 'r1',
      command: 'echo oi',
      cwd: '/home/user/projetos/loja',
    });

    expect(docker.exec).not.toHaveBeenCalled();
    expect(canal.pushes).toHaveLength(1);
    expect(canal.pushes[0]?.event).toBe('exec_result');
  });

  it('com container ativo, roda via docker exec, com cwd traduzido pra /work', async () => {
    const canal = new CanalFalso();
    const docker = dockerFalso();
    const estado = estadoFalso({
      canal,
      docker,
      containerAtivo: 'brabo-proj-abc12345',
    });

    await tratarExec(estado, {
      ref: 'r2',
      command: 'ls',
      cwd: '/home/user/projetos/loja/src',
    });

    expect(docker.exec).toHaveBeenCalledWith('brabo-proj-abc12345', {
      comando: 'ls',
      cwd: '/work/src',
    });
    expect(canal.pushes).toEqual([
      {
        event: 'exec_result',
        payload: { ref: 'r2', exitCode: 0, output: 'via container', timedOut: false },
      },
    ]);
  });

  it('cwd igual à raiz do projeto vira /work, sem sobra', async () => {
    const canal = new CanalFalso();
    const docker = dockerFalso();
    const estado = estadoFalso({ canal, docker, containerAtivo: 'brabo-proj-abc12345' });

    await tratarExec(estado, {
      ref: 'r3',
      command: 'pwd',
      cwd: '/home/user/projetos/loja',
    });

    expect(docker.exec).toHaveBeenCalledWith('brabo-proj-abc12345', {
      comando: 'pwd',
      cwd: '/work',
    });
  });
});

describe('tratarContainerStart (ADR 0137)', () => {
  it('sucesso: chama docker.start com raizDoProjeto = estado.dir, marca containerAtivo, responde sucesso', async () => {
    const canal = new CanalFalso();
    const docker = dockerFalso();
    const estado = estadoFalso({ canal, docker, containerAtivo: null });

    await tratarContainerStart(estado, {
      ref: 'r1',
      spec: {
        workspaceDirName: 'proj-abc12345',
        projectId: 'proj-1',
        projectSlug: 'proj-1',
        workspaceId: 'ws-1',
        imagem: 'node:22-bookworm-slim',
        imagemVersao: 3,
        rede: 'none',
        cpus: 1,
        memoriaMb: 512,
        pidsLimit: 256,
      },
    });

    expect(docker.start).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceDirName: 'proj-abc12345',
        imagem: 'node:22-bookworm-slim',
        raizDoProjeto: '/home/user/projetos/loja',
      }),
    );
    expect(estado.containerAtivo).toBe('brabo-proj-abc12345');
    expect(canal.pushes).toEqual([
      {
        event: 'container_start_result',
        payload: {
          ref: 'r1',
          sucesso: true,
          containerId: 'container-1',
          nome: 'brabo-proj-abc12345',
          jaEstavaDePe: false,
        },
      },
    ]);
  });

  it('spec inválida: responde sucesso: false, nunca lança, nunca chama docker.start', async () => {
    const canal = new CanalFalso();
    const docker = dockerFalso();
    const estado = estadoFalso({ canal, docker });

    await tratarContainerStart(estado, {
      ref: 'r2',
      spec: {
        // `..` recusado por `nomeDeWorkspaceValidado` — spec inválida antes
        // de chegar perto de `docker.start`.
        workspaceDirName: 'proj/../etc',
        projectId: 'proj-1',
        projectSlug: 'proj-1',
        workspaceId: 'ws-1',
        // `latest` também é recusado (`referenciaDeImagemAceitavel`), mas o
        // workspaceDirName já falha primeiro — qualquer um dos dois basta
        // para provar que a spec inválida nunca chama docker.start.
        imagem: 'node:latest',
        imagemVersao: 1,
        rede: 'none',
        cpus: 1,
        memoriaMb: 512,
        pidsLimit: 256,
      },
    });

    expect(docker.start).not.toHaveBeenCalled();
    expect(canal.pushes).toHaveLength(1);
    const payload = canal.pushes[0]?.payload as { sucesso: boolean; erro?: string };
    expect(payload.sucesso).toBe(false);
    expect(payload.erro).toBeTruthy();
  });

  it('Docker indisponível na máquina do usuário: responde sucesso: false, nunca lança', async () => {
    const canal = new CanalFalso();
    const docker = dockerFalso({
      start: vi.fn(async () => {
        throw new Error('não consegui falar com o daemon Docker');
      }),
    });
    const estado = estadoFalso({ canal, docker });

    await tratarContainerStart(estado, {
      ref: 'r3',
      spec: {
        workspaceDirName: 'proj-abc12345',
        projectId: 'proj-1',
        projectSlug: 'proj-1',
        workspaceId: 'ws-1',
        imagem: 'node:22-bookworm-slim',
        imagemVersao: 1,
        rede: 'none',
        cpus: 1,
        memoriaMb: 512,
        pidsLimit: 256,
      },
    });

    expect(estado.containerAtivo).toBeNull();
    const payload = canal.pushes[0]?.payload as { sucesso: boolean; erro?: string };
    expect(payload.sucesso).toBe(false);
    expect(payload.erro).toContain('daemon Docker');
  });
});

describe('tratarContainerStop/tratarContainerRemove (ADR 0137)', () => {
  it('tratarContainerStop: sucesso limpa containerAtivo', async () => {
    const canal = new CanalFalso();
    const docker = dockerFalso();
    const estado = estadoFalso({ canal, docker, containerAtivo: 'brabo-proj-abc12345' });

    await tratarContainerStop(estado, { ref: 'r1', workspaceDirName: 'proj-abc12345' });

    expect(docker.stop).toHaveBeenCalledWith('proj-abc12345');
    expect(estado.containerAtivo).toBeNull();
    expect(canal.pushes).toEqual([
      { event: 'container_stop_result', payload: { ref: 'r1', sucesso: true } },
    ]);
  });

  it('tratarContainerRemove: sucesso limpa containerAtivo', async () => {
    const canal = new CanalFalso();
    const docker = dockerFalso();
    const estado = estadoFalso({ canal, docker, containerAtivo: 'brabo-proj-abc12345' });

    await tratarContainerRemove(estado, { ref: 'r2', workspaceDirName: 'proj-abc12345' });

    expect(docker.remove).toHaveBeenCalledWith('proj-abc12345');
    expect(estado.containerAtivo).toBeNull();
    expect(canal.pushes).toEqual([
      { event: 'container_remove_result', payload: { ref: 'r2', sucesso: true } },
    ]);
  });

  it('tratarContainerStop: falha do docker vira sucesso: false, nunca lança', async () => {
    const canal = new CanalFalso();
    const docker = dockerFalso({
      stop: vi.fn(async () => {
        throw new Error('daemon fora do ar');
      }),
    });
    const estado = estadoFalso({ canal, docker, containerAtivo: 'brabo-proj-abc12345' });

    await tratarContainerStop(estado, { ref: 'r3', workspaceDirName: 'proj-abc12345' });

    // Não limpa containerAtivo — o runner não sabe se o container caiu de
    // verdade, só que a CHAMADA falhou.
    expect(estado.containerAtivo).toBe('brabo-proj-abc12345');
    const payload = canal.pushes[0]?.payload as { sucesso: boolean };
    expect(payload.sucesso).toBe(false);
  });
});

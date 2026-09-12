import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DockerPort, EspecificacaoDeContainer, PedidoDeExec } from '@brabo/docker-port';
import {
  MARCA_DE_CREDENCIAL_NAO_ENTREGUE,
  tratarContainerRemove,
  tratarContainerStart,
  tratarContainerStop,
  tratarExec,
  tratarMirrorSync,
  tratarWorkspaceCreate,
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
  destinoDoEspelho?: string | null;
  base?: string | null;
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
    destinoDoEspelho: opts.destinoDoEspelho ?? null,
    // ADR 0151/RN-529: `null` é o estado NORMAL, e o ÚNICO handler que
    // depende da base é `tratarWorkspaceCreate` (RN-532) — `exec`, `pty` e
    // espelho não sabem que ela existe.
    base: opts.base ?? null,
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

describe('tratarExec — a credencial não atravessa o docker exec (RN-558)', () => {
  // Credencial GERADA em runtime, nunca literal: fixture de segredo em disco é
  // o que o varredor da esteira pega, e allowlist é a saída que este
  // repositório não usa.
  function credencialFalsa(): Record<string, string> {
    return {
      BRABO_GIT_USERNAME: 'x-access-token',
      BRABO_GIT_TOKEN: `tok-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
    };
  }

  it('CAMINHO FELIZ — sem container ativo, o `env` chega ao HOST e nada é recusado', async () => {
    const canal = new CanalFalso();
    const docker = dockerFalso();
    const estado = estadoFalso({ canal, docker, containerAtivo: null });

    await tratarExec(estado, {
      ref: 'r4',
      command: 'git -c credential.helper= fetch origin',
      cwd: '/home/user/projetos/loja',
      env: credencialFalsa(),
    });

    expect(docker.exec).not.toHaveBeenCalled();
    // Executou de verdade (o `git` do teste falha, e tudo bem — o que importa
    // é que o comando NÃO foi recusado antes de rodar).
    const payload = canal.pushes[0]?.payload as { output: string };
    expect(canal.pushes).toHaveLength(1);
    expect(canal.pushes[0]?.event).toBe('exec_result');
    expect(payload.output).not.toContain(MARCA_DE_CREDENCIAL_NAO_ENTREGUE);
  });

  it('CASO DE FALHA — com container ativo, RECUSA nomeada em vez de descartar a credencial', async () => {
    const canal = new CanalFalso();
    const docker = dockerFalso();
    const estado = estadoFalso({ canal, docker, containerAtivo: 'brabo-proj-abc12345' });
    const env = credencialFalsa();

    await tratarExec(estado, {
      ref: 'r5',
      command: 'git -c credential.helper= fetch origin',
      cwd: '/home/user/projetos/loja',
      env,
    });

    // Nada rodou: nem no container, nem no host.
    expect(docker.exec).not.toHaveBeenCalled();

    expect(canal.pushes).toHaveLength(1);
    const { event, payload } = canal.pushes[0] as {
      event: string;
      payload: { ref: string; exitCode: number; output: string; timedOut: boolean };
    };
    expect(event).toBe('exec_result');
    expect(payload.ref).toBe('r5');
    expect(payload.exitCode).toBe(-1);
    expect(payload.timedOut).toBe(false);
    // A MARCA é contrato com o engine (`Engine.Runners.CredencialDeGit`) — é
    // por ela, e só por ela, que a origem da falha sai `politica`.
    expect(payload.output).toContain(MARCA_DE_CREDENCIAL_NAO_ENTREGUE);
    // E a saída diz o QUE e o PORQUÊ, não só que recusou.
    expect(payload.output).toContain('docker exec');
    expect(payload.output).toContain('ADR 0130');
    expect(payload.output).toContain('NADA foi executado');
  });

  it('a recusa NUNCA cita nome nem valor de variável do `env` — só a contagem (RN-507)', async () => {
    const canal = new CanalFalso();
    const estado = estadoFalso({ canal, containerAtivo: 'brabo-proj-abc12345' });
    const env = credencialFalsa();

    await tratarExec(estado, {
      ref: 'r6',
      command: 'git fetch origin',
      cwd: '/home/user/projetos/loja',
      env,
    });

    const payload = canal.pushes[0]?.payload as { output: string };
    for (const [nome, valor] of Object.entries(env)) {
      expect(payload.output).not.toContain(nome);
      expect(payload.output).not.toContain(valor);
    }
    expect(payload.output).toContain('2 variável(is)');
  });

  it('`env` VAZIO com container ativo não é recusa — roteia pro container como sempre', async () => {
    const canal = new CanalFalso();
    const docker = dockerFalso();
    const estado = estadoFalso({ canal, docker, containerAtivo: 'brabo-proj-abc12345' });

    await tratarExec(estado, {
      ref: 'r7',
      command: 'ls',
      cwd: '/home/user/projetos/loja',
      env: {},
    });

    expect(docker.exec).toHaveBeenCalledWith('brabo-proj-abc12345', {
      comando: 'ls',
      cwd: '/work',
    });
    const payload = canal.pushes[0]?.payload as { output: string };
    expect(payload.output).not.toContain(MARCA_DE_CREDENCIAL_NAO_ENTREGUE);
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

/**
 * ADR 0147 ponto 4 / RN-516 — o destino do espelho é o que foi CONCEDIDO no
 * join desta conexão, e nada mais. A recusa é o coração da regra: um destino
 * global (ou um que o servidor mandou e a concessão não cobre) faria o
 * artefato do projeto B aterrissar na pasta do projeto A, e o usuário
 * descobriria isso pelo conteúdo, não por um erro.
 */
describe('tratarMirrorSync — o destino concedido no join', () => {
  let raiz: string;

  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'brabo-runner-espelho-'));
  });

  afterEach(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  function projetoGit(): string {
    const workspace = join(raiz, 'projeto');
    mkdirSync(workspace, { recursive: true });
    const git = (args: string[]) =>
      execFileSync('git', args, { cwd: workspace, stdio: 'pipe' });
    git(['init', '-q', '.']);
    git(['config', 'user.email', 't@brabo.dev']);
    git(['config', 'user.name', 't']);
    writeFileSync(join(workspace, 'app.ts'), 'o trabalho');
    git(['add', '-A']);
    git(['commit', '-qm', 'inicial']);
    return workspace;
  }

  it('destino NÃO concedido é recusado — nada é copiado e nada é criado', async () => {
    const workspace = projetoGit();
    const outroDestino = join(raiz, 'destino-de-outro-projeto');
    const estado = estadoFalso({
      canal: new CanalFalso(),
      dir: workspace,
      destinoDoEspelho: join(raiz, 'concedido'),
    });

    await tratarMirrorSync(estado, { ref: 'm1', destino: outroDestino, momento: 'commit' });

    expect(existsSync(outroDestino)).toBe(false);
    expect(existsSync(join(raiz, 'concedido'))).toBe(false);
  });

  it('conexão SEM concessão nenhuma recusa qualquer destino', async () => {
    const workspace = projetoGit();
    const destino = join(raiz, 'espelho');
    const estado = estadoFalso({
      canal: new CanalFalso(),
      dir: workspace,
      destinoDoEspelho: null,
    });

    await tratarMirrorSync(estado, { ref: 'm2', destino, momento: 'commit' });

    expect(existsSync(destino)).toBe(false);
  });

  it('destino concedido (barra final não muda o caminho) copia o trabalho', async () => {
    const workspace = projetoGit();
    const destino = join(raiz, 'espelho');
    const estado = estadoFalso({
      canal: new CanalFalso(),
      dir: workspace,
      destinoDoEspelho: destino,
    });

    await tratarMirrorSync(estado, { ref: 'm3', destino: `${destino}/`, momento: 'commit' });

    expect(readFileSync(join(destino, 'app.ts'), 'utf8')).toBe('o trabalho');
  });

  it('falha do espelho NUNCA lança — o runner não cai por causa de uma cópia', async () => {
    const semGit = join(raiz, 'sem-git');
    const destino = join(raiz, 'espelho');
    mkdirSync(semGit, { recursive: true });
    const estado = estadoFalso({
      canal: new CanalFalso(),
      dir: semGit,
      destinoDoEspelho: destino,
    });

    await expect(
      tratarMirrorSync(estado, { ref: 'm4', destino, momento: 'commit' }),
    ).resolves.toBeUndefined();
  });

  // RN-517 (ADR 0147 ponto 7) — o desfecho REAL volta pelo canal. Até a
  // sessão 6B este handler não empurrava nada de propósito (a telemetria era
  // outra entrega); o que ele NUNCA pode fazer é empurrar um "ok" otimista
  // antes de a cópia terminar, e as asserções abaixo são sobre o que foi
  // COPIADO de verdade.
  /**
   * O ÚNICO push que este handler faz. Falha ALTO quando não há nenhum — um
   * `!` calado transformaria "o runner não reportou" (o defeito que a RN-517
   * fecha) num `undefined` que a asserção seguinte reportaria como outra
   * coisa.
   */
  function reporteDoEspelho(canal: CanalFalso): Record<string, unknown> {
    const push = canal.pushes[0];
    if (!push) throw new Error('nenhum mirror_sync_result foi empurrado');
    expect(push.event).toBe('mirror_sync_result');
    return push.payload as Record<string, unknown>;
  }

  describe('o desfecho é reportado em mirror_sync_result (RN-517)', () => {
    it('sucesso empurra a contagem REAL e o destino resolvido', async () => {
      const workspace = projetoGit();
      const destino = join(raiz, 'espelho');
      const canal = new CanalFalso();
      const estado = estadoFalso({ canal, dir: workspace, destinoDoEspelho: destino });

      await tratarMirrorSync(estado, { ref: 'm5', destino, momento: 'commit' });

      expect(canal.pushes).toHaveLength(1);
      const payload = reporteDoEspelho(canal);
      expect(payload.ref).toBe('m5');
      expect(payload.sucesso).toBe(true);
      expect(payload.copiados).toBe(1);
      expect(payload.pulados).toBe(0);
      expect(payload.recusados).toBe(0);
      // O destino RESOLVIDO (realpath depois do mkdir), não o que veio na
      // mensagem — é ele que a api congela na linha.
      expect(existsSync(payload.destino as string)).toBe(true);
      expect(payload.erro).toBeUndefined();
    });

    it('repositório VAZIO reporta sucesso com copiados: 0, nunca uma falha', async () => {
      const workspace = join(raiz, 'vazio');
      mkdirSync(workspace, { recursive: true });
      execFileSync('git', ['init', '-q', '.'], { cwd: workspace, stdio: 'pipe' });
      const destino = join(raiz, 'espelho-vazio');
      const canal = new CanalFalso();
      const estado = estadoFalso({ canal, dir: workspace, destinoDoEspelho: destino });

      await tratarMirrorSync(estado, { ref: 'm6', destino, momento: 'commit' });

      const payload = reporteDoEspelho(canal);
      // "sincronizou e não havia nada a copiar" é um ESTADO, não um vazio:
      // colapsá-lo em falha (ou em silêncio) é o que a RN-088 recusa.
      expect(payload.sucesso).toBe(true);
      expect(payload.copiados).toBe(0);
    });

    it('falha da cópia vira reporte de erro NOMEADO, nunca silêncio', async () => {
      const semGit = join(raiz, 'sem-git-2');
      mkdirSync(semGit, { recursive: true });
      const destino = join(raiz, 'espelho-falho');
      const canal = new CanalFalso();
      const estado = estadoFalso({ canal, dir: semGit, destinoDoEspelho: destino });

      await tratarMirrorSync(estado, { ref: 'm7', destino, momento: 'commit' });

      const payload = reporteDoEspelho(canal);
      expect(payload.sucesso).toBe(false);
      expect(String(payload.erro)).toContain('git');
      expect(payload.copiados).toBeUndefined();
    });

    it('destino NÃO concedido reporta erro SEM destino — nada foi escrito lá', async () => {
      const workspace = projetoGit();
      const canal = new CanalFalso();
      const estado = estadoFalso({
        canal,
        dir: workspace,
        destinoDoEspelho: join(raiz, 'concedido'),
      });

      await tratarMirrorSync(estado, {
        ref: 'm8',
        destino: join(raiz, 'outro'),
        momento: 'commit',
      });

      const payload = reporteDoEspelho(canal);
      expect(payload.sucesso).toBe(false);
      expect(String(payload.erro)).toContain('não foi concedido');
      // Congelar como "onde a rodada escreveu" uma pasta que este runner
      // RECUSOU seria a api afirmando o contrário do que aconteceu.
      expect(payload.destino).toBeUndefined();
    });

    it('sem canal (a conexão caiu no meio) não reporta e não lança', async () => {
      const workspace = projetoGit();
      const destino = join(raiz, 'espelho-sem-canal');
      const estado = estadoFalso({
        canal: new CanalFalso(),
        dir: workspace,
        destinoDoEspelho: destino,
      });
      estado.canalAtual = null;

      await expect(
        tratarMirrorSync(estado, { ref: 'm9', destino, momento: 'commit' }),
      ).resolves.toBeUndefined();
      // A cópia ACONTECEU mesmo sem ter a quem contar — a rodada não é
      // desfeita pela queda da conexão.
      expect(existsSync(join(destino, 'app.ts'))).toBe(true);
    });
  });
});

/**
 * ADR 0151 ponto 3 / RN-532 — `workspace_create`, e as DUAS coisas que só este
 * handler decide: a ORDEM `workspace_confirm` → `workspace_create_result` (é
 * ela que garante que o carimbo já existe quando o pedinte destrava), e que
 * NENHUMA saída fica calada, porque do outro lado há alguém bloqueado.
 */
describe('tratarWorkspaceCreate — a pasta do projeto sob a base local', () => {
  let raiz: string;

  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'brabo-runner-pasta-'));
  });

  afterEach(() => {
    rmSync(raiz, { recursive: true, force: true });
  });

  it('cria a pasta e empurra `workspace_confirm` ANTES do resultado', async () => {
    const canal = new CanalFalso();
    const base = join(raiz, 'projetos');
    mkdirSync(base);
    const estado = estadoFalso({ canal, base });

    await tratarWorkspaceCreate(estado, {
      ref: 'w1',
      projectId: 'p-1',
      segmento: 'loja',
    });

    const alvo = join(base, 'loja');
    expect(existsSync(join(alvo, '.git'))).toBe(true);

    // A ORDEM é o mecanismo: os dois chegam ao MESMO processo de canal, e o
    // `workspace_confirm` é síncrono do outro lado — mandá-lo primeiro é o que
    // faz `workspace_verified_at` já estar carimbado quando o pedinte volta.
    expect(canal.pushes).toEqual([
      { event: 'workspace_confirm', payload: { path: alvo } },
      { event: 'workspace_create_result', payload: { ref: 'w1', sucesso: true, caminho: alvo } },
    ]);
  });

  it('sem base consentida: `sem-base` NOMEADO, e NENHUM `workspace_confirm`', async () => {
    const canal = new CanalFalso();
    const estado = estadoFalso({ canal, base: null });

    await tratarWorkspaceCreate(estado, {
      ref: 'w2',
      projectId: 'p-1',
      segmento: 'loja',
    });

    expect(canal.pushes).toHaveLength(1);
    const [push] = canal.pushes;
    expect(push?.event).toBe('workspace_create_result');
    const payload = push?.payload as Record<string, unknown>;
    expect(payload.sucesso).toBe(false);
    expect(payload.motivo).toBe('sem-base');
    // Confirmar um caminho que não foi criado faria a api gravar uma pasta
    // que não existe — por isso o confirm só sai no sucesso.
    expect(payload.caminho).toBeUndefined();
  });

  it('segmento que escapa da base é recusado NOMEADO, e nada nasce fora dela', async () => {
    const canal = new CanalFalso();
    const base = join(raiz, 'projetos');
    mkdirSync(base);
    const estado = estadoFalso({ canal, base });

    await tratarWorkspaceCreate(estado, {
      ref: 'w3',
      projectId: 'p-1',
      segmento: '../fora',
    });

    expect(existsSync(join(raiz, 'fora'))).toBe(false);
    const payload = canal.pushes[0]?.payload as Record<string, unknown>;
    expect(payload.sucesso).toBe(false);
    expect(payload.motivo).toBe('segmento');
  });

  it('sem canal (a conexão caiu) não empurra nada e não lança', async () => {
    const base = join(raiz, 'projetos');
    const estado = estadoFalso({ canal: new CanalFalso(), base });
    estado.canalAtual = null;

    await expect(
      tratarWorkspaceCreate(estado, { ref: 'w4', projectId: 'p-1', segmento: 'loja' }),
    ).resolves.toBeUndefined();
    expect(existsSync(join(base, 'loja'))).toBe(false);
  });
});

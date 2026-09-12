import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CredencialDeAutenticacao } from './auth.ts';
import {
  CredencialNaoEDeMaquinaError,
  listarProjetosDoRunner,
  planejarConexoes,
  type ProjetoDoRunner,
} from './projetos.ts';

/**
 * As duas metades da descoberta do agente de MÁQUINA (RN-544), testadas
 * separadas porque falham por motivos diferentes: a rota pode recusar a
 * credencial, e a base pode recusar o nome de pasta que veio pela rede.
 *
 * `fetch` é injetado — nenhum teste daqui toca a rede. As pastas moram dentro
 * do `$HOME` de propósito: no Linux a RN-434 recusa qualquer coisa fora dele, e
 * um `tmpdir()` faria o caso feliz falhar pelo motivo errado.
 */

// Concatenado e repetitivo, como `TOKEN_VALIDO` em `auth.spec.ts` — e pelo
// mesmo motivo: um literal `brb_<20 caracteres variados>` tem entropia de
// credencial de verdade e o gitleaks do CI o reporta como `generic-api-key`.
// A resposta certa é o fixture não parecer segredo, nunca uma entrada na
// allowlist (ver o cabeçalho de `.gitleaks.toml`).
const CREDENCIAL_TOKEN: CredencialDeAutenticacao = {
  tipo: 'token',
  token: 'brb_' + 'a'.repeat(32),
};

function respostaFalsa(status: number, corpo: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(corpo), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

function projeto(parcial: Partial<ProjetoDoRunner> = {}): ProjetoDoRunner {
  return {
    projectId: 'p-1',
    name: 'Loja',
    workspaceDirName: 'loja-abc123',
    workspaceVerifiedAt: null,
    ...parcial,
  };
}

describe('listarProjetosDoRunner (RN-544)', () => {
  it('caminho feliz: devolve os projetos com o SEGMENTO, nunca um caminho absoluto', async () => {
    const fetchFalso = respostaFalsa(200, [
      {
        projectId: 'p-1',
        name: 'Loja',
        workspaceDirName: 'loja-abc123',
        workspaceVerifiedAt: '2026-09-01T10:00:00.000Z',
      },
      {
        projectId: 'p-2',
        name: 'Blog',
        workspaceDirName: 'blog-def456',
        workspaceVerifiedAt: null,
      },
    ]);

    const projetos = await listarProjetosDoRunner(
      'http://api.local',
      CREDENCIAL_TOKEN,
      fetchFalso,
    );

    expect(projetos).toHaveLength(2);
    expect(projetos[0]).toEqual({
      projectId: 'p-1',
      name: 'Loja',
      workspaceDirName: 'loja-abc123',
      workspaceVerifiedAt: '2026-09-01T10:00:00.000Z',
    });
    // O que viaja é o SEGMENTO: nenhuma linha traz caminho absoluto.
    for (const p of projetos) expect(p.workspaceDirName.startsWith('/')).toBe(false);
  });

  it('403 vira erro PRÓPRIO nomeando a credencial presa a projeto, com a mensagem da api', async () => {
    const fetchFalso = respostaFalsa(403, {
      message: 'Esta rota exige uma chave de dispositivo de máquina (sem projeto)',
    });

    await expect(
      listarProjetosDoRunner('http://api.local', CREDENCIAL_TOKEN, fetchFalso),
    ).rejects.toBeInstanceOf(CredencialNaoEDeMaquinaError);

    // A recusa NÃO se disfarça de falha genérica de rede, e repassa as palavras
    // da api em vez de reescrevê-las.
    await expect(
      listarProjetosDoRunner('http://api.local', CREDENCIAL_TOKEN, fetchFalso),
    ).rejects.toThrow(/chave de dispositivo de máquina/);
  });

  it('resposta fora do contrato é erro NOMEADO, nunca uma lista vazia silenciosa', async () => {
    await expect(
      listarProjetosDoRunner('http://api.local', CREDENCIAL_TOKEN, respostaFalsa(200, { ok: 1 })),
    ).rejects.toThrow(/fora do contrato/);

    await expect(
      listarProjetosDoRunner(
        'http://api.local',
        CREDENCIAL_TOKEN,
        respostaFalsa(200, [{ projectId: 'p-1', name: 'Loja' }]),
      ),
    ).rejects.toThrow(/linha 0/);
  });

  it('HTTP não-ok que não é 403 continua sendo falha genérica, com o status', async () => {
    await expect(
      listarProjetosDoRunner(
        'http://api.local',
        CREDENCIAL_TOKEN,
        respostaFalsa(500, { message: 'boom' }),
      ),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe('planejarConexoes (RN-544)', () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(homedir(), '.brabo-projetos-spec-'));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('caminho feliz: cada projeto vira <base>/<workspaceDirName>, e nada é criado', () => {
    const plano = planejarConexoes(
      base,
      [
        projeto({ projectId: 'p-1', workspaceDirName: 'loja-abc123' }),
        projeto({ projectId: 'p-2', name: 'Blog', workspaceDirName: 'blog-def456' }),
      ],
      { plataforma: process.platform, home: homedir() },
    );

    expect(plano.recusados).toEqual([]);
    expect(plano.alvos.map((a) => a.dir)).toEqual([
      join(base, 'loja-abc123'),
      join(base, 'blog-def456'),
    ]);
  });

  it('segmento que escapa da base é RECUSADO nomeando o projeto, e os outros seguem', () => {
    const plano = planejarConexoes(
      base,
      [
        projeto({ projectId: 'p-mau', name: 'Fuga', workspaceDirName: '../fora-da-base' }),
        projeto({ projectId: 'p-bom', name: 'Loja', workspaceDirName: 'loja-abc123' }),
      ],
      { plataforma: process.platform, home: homedir() },
    );

    expect(plano.recusados).toHaveLength(1);
    expect(plano.recusados[0]?.projeto.projectId).toBe('p-mau');
    expect(plano.recusados[0]?.motivo).toMatch(/segmento de projeto recusado/);

    // O projeto bom NÃO é derrubado pelo vizinho recusado.
    expect(plano.alvos).toHaveLength(1);
    expect(plano.alvos[0]?.projeto.projectId).toBe('p-bom');
  });

  it('segmento que aponta para a PRÓPRIA base é recusado (daria a este projeto a pasta de todos)', () => {
    const plano = planejarConexoes(base, [projeto({ workspaceDirName: '.' })], {
      plataforma: process.platform,
      home: homedir(),
    });

    expect(plano.alvos).toEqual([]);
    expect(plano.recusados[0]?.motivo).toMatch(/PRÓPRIA base/);
  });

  it('symlink no meio do segmento é pego pela SEGUNDA passada, não pela léxica', () => {
    // `<base>/atalho` -> uma pasta fora da base. A forma lexical de
    // `atalho/projeto` é impecável; só o `realpath` pega.
    const fora = mkdtempSync(join(homedir(), '.brabo-fora-spec-'));
    try {
      mkdirSync(join(fora, 'projeto'), { recursive: true });
      symlinkSync(fora, join(base, 'atalho'));

      const plano = planejarConexoes(base, [projeto({ workspaceDirName: 'atalho/projeto' })], {
        plataforma: process.platform,
        home: homedir(),
      });

      expect(plano.alvos).toEqual([]);
      expect(plano.recusados[0]?.motivo).toMatch(/links simbólicos/);
    } finally {
      rmSync(fora, { recursive: true, force: true });
    }
  });
});

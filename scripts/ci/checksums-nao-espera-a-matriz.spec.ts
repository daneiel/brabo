import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * O manifesto assinado (`checksums.txt`, ADR 0149 / RN-524) não pode ser refém
 * da matriz de binários.
 *
 * A medição, contra as TRÊS tags que existem (`v4.0.0`, `v4.0.1`, `v5.0.0`): o
 * alvo `darwin-x64` (`macos-13`) fica **24h00m01s** na fila e é cancelado pelo
 * teto do Actions — o MESMO número nas três, o que diz que ele nunca é
 * agendado. Os outros quatro jobs terminam em no máximo **4m18s**. Com
 * `needs: build`, o `always()` fazia o job RODAR (dependência cancelada está
 * coberta), mas só um dia depois — e um manifesto que chega um dia depois é,
 * para quem instala, um manifesto ausente: `GET /runner-releases/binary`
 * recusa com `release_sem_manifesto` (RN-525) e o `install.sh` recusa junto
 * (RN-526), nas duas plataformas que ANEXARAM inclusive.
 *
 * Este teste é ESTÁTICO, e o limite é o mesmo de
 * `oferta-de-fonte-na-imagem.spec.ts`: o que fecha o item de verdade é uma tag
 * final, e o job nunca rodou em nenhuma. O que dá para garantir a cada PR é
 * que ninguém reponha o `needs:` nem apague a espera sem que algo fique
 * vermelho.
 *
 * O que este teste NÃO afirma, de propósito: que `darwin-x64` passe a
 * construir. Isso é outra decisão, de dono — trocar o label, tirar a
 * plataforma ou pagar runner —, e o manifesto não pode depender dela.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CAMINHO = '.github/workflows/build-runner-binaries.yml';
const bruto = readFileSync(path.join(RAIZ, CAMINHO), 'utf8');

interface Passo {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
}
interface Job {
  needs?: unknown;
  if?: string;
  'timeout-minutes'?: number;
  env?: Record<string, string>;
  steps: Passo[];
  strategy?: { matrix?: { include?: { target: string }[] } };
}

const workflow = YAML.parse(bruto) as { jobs: Record<string, Job> };
const checksums = workflow.jobs.checksums as Job;
const build = workflow.jobs.build as Job;
const passo = (nome: string): Passo => {
  const achado = checksums.steps.find((p) => p.name === nome);
  if (achado === undefined) throw new Error(`passo "${nome}" não existe mais em ${CAMINHO}`);
  return achado;
};

describe('o job `checksums`', () => {
  it('NÃO depende da matriz — é a correção, e repor `needs:` a desfaz', () => {
    expect(checksums.needs).toBeUndefined();
  });

  it('continua pulando o ensaio, que não tem Release a que anexar', () => {
    expect(checksums.if).toContain("inputs.tag != ''");
  });

  it('espera a Release e os binários no lugar do `needs:`, com teto para cada', () => {
    const espera = passo('Esperar a Release e os binários');
    expect(espera.env?.ESPERA_MAXIMA_DA_RELEASE_SEGUNDOS).toBe('600');
    expect(espera.env?.ESPERA_MAXIMA_DOS_BINARIOS_SEGUNDOS).toBe('1200');
    // Sai cedo quando os cinco chegam; só o teto sustenta o caso patológico.
    expect(espera.run).toContain('break');
    expect(espera.run).toContain('sleep');
  });

  it('o teto dos binários é o `timeout-minutes` do próprio job `build`', () => {
    // 1200s = 20min = o máximo que um alvo COM runner pode demorar depois de
    // começar. O que ele deliberadamente não cobre é o tempo de FILA.
    const tetoDoBuild = build['timeout-minutes'];
    const espera = passo('Esperar a Release e os binários');
    expect(Number(espera.env?.ESPERA_MAXIMA_DOS_BINARIOS_SEGUNDOS)).toBe((tetoDoBuild ?? 0) * 60);
  });

  it('cabe dentro do próprio `timeout-minutes`, com folga para assinar', () => {
    const espera = passo('Esperar a Release e os binários');
    const somaDasEsperas =
      Number(espera.env?.ESPERA_MAXIMA_DA_RELEASE_SEGUNDOS) + Number(espera.env?.ESPERA_MAXIMA_DOS_BINARIOS_SEGUNDOS);
    expect((checksums['timeout-minutes'] ?? 0) * 60).toBeGreaterThan(somaDasEsperas);
  });

  it('a ausência de um alvo NÃO é erro — o manifesto sai e declara o que não cobre', () => {
    const espera = passo('Esperar a Release e os binários');
    // Teto atingido é `::notice::`, nunca `::error::`: esperar em vão é o caso
    // previsto, e falhar aqui reproduziria o refém que o `needs:` era.
    expect(espera.run).toContain('::notice::');
    expect(espera.run).not.toContain('::error::teto');

    const gerar = passo('Gerar, assinar e anexar o checksums.txt');
    expect(gerar.run).toContain('::warning::o manifesto NÃO cobre');
  });

  it('a ausência da RELEASE continua sendo erro — este workflow só ANEXA', () => {
    const espera = passo('Esperar a Release e os binários');
    expect(espera.run).toContain('nunca cria uma');
    expect(espera.run).toMatch(/::error::a Release de \$TAG não existe/);
  });

  it('nenhum binário anexado continua sendo erro, e não um manifesto vazio', () => {
    expect(passo('Gerar, assinar e anexar o checksums.txt').run).toContain('O manifesto NÃO é criado vazio');
  });
});

describe('a lista de alvos esperados', () => {
  it('mora no JOB, para os dois passos lerem a MESMA', () => {
    expect(checksums.env?.ALVOS_ESPERADOS).toBeDefined();
    for (const p of checksums.steps) expect(p.env?.ALVOS_ESPERADOS).toBeUndefined();
  });

  it('bate com a matriz — declarar ausência contra uma lista velha é calar sobre um alvo', () => {
    const daMatriz = (build.strategy?.matrix?.include ?? []).map((i) => i.target).sort();
    const esperados = (checksums.env?.ALVOS_ESPERADOS ?? '').split(/\s+/).filter(Boolean).sort();
    expect(esperados).toEqual(daMatriz);
  });
});

describe('o que o ADR 0149 fixou e esta mudança não toca', () => {
  it('continua sendo UM manifesto assinado, não uma assinatura por binário', () => {
    const gerar = passo('Gerar, assinar e anexar o checksums.txt').run ?? '';
    expect(gerar.match(/cosign sign-blob/g)).toHaveLength(1);
    expect(gerar).toContain('--bundle checksums.txt.bundle');
  });

  it('continua verificando o que assinou, no mesmo run e antes de anexar', () => {
    const gerar = passo('Gerar, assinar e anexar o checksums.txt').run ?? '';
    const assinou = gerar.indexOf('cosign sign-blob');
    const verificou = gerar.indexOf('cosign verify-blob');
    const anexou = gerar.indexOf('gh release upload');
    expect(assinou).toBeLessThan(verificou);
    expect(verificou).toBeLessThan(anexou);
  });

  it('continua com `id-token: write` — a identidade que assina é este workflow', () => {
    expect(bruto).toContain('id-token: write');
  });

  it('o `install.sh` da tag continua entrando no manifesto (RN-526)', () => {
    const gerar = passo('Gerar, assinar e anexar o checksums.txt').run ?? '';
    expect(gerar).toContain('${GITHUB_WORKSPACE}/install.sh');
    expect(gerar).toContain('sha256sum brabo-runner-* install.sh');
  });
});

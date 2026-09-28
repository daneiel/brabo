import { describe, expect, it } from 'vitest';
import {
  alvosDoMake,
  ancorasExplicitas,
  conferirTabela,
  gatilhosDoWorkflow,
  repositorio,
  RUNBOOK,
} from './procedimentos-do-runbook.mjs';
import { arquivos, ler } from './fontes.mjs';

/**
 * AT-193: a tabela de procedimentos do runbook, conferida contra o repositório.
 * Cada caso de reprovação abaixo é uma MUTAÇÃO de uma tabela certa — a mutação
 * reprova, a forma certa passa. O repositório é de mentira (arquivos, alvos do
 * Makefile e gatilhos dos workflows declarados aqui), para que cada mutação
 * mude UMA coisa.
 */

type Problema = { linha: number; procedimento: string; coluna: string; motivo: string };

const ARQUIVOS = new Set([
  'deploy/k8s/test-restore.sh',
  'apps/api/test/scripts/rewrap-deks.spec.ts',
  '.github/workflows/propriedades.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/install-e2e.yml',
]);
const GATILHOS: Record<string, Set<string>> = {
  '.github/workflows/propriedades.yml': new Set(['schedule', 'workflow_dispatch']),
  '.github/workflows/ci.yml': new Set(['pull_request']),
  '.github/workflows/install-e2e.yml': new Set(['push', 'tag', 'workflow_dispatch']),
};
const repo = {
  existe: (c: string) => ARQUIVOS.has(c),
  alvos: new Set(['test-restore', 'rollout-test']),
  gatilhos: (w: string) => GATILHOS[w] ?? null,
};

const CABECALHO = '| procedure | anchor | verification | schedule |\n|---|---|---|---|';
const LINHAS_CERTAS = [
  '| Verify a backup | [Restore](#restore) | `make test-restore` (`deploy/k8s/test-restore.sh`) | weekly `.github/workflows/propriedades.yml` |',
  '| Rotate the master key | [Master key](#rotacao-da-chave-mestra) | `apps/api/test/scripts/rewrap-deks.spec.ts` | every PR `.github/workflows/ci.yml` |',
  '| Install | [Installing](#instalando) | `.github/workflows/install-e2e.yml` | every tag `.github/workflows/install-e2e.yml`; manual (the migration) |',
  '| Fall back to sealed-secrets | [Sealed](#fallback-sealed-secrets) | **None.** Nothing runs it | manual |',
];

function runbook(linhas: string[] = LINHAS_CERTAS, cabecalho = CABECALHO): string {
  return [
    '# Runbook',
    '## Restore {#restore}',
    '## Master key rotation {#rotacao-da-chave-mestra}',
    '## Installing {#instalando}',
    '### Secrets: fallback to sealed-secrets {#fallback-sealed-secrets}',
    '',
    '## Procedures and how each is verified {#procedimentos-e-verificacao}',
    '',
    'Texto antes da tabela.',
    '',
    cabecalho,
    ...linhas,
    '',
  ].join('\n');
}

/** A tabela certa com UMA linha trocada. */
function mutar(indice: number, linha: string): string {
  const linhas = [...LINHAS_CERTAS];
  linhas[indice] = linha;
  return runbook(linhas);
}

const motivos = (texto: string) =>
  (conferirTabela(texto, repo).problemas as Problema[]).map((p) => `[${p.coluna}] ${p.motivo}`);

describe('conferirTabela — a forma certa', () => {
  it('passa, e conta quem tem verificação e quem declara que não tem', () => {
    const r = conferirTabela(runbook(), repo);
    expect(r.problemas).toEqual([]);
    expect(r.cego).toBeNull();
    expect(r).toMatchObject({ linhas: 4, comVerificacao: 3, declaradasSem: 1 });
  });
});

describe('conferirTabela — mutações da coluna verification', () => {
  it('MUTAÇÃO: o spec citado foi renomeado', () => {
    expect(motivos(mutar(1, LINHAS_CERTAS[1].replace('rewrap-deks.spec.ts', 'rewrap.spec.ts')))).toEqual([
      '[verification] `apps/api/test/scripts/rewrap.spec.ts` não existe no repositório',
    ]);
  });

  it('MUTAÇÃO: o alvo do make sumiu do Makefile', () => {
    expect(motivos(mutar(0, LINHAS_CERTAS[0].replace('make test-restore', 'make test-backup')))).toEqual([
      '[verification] `make test-backup` não é alvo do Makefile',
    ]);
  });

  it('MUTAÇÃO: a célula vazia', () => {
    expect(motivos(mutar(1, '| Rotate the master key | [Master key](#rotacao-da-chave-mestra) |  | every PR `.github/workflows/ci.yml` |'))).toEqual([
      '[verification] vazia',
    ]);
  });

  it('MUTAÇÃO: remeter a "see below" — o que o critério do EP-015 proíbe', () => {
    expect(
      motivos(mutar(1, '| Rotate the master key | [Master key](#rotacao-da-chave-mestra) | see below | every PR `.github/workflows/ci.yml` |')),
    ).toEqual([
      '[verification] remete a "ver abaixo/acima" em vez de nomear a prova',
      '[verification] não nomeia arquivo nem `make <alvo>`, e não declara `**None**`',
    ]);
  });

  it('MUTAÇÃO: prosa sem arquivo e sem declarar **None**', () => {
    expect(motivos(mutar(3, '| Fall back to sealed-secrets | [Sealed](#fallback-sealed-secrets) | nobody checked | manual |'))).toEqual([
      '[verification] não nomeia arquivo nem `make <alvo>`, e não declara `**None**`',
    ]);
  });
});

describe('conferirTabela — mutações da coluna schedule', () => {
  it('MUTAÇÃO: `weekly` num workflow sem `schedule:` — o caso que a AT-193 nomeou', () => {
    expect(motivos(mutar(1, LINHAS_CERTAS[1].replace('every PR', 'weekly')))).toEqual([
      '[schedule] `.github/workflows/ci.yml` não tem agenda (`schedule:`) no `on:`',
    ]);
  });

  it('MUTAÇÃO: `every PR` num workflow que só roda por agenda', () => {
    expect(motivos(mutar(0, LINHAS_CERTAS[0].replace('weekly', 'every PR')))).toEqual([
      '[schedule] `.github/workflows/propriedades.yml` não tem `pull_request` no `on:`',
    ]);
  });

  it('MUTAÇÃO: `every tag` num workflow sem `push: tags`', () => {
    expect(motivos(mutar(2, LINHAS_CERTAS[2].replace('every tag `.github/workflows/install-e2e.yml`', 'every tag `.github/workflows/ci.yml`')))).toEqual([
      '[schedule] `.github/workflows/ci.yml` não tem `push: tags` no `on:`',
    ]);
  });

  it('MUTAÇÃO: o workflow citado não existe', () => {
    expect(motivos(mutar(0, LINHAS_CERTAS[0].replace('propriedades.yml', 'provas.yml')))).toEqual([
      '[schedule] `.github/workflows/provas.yml` não existe',
    ]);
  });

  it('MUTAÇÃO: a classe afirmada sem citar o workflow', () => {
    expect(motivos(mutar(0, LINHAS_CERTAS[0].replace(' `.github/workflows/propriedades.yml`', '')))).toEqual([
      '[schedule] "weekly" afirma agenda (`schedule:`) e não cita o workflow (`.github/workflows/<x>.yml`)',
    ]);
  });

  it('MUTAÇÃO: `manual` citando um workflow — o que roda sozinho não é manual', () => {
    expect(motivos(mutar(3, LINHAS_CERTAS[3].replace('| manual |', '| manual `.github/workflows/ci.yml` |')))).toEqual([
      '[schedule] `manual` não cita workflow (.github/workflows/ci.yml): um workflow que roda sozinho não é manual',
    ]);
  });

  it('MUTAÇÃO: segmento sem classe', () => {
    expect(motivos(mutar(3, LINHAS_CERTAS[3].replace('| manual |', '| when someone remembers |')))).toEqual([
      '[schedule] "when someone remembers" não começa com weekly|daily|monthly|every PR|every tag|manual',
    ]);
  });

  it('MUTAÇÃO: a célula vazia', () => {
    expect(motivos(mutar(3, LINHAS_CERTAS[3].replace('| manual |', '|  |')))).toEqual(['[schedule] vazia']);
  });
});

describe('conferirTabela — mutações da coluna anchor', () => {
  it('MUTAÇÃO: âncora que não é `{#id}` de cabeçalho (o id derivado do título não conta)', () => {
    expect(motivos(mutar(0, LINHAS_CERTAS[0].replace('(#restore)', '(#restore-automatizado)')))).toEqual([
      '[anchor] `#restore-automatizado` não é um `{#id}` explícito de cabeçalho do runbook',
    ]);
  });

  it('MUTAÇÃO: sem link', () => {
    expect(motivos(mutar(0, LINHAS_CERTAS[0].replace('[Restore](#restore)', 'Restore')))).toEqual([
      '[anchor] sem link `(#id)` para a seção do procedimento',
    ]);
  });
});

describe('conferirTabela — o check cego', () => {
  it('MUTAÇÃO: a seção sumiu', () => {
    const r = conferirTabela(runbook().replace('## Procedures and how each is verified', '## Procedures'), repo);
    expect(r.cego).toMatch(/não achei a seção/);
  });

  it('MUTAÇÃO: a tabela sumiu da seção', () => {
    const texto = runbook([], '') + '\n## Outra seção\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
    expect(conferirTabela(texto, repo).cego).toBe('a seção não tem tabela');
  });

  it('MUTAÇÃO: a tabela sem linhas', () => {
    expect(conferirTabela(runbook([]), repo).cego).toBe('a tabela não tem linhas');
  });

  it('MUTAÇÃO: as colunas mudaram', () => {
    const r = conferirTabela(runbook(LINHAS_CERTAS, '| procedure | where | verification |\n|---|---|---|'), repo);
    expect(r.cego).toMatch(/as colunas mudaram/);
  });

  it('MUTAÇÃO: linha com uma célula a menos', () => {
    expect(motivos(mutar(3, '| Fall back to sealed-secrets | [Sealed](#fallback-sealed-secrets) | **None.** |'))).toEqual([
      '[—] a linha tem 3 células, não 4',
    ]);
  });
});

describe('os extratores', () => {
  it('gatilhosDoWorkflow lê o `on:` parseado, não um `schedule:` em comentário', () => {
    expect(gatilhosDoWorkflow('# schedule: todo dia\non:\n  pull_request:\n    branches: [dev]\n')).toEqual(new Set(['pull_request']));
    expect(gatilhosDoWorkflow("on:\n  schedule:\n    - cron: '0 4 * * 0'\n  workflow_dispatch:\n")).toEqual(
      new Set(['schedule', 'workflow_dispatch']),
    );
    expect(gatilhosDoWorkflow("on:\n  push:\n    tags:\n      - 'v*'\n")).toEqual(new Set(['push', 'tag']));
    expect(gatilhosDoWorkflow('on:\n  push:\n    branches: [dev]\n')).toEqual(new Set(['push']));
    expect(gatilhosDoWorkflow('on: pull_request\n')).toEqual(new Set(['pull_request']));
  });

  it('alvosDoMake pega `alvo:` e ignora atribuição `X := y`', () => {
    expect(alvosDoMake('SHELL := bash\nK8S := x\nhelp: ## ajuda\ntest-restore: ## prova\n\t@bash x\n')).toEqual(
      new Set(['help', 'test-restore']),
    );
  });

  it('ancorasExplicitas pega só `{#id}` no fim de cabeçalho', () => {
    expect(ancorasExplicitas('## A {#a}\n### B\ntexto {#c}\n#### D {#d}\n')).toEqual(new Set(['a', 'd']));
  });
});

describe('a árvore real', () => {
  const r = conferirTabela(ler(RUNBOOK), repositorio(arquivos, ler));

  it('a tabela do runbook existe, confere inteira e não está cega', () => {
    expect(r.cego).toBeNull();
    expect(r.problemas).toEqual([]);
    expect(r.linhas).toBe(r.comVerificacao + r.declaradasSem);
    expect(r.linhas).toBeGreaterThanOrEqual(28);
  });

  it('os três gatilhos que a tabela usa existem de verdade nos workflows citados', () => {
    const repoReal = repositorio(arquivos, ler);
    expect(repoReal.gatilhos('.github/workflows/propriedades.yml')?.has('schedule')).toBe(true);
    expect(repoReal.gatilhos('.github/workflows/ci.yml')?.has('pull_request')).toBe(true);
    expect(repoReal.gatilhos('.github/workflows/install-e2e.yml')?.has('tag')).toBe(true);
    expect(repoReal.gatilhos('.github/workflows/nao-existe.yml')).toBeNull();
  });
});

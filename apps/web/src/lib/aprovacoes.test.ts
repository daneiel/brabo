/// <reference types="node" />
// Segundo arquivo do app que lê o filesystem em tempo de teste (o primeiro é
// `activity-catalog.test.ts`, e pelo mesmo motivo). A referência tripla-slash
// escopa `@types/node` só a este arquivo: `tsconfig.app.json` deixa `node` de
// fora de propósito, para não mascarar um `process`/`fs` usado por engano em
// código que RODA no navegador.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEM_FRASE, descreverAcao, descreverHipotese, fraseDaAcao, verboDaAcao } from './aprovacoes';
import type { PsychologistHypothesis } from './api-types';

/**
 * A FONTE DE VERDADE dos tipos de ação é o backend, e ela é um arquivo que o
 * web não importa — `apps/api` não é dependência de `apps/web`. Toda vez que
 * alguém confiou numa cópia escrita à mão aqui, ela envelheceu em silêncio:
 * `ApprovalCard.test.tsx` tinha uma lista de 13 tipos com o comentário "se o
 * backend ganhar um tipo e ninguém acrescentar aqui, o compilador reprova", e
 * `parallelize`/`raise_max_parallel` entraram na FASE 14d sem que nada
 * reprovasse — porque o compilador só cobra o que ele enxerga, e ele não
 * enxergava a lista do outro pacote.
 *
 * Ler o arquivo fecha o buraco: tipo novo no backend, sem frase aqui, reprova.
 *
 * `process.cwd()` (não `import.meta.url`) porque o vitest deste pacote roda com
 * cwd = `apps/web` tanto localmente quanto via `pnpm --filter web test`.
 */
const DECIDE_TS = join(process.cwd(), '..', 'api', 'src', 'domain', 'actions', 'decide.ts');

function tiposDoBackend(): string[] {
  const conteudo = readFileSync(DECIDE_TS, 'utf8');
  const inicio = conteudo.indexOf('export const ACTION_TYPES');
  if (inicio === -1) {
    throw new Error(
      `Não achei "export const ACTION_TYPES" em ${DECIDE_TS} — se a constante mudou de nome ` +
        `ou de arquivo, este teste precisa acompanhar, nunca ser removido.`,
    );
  }
  const fim = conteudo.indexOf('];', inicio);
  // Comentários fora antes de procurar aspas: o bloco tem prosa entre as
  // entradas, e um apóstrofo em português viraria um "tipo" fantasma.
  const bloco = conteudo.slice(inicio, fim).replace(/\/\/.*$/gm, '');
  return [...bloco.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

const TIPOS = tiposDoBackend();

describe('vocabulário das aprovações — cobertura dos tipos do backend', () => {
  it('a lista do backend não veio vazia — se veio, o parsing quebrou', () => {
    expect(TIPOS.length).toBeGreaterThan(10);
  });

  it.each(TIPOS)('%s tem verbo próprio', (tipo) => {
    const { verbo } = descreverAcao(tipo);
    expect(verbo).not.toBe('propõe uma ação');
    expect(verbo).not.toContain(tipo);
  });

  /*
   * O teste que a FASE 19 existe para deixar para trás: tipo novo sem FRASE
   * reprova aqui, e não daqui a três meses num card que despeja JSON.
   *
   * O payload é VAZIO de propósito. Frase que só funciona com a fixture certa é
   * frase que quebra em produção — o payload real vem do engine e de dez casos
   * de uso diferentes, e nenhum deles promete uma chave. Com `{}` a frase tem
   * de continuar sendo uma frase verdadeira, só menos específica.
   */
  it.each(TIPOS)('%s tem frase em português, mesmo com payload vazio', (tipo) => {
    const frase = fraseDaAcao(tipo, {});
    expect(frase, `o tipo "${tipo}" entrou sem frase em src/lib/aprovacoes.ts`).not.toBeNull();
    expect(frase!.length).toBeGreaterThan(20);
    expect(frase!.endsWith('.')).toBe(true);
    // Nunca o identificador cru: "Executa raise_max_parallel" não é português.
    // Só os `snake_case`: `terminal` e `spend` são palavras que a frase pode
    // legitimamente usar ("no terminal do projeto"), e proibi-las aqui obrigaria
    // a torcer a frase para satisfazer o teste.
    if (tipo.includes('_')) expect(frase).not.toContain(tipo);
  });
});

describe('frases derivadas do payload', () => {
  it('o comando entra na frase da ação de terminal', () => {
    expect(fraseDaAcao('terminal', { command: 'pnpm test' })).toContain('pnpm test');
  });

  it('a branch e a contagem de arquivos entram na frase do commit', () => {
    const frase = fraseDaAcao('git_commit', {
      branch: 'feature/x',
      files: [{ path: 'a.ts' }, { path: 'b.ts' }],
      message: 'feat: dois arquivos',
    });
    expect(frase).toContain('2 arquivos');
    expect(frase).toContain('feature/x');
    expect(frase).toContain('feat: dois arquivos');
  });

  it('singular e plural não se misturam', () => {
    const frase = fraseDaAcao('git_commit', { files: [{ path: 'a.ts' }] })!;
    expect(frase).toContain('de 1 arquivo');
    expect(frase).not.toContain('arquivos');
  });

  it('a frase do merge cita a PR, e a do teto cita o salto', () => {
    expect(fraseDaAcao('git_merge', { pullRequestId: '42' })).toContain('#42');
    expect(fraseDaAcao('raise_max_parallel', { area: 'dev', atual: 2, proposto: 4 })).toContain(
      'de 2 para 4',
    );
  });

  it('comando muito longo é cortado — a frase é resumo, o corpo é que é o dado', () => {
    const frase = fraseDaAcao('terminal', { command: 'x'.repeat(500) })!;
    expect(frase.length).toBeLessThan(200);
    expect(frase).toContain('…');
  });

  it('payload com chave de tipo errado degrada em vez de imprimir [object Object]', () => {
    const frase = fraseDaAcao('git_push', { branch: { nome: 'feature/x' } })!;
    expect(frase).not.toContain('[object Object]');
    expect(frase).toContain('branch de trabalho');
  });
});

describe('tipo que o web ainda não conhece', () => {
  it('não quebra: verbo neutro, frase nula e "ver detalhes" para quem renderiza', () => {
    const { verbo, frase } = descreverAcao('deploy_producao', { host: 'x' });
    expect(verbo).toBe('propõe uma ação');
    expect(frase).toBeNull();
    expect(SEM_FRASE).toBe('ver detalhes');
  });
});

describe('a hipótese do Psicólogo fala a mesma língua', () => {
  function hipotese(status: PsychologistHypothesis['status']): PsychologistHypothesis {
    return {
      id: 'h1',
      projectId: 'p1',
      sessionId: 's1',
      analysisId: 'a1',
      agenteAlvo: 'po',
      observacao: 'o',
      hipotese: 'h',
      sugestao: 's',
      confiancaPercent: 80,
      evidenceEventIds: ['e1'],
      terminationAnalysis: null,
      status,
      decidedBy: null,
      decidedAt: null,
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    };
  }

  it('usa o MESMO verbo do instruction_patch — não um vocabulário paralelo', () => {
    expect(descreverHipotese(hipotese('proposed')).verbo).toBe(verboDaAcao('instruction_patch'));
  });

  /*
   * A frase não pode prometer o que o accept não faz: aceitar enfileira para a
   * Anamnese (`accept-hypothesis.use-case.ts`), e é ELA que depois propõe o
   * `instruction_patch` — que ainda vem para aprovação. "A instrução será
   * alterada" seria mentira, e é a mentira que faria alguém hesitar em aceitar.
   */
  it('proposta: diz que o ajuste ainda passa por aprovação', () => {
    const frase = descreverHipotese(hipotese('proposed')).frase!;
    expect(frase).toContain('Anamnese');
    expect(frase).toContain('aprovar');
    expect(frase).toContain('PO');
  });

  it('descartada: diz explicitamente que nada mudou', () => {
    expect(descreverHipotese(hipotese('dismissed')).frase).toContain('nada mudou');
  });
});

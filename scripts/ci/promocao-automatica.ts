/**
 * promocao-automatica — decide se o PR automático `dev` → `qa` pode ser
 * mergeado, e o mergeia (ADR 0217, AT-555).
 * Fonte da política: docs/explanation/branching-policy.md, seção
 * "Automatic promotion to qa (test phase)".
 *
 * O repositório NÃO tem checks obrigatórios: `gh pr merge --auto` mergearia
 * na hora, sem esperar o CI. Por isso a espera é deste script: ele lê os check
 * runs do head do PR até TODOS terminarem e só mergeia se nenhum terminou em
 * falha. Qualquer falha PARA a promoção e diz qual check, com o link.
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

/** Conclusões que param a promoção. */
export const CONCLUSOES_QUE_PARAM = [
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'startup_failure',
  'stale',
] as const;

/** O check deste próprio workflow, que nunca termina antes da decisão. */
export const NOME_DO_PROPRIO_CHECK = 'Promoção automática para qa';

export interface CheckRun {
  nome: string;
  /** `queued` | `in_progress` | `completed` | `waiting` | `pending` */
  status: string;
  /** `success` | `failure` | `neutral` | `skipped` | `cancelled` | ... | null */
  conclusao: string | null;
  url: string;
}

export type Decisao =
  | { acao: 'mergear'; contados: number }
  | { acao: 'esperar'; pendentes: string[] }
  | { acao: 'parar'; falhas: CheckRun[] };

/**
 * Pura. Falha vence pendente: um check vermelho já decide, não adianta
 * esperar os outros. Zero checks é ESPERAR — o PR acabou de abrir e os
 * workflows ainda não registraram nada; mergear ali seria mergear sem CI.
 */
export function decidir(checks: CheckRun[], proprio = NOME_DO_PROPRIO_CHECK): Decisao {
  const contados = checks.filter((c) => c.nome !== proprio);
  const falhas = contados.filter(
    (c) =>
      c.status === 'completed' &&
      (CONCLUSOES_QUE_PARAM as readonly string[]).includes(c.conclusao ?? ''),
  );
  if (falhas.length > 0) return { acao: 'parar', falhas };
  if (contados.length === 0) {
    return { acao: 'esperar', pendentes: ['(nenhum check registrado ainda)'] };
  }
  const pendentes = contados.filter((c) => c.status !== 'completed').map((c) => c.nome);
  if (pendentes.length > 0) return { acao: 'esperar', pendentes };
  return { acao: 'mergear', contados: contados.length };
}

export function resumoDaParada(numero: string, falhas: CheckRun[]): string {
  const l = [
    `### Promoção automática parada — PR #${numero}`,
    '',
    'Nenhum merge foi feito. Os checks abaixo não passaram:',
    '',
  ];
  for (const f of falhas) l.push(`- **${f.nome}** — \`${f.conclusao}\` — ${f.url}`);
  l.push('');
  l.push('Corrija na `dev`: o próximo merge lá reabre a tentativa.');
  return l.join('\n');
}

// ------------------------------------------------------------- adaptador CLI

async function principal(): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  const { appendFileSync } = await import('node:fs');
  const { setTimeout: dormir } = await import('node:timers/promises');

  const repo = process.env.GITHUB_REPOSITORY ?? '';
  const numero = process.env.PR_NUMERO ?? '';
  const teto = Number(process.env.TETO_DE_ESPERA_S ?? '3000') * 1000;
  const intervalo = Number(process.env.INTERVALO_S ?? '30') * 1000;
  if (!repo || !numero) {
    console.error('[promocao-automatica] GITHUB_REPOSITORY e PR_NUMERO são obrigatórios.');
    process.exit(2);
  }
  const resumo = (texto: string): void => {
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${texto}\n`);
    }
  };

  const inicio = Date.now();
  for (;;) {
    // O head é relido a cada volta: um merge novo na `dev` muda o PR, e a
    // decisão tem de valer para o commit que será mergeado.
    const sha = execFileSync(
      'gh',
      ['pr', 'view', numero, '--json', 'headRefOid', '--jq', '.headRefOid'],
      { encoding: 'utf8' },
    ).trim();
    const bruto = execFileSync(
      'gh',
      [
        'api',
        '--paginate',
        `repos/${repo}/commits/${sha}/check-runs`,
        '--jq',
        '.check_runs[] | {nome: .name, status: .status, conclusao: .conclusion, url: .html_url}',
      ],
      { encoding: 'utf8' },
    );
    const checks = bruto
      .split('\n')
      .filter(Boolean)
      .map((linha) => JSON.parse(linha) as CheckRun);
    const decisao = decidir(checks);

    if (decisao.acao === 'parar') {
      resumo(resumoDaParada(numero, decisao.falhas));
      for (const f of decisao.falhas) {
        console.log(`::error title=promocao-automatica::${f.nome} (${f.conclusao}) ${f.url}`);
      }
      process.exit(1);
    }
    if (decisao.acao === 'mergear') {
      // Merge commit, como os humanos fazem: o check de promoção exige.
      // `--match-head-commit` impede mergear um head que ninguém conferiu.
      execFileSync('gh', ['pr', 'merge', numero, '--merge', '--match-head-commit', sha], {
        stdio: 'inherit',
      });
      resumo(
        `### Promoção automática — PR #${numero} mergeado\n\n${decisao.contados} checks verdes em \`${sha}\`.`,
      );
      return;
    }
    if (Date.now() - inicio > teto) {
      resumo(
        `### Promoção automática parada — PR #${numero}\n\n` +
          `Teto de espera estourado com checks pendentes: ${decisao.pendentes.join(', ')}.`,
      );
      console.log('::error title=promocao-automatica::teto de espera estourado');
      process.exit(1);
    }
    console.log(`[promocao-automatica] esperando: ${decisao.pendentes.join(', ')}`);
    await dormir(intervalo);
  }
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}

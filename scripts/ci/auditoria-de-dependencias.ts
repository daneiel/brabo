/**
 * auditoria-de-dependencias — roda `pnpm audit` e separa "não consegui
 * perguntar" de "encontrei vulnerabilidade".
 * Fonte da política: docs/explanation/cadeia-de-suprimentos-do-ci.md
 *
 * ## Por que existe
 *
 * O endpoint de advisories do npm (`POST /-/npm/v1/security/advisories/bulk`)
 * cai e volta em janelas de dezenas de minutos. Em 2026-09-04 ele derrubou o
 * job de auditoria em QUATRO PRs distintas, com a assinatura sempre igual:
 *
 *     [WARN] POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk error (503)
 *     TimeoutError: The operation was aborted due to timeout
 *
 * Reproduzido fora do CI, batendo direto no endpoint: mesma ausência de
 * resposta. Não era rede do runner, não era a árvore de dependências, não era
 * a PR — era o serviço.
 *
 * Um gate que reprova por indisponibilidade de terceiro ensina uma coisa só:
 * a re-rodar até passar. E quem re-roda até passar acaba re-rodando também
 * quando o vermelho era de verdade.
 *
 * ## A decisão, e o que ela NÃO afrouxa
 *
 * Decisão do dono do produto (2026-09-04): **timeout repetido em três
 * tentativas é RISCO ASSUMIDO** — o job segue verde, alto e declarado.
 *
 * O que ela não toca: **achado de vulnerabilidade continua reprovando na
 * primeira**, sem retentativa nenhuma. A distinção é o que torna a decisão
 * defensável — sem ela, "aceitar timeout" viraria "aceitar qualquer
 * vermelho", que é exatamente o gate desligado com outro nome.
 *
 * E falha DESCONHECIDA reprova. Se a saída não casa com nenhuma das duas
 * assinaturas, o veredito é `achado`: a única coisa pior que um gate que
 * reprova demais é um que aprova o que não entendeu.
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

export type TipoDeVeredito = 'limpo' | 'achado' | 'infra';

export interface VereditoDeAudit {
  tipo: TipoDeVeredito;
  motivo: string;
}

/**
 * Marcas de que o `pnpm audit` FALOU com o registry e teve resposta — ou
 * seja, de que existe achado de verdade. Elas têm PRECEDÊNCIA sobre as de
 * rede: um relatório pode citar um pacote chamado `timeout`, e a
 * classificação não pode virar "infra" por causa disso.
 */
const MARCAS_DE_ACHADO = [
  /\d+\s+vulnerabilit/i,
  /vulnerabilities?\s+found/i,
  /│\s*(critical|high|moderate|low)\s*│/i,
  /patched\s+in/i,
  /vulnerable\s+versions/i,
];

/** Marcas de que a REQUISIÇÃO não completou — o audit nunca chegou a rodar. */
const MARCAS_DE_INFRA = [
  /TimeoutError/,
  /operation was aborted due to timeout/i,
  /advisories\/bulk\s+error\s+\(\d+\)/i,
  /ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH/,
  /socket hang up/i,
  /ERR_PNPM_(FETCH|REGISTRIES?)_/,
];

/**
 * @param codigo - código de saída do `pnpm audit`
 * @param saida - stdout + stderr juntos
 */
export function classificarAudit(codigo: number, saida: string): VereditoDeAudit {
  if (codigo === 0) {
    return { tipo: 'limpo', motivo: 'o audit rodou e não achou nada acima do nível configurado' };
  }

  const achado = MARCAS_DE_ACHADO.find((r) => r.test(saida));
  if (achado) {
    return {
      tipo: 'achado',
      motivo: `o audit rodou e reportou vulnerabilidade (casou ${achado})`,
    };
  }

  const infra = MARCAS_DE_INFRA.find((r) => r.test(saida));
  if (infra) {
    return {
      tipo: 'infra',
      motivo: `a requisição ao registry não completou (casou ${infra})`,
    };
  }

  // Fail CLOSED. Não entender a saída não autoriza aprovar.
  return {
    tipo: 'achado',
    motivo:
      `o audit saiu com código ${codigo} e a saída não casou com nenhuma ` +
      'assinatura conhecida — tratado como achado, nunca como infra',
  };
}

/**
 * O veredito FINAL depois de N tentativas.
 *
 * Só é risco assumido quando TODAS falharam por infra. Um `achado` em
 * qualquer tentativa reprova; um `limpo` em qualquer tentativa aprova.
 */
export function decidirDepoisDasTentativas(
  vereditos: readonly VereditoDeAudit[],
): { ok: boolean; assumido: boolean; motivo: string } {
  if (vereditos.length === 0) {
    return { ok: false, assumido: false, motivo: 'nenhuma tentativa foi executada' };
  }

  const achado = vereditos.find((v) => v.tipo === 'achado');
  if (achado) return { ok: false, assumido: false, motivo: achado.motivo };

  if (vereditos.some((v) => v.tipo === 'limpo')) {
    return { ok: true, assumido: false, motivo: 'o audit rodou e passou' };
  }

  return {
    ok: true,
    assumido: true,
    motivo:
      `${vereditos.length} tentativa(s), todas sem resposta do registry — ` +
      'RISCO ASSUMIDO (decisão do dono do produto, 2026-09-04)',
  };
}

async function principal(): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  const { appendFileSync } = await import('node:fs');

  const tentativas = Number(process.env.TENTATIVAS ?? '3');
  const vereditos: VereditoDeAudit[] = [];

  for (let i = 1; i <= tentativas; i++) {
    let codigo = 0;
    let saida = '';
    try {
      saida = execFileSync('pnpm', ['audit', '--audit-level', 'critical'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (erro) {
      const e = erro as { status?: number; stdout?: string; stderr?: string };
      codigo = e.status ?? 1;
      saida = `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
    }

    const veredito = classificarAudit(codigo, saida);
    vereditos.push(veredito);
    console.log(`[auditoria] tentativa ${i}/${tentativas}: ${veredito.tipo} — ${veredito.motivo}`);

    // Achado não se retenta: a resposta já veio, e ela é não.
    if (veredito.tipo !== 'infra') {
      console.log(saida.trim().slice(0, 4000));
      break;
    }
  }

  const final = decidirDepoisDasTentativas(vereditos);

  if (!final.ok) {
    console.log(`::error title=auditoria::${final.motivo}`);
    process.exit(1);
  }

  if (final.assumido) {
    const aviso =
      'auditoria de dependências NÃO rodou: o endpoint de advisories do npm ' +
      'não respondeu em nenhuma das tentativas. Seguindo como RISCO ASSUMIDO.';
    console.log(`::warning title=auditoria::${aviso}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### ⚠️ Auditoria de dependências: risco assumido\n\n${aviso}\n\n` +
          `${final.motivo}\n\nEsta execução **não** afirma que a árvore está limpa — ` +
          'afirma que não foi possível perguntar. Vulnerabilidade encontrada continua ' +
          'reprovando na primeira tentativa, sem retentativa.\n',
      );
    }
  }

  console.log(`[auditoria] ${final.motivo}`);
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}

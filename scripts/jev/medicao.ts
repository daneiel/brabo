/**
 * As contas da medição do Jev (AT-237): concordância por agente com intervalo
 * de confiança, curva acerto × limiar, latência e custo. Função pura sobre os
 * registros que `replay.ts` grava — nenhum número daqui é anotado à mão.
 */
import { RESPONDER_SEM_FERRAMENTA, type Suspeita } from './passos.ts';

export const TETO_DE_LATENCIA_MS = 2000;
export const LIMIARES = [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] as const;

export interface Registro {
  id: string;
  ator: string;
  /** Ferramentas distintas do passo; `[]` = passo sem ferramenta. */
  rotulos: string[];
  /** A ferramenta de CADA chamada do passo, em ordem. */
  chamadas: string[];
  suspeitas: Suspeita[];
  /** A última ferramenta do passo anterior do mesmo ator e sessão (linha de base). */
  anterior: string | null;
  opcoes: number;
  status: 'ok' | 'timeout' | 'erro_http' | 'erro_de_rede' | 'resposta_invalida' | 'escolha_fora_das_opcoes';
  escolha: string | null;
  confianca: number | null;
  latenciaMs: number;
  custoUsd: number | null;
  tokensDeEntrada: number | null;
  /** O `id` da resposta (`gen-dec-…`), para conferir o custo em `GET /api/v1/generation`. */
  geracao?: string;
  /** As probabilidades por opção (guardadas desde a 2ª rodada; a 1ª só guardou a escolha). */
  probabilidades?: Record<string, number>;
  detalhe?: string;
}

export function acertou(r: Registro): boolean {
  if (r.escolha === null) return false;
  if (r.rotulos.length === 0) return r.escolha === RESPONDER_SEM_FERRAMENTA;
  return r.rotulos.includes(r.escolha);
}

/** Intervalo de Wilson a 95% — o que se diz honestamente com n pequeno. */
export function wilson(acertos: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = acertos / n;
  const d = 1 + (z * z) / n;
  const centro = (p + (z * z) / (2 * n)) / d;
  const meia = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centro - meia), Math.min(1, centro + meia)];
}

export function percentil(valores: readonly number[], p: number): number | null {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  const i = Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1));
  return v[i]!;
}

export interface Taxa {
  n: number;
  acertos: number;
  ic: [number, number];
}

export function taxa(rs: readonly Registro[], ok: (r: Registro) => boolean = acertou): Taxa {
  const acertos = rs.filter(ok).length;
  return { n: rs.length, acertos, ic: wilson(acertos, rs.length) };
}

export interface LinhaPorAgente {
  ator: string;
  opcoes: number;
  passos: number;
  heterogeneos: number;
  passo: Taxa;
  limpos: Taxa;
  chamadas: { n: number; acertos: number };
  repetirAnterior: Taxa;
  semFerramenta: Taxa;
  /** Passos com ferramenta em que o Jev ESCOLHEU uma ferramenta (não `responder_sem_ferramenta`). */
  escolheuFerramenta: Taxa;
}

const comFerramenta = (r: Registro) => r.rotulos.length > 0;
const respondido = (r: Registro) => r.status === 'ok';

export function porAgente(rs: readonly Registro[]): LinhaPorAgente[] {
  const atores = [...new Set(rs.map((r) => r.ator))].sort();
  return atores.map((ator) => {
    const doAtor = rs.filter((r) => r.ator === ator && respondido(r));
    const com = doAtor.filter(comFerramenta);
    const chamadas = com.flatMap((r) => r.chamadas.map((c) => c === r.escolha));
    return {
      ator,
      opcoes: doAtor[0]?.opcoes ?? 0,
      passos: com.length,
      heterogeneos: com.filter((r) => r.rotulos.length > 1).length,
      passo: taxa(com),
      limpos: taxa(com.filter((r) => r.suspeitas.length === 0)),
      chamadas: { n: chamadas.length, acertos: chamadas.filter(Boolean).length },
      repetirAnterior: taxa(
        com.filter((r) => r.anterior !== null),
        (r) => r.rotulos.includes(r.anterior!),
      ),
      semFerramenta: taxa(doAtor.filter((r) => !comFerramenta(r))),
      escolheuFerramenta: taxa(com.filter((r) => r.escolha !== RESPONDER_SEM_FERRAMENTA)),
    };
  });
}

/**
 * O passo em que o roteador RESTRINGIRIA o cardápio, pela regra decidida na
 * AT-236: confiança ≥ limiar E uma ferramenta escolhida. `responder_sem_ferramenta`
 * com qualquer confiança manda o catálogo inteiro na v1 (resposta 12) — para o
 * modelo, é o mesmo que a queda; não restringe e não erra.
 */
export function restringe(r: Registro, limiar: number): boolean {
  return r.status === 'ok' && r.escolha !== null && r.escolha !== RESPONDER_SEM_FERRAMENTA && (r.confianca ?? 0) >= limiar;
}

export interface PontoDaCurva {
  limiar: number;
  total: number;
  /** Passos em que o cardápio viraria UMA ferramenta. */
  restritos: number;
  /** Entre os restritos, a ferramenta oferecida era uma das chamadas. */
  acerto: Taxa;
  /** Restritos à ferramenta ERRADA — o erro que custa (o modelo não vê a certa). */
  errados: number;
  /** Restritos a uma ferramenta certa de um passo HETEROGÊNEO: o resto do passo seria cortado. */
  heterogeneosCortados: number;
}

export function curva(rs: readonly Registro[], limiares: readonly number[] = LIMIARES): PontoDaCurva[] {
  const base = rs.filter((r) => respondido(r) && comFerramenta(r));
  return limiares.map((limiar) => {
    const restritos = base.filter((r) => restringe(r, limiar));
    const acerto = taxa(restritos);
    return {
      limiar,
      total: base.length,
      restritos: restritos.length,
      acerto,
      errados: restritos.length - acerto.acertos,
      heterogeneosCortados: restritos.filter((r) => acertou(r) && r.rotulos.length > 1).length,
    };
  });
}

/**
 * O menor limiar cujo LIMITE INFERIOR de Wilson do acerto entre os restritos
 * alcança `alvo` — critério conservador de propósito: com amostra pequena, a
 * estimativa pontual promete mais do que os dados sustentam. `null` = nenhum.
 */
export function limiarSugerido(pontos: readonly PontoDaCurva[], alvo: number): PontoDaCurva | null {
  return pontos.find((p) => p.restritos > 0 && p.acerto.ic[0] >= alvo) ?? null;
}

/** Os grupos em que a curva é impressa — o laço e o `state` diferem entre eles. */
export const GRUPOS: Record<string, (ator: string) => boolean> = {
  todos: () => true,
  'dev agents (ToolLoop)': (a) => a.startsWith('dev-') && a !== 'dev-lead',
  conversacionais: (a) => ['criativo', 'po', 'arquiteto', 'dev-lead', 'ux-designer', 'staff', 'infra'].includes(a),
  'gates e demais ToolLoop': (a) =>
    ['appsec', 'qa-automacao', 'qa-estrategia', 'qa-performance-seguranca', 'anamnese', 'infra-workflows'].includes(a),
};

export interface Resumo {
  pedidos: number;
  porStatus: Record<string, number>;
  latencia: { p50: number | null; p95: number | null; max: number | null; acimaDoTeto: number };
  custo: { totalUsd: number; porPassoUsd: number | null; semCusto: number };
}

export function resumo(rs: readonly Registro[]): Resumo {
  const porStatus: Record<string, number> = {};
  for (const r of rs) porStatus[r.status] = (porStatus[r.status] ?? 0) + 1;
  const lat = rs.filter((r) => r.status !== 'timeout' && r.status !== 'erro_de_rede').map((r) => r.latenciaMs);
  const custos = rs.map((r) => r.custoUsd).filter((c): c is number => c !== null);
  const total = custos.reduce((a, b) => a + b, 0);
  return {
    pedidos: rs.length,
    porStatus,
    latencia: {
      p50: percentil(lat, 50),
      p95: percentil(lat, 95),
      max: percentil(lat, 100),
      acimaDoTeto: rs.filter((r) => r.latenciaMs > TETO_DE_LATENCIA_MS || r.status === 'timeout').length,
    },
    custo: { totalUsd: total, porPassoUsd: custos.length ? total / custos.length : null, semCusto: rs.length - custos.length },
  };
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const fmtTaxa = (t: Taxa) => (t.n === 0 ? '—' : `${t.acertos}/${t.n} = ${pct(t.acertos / t.n)} (${pct(t.ic[0])}–${pct(t.ic[1])})`);

/** O relatório em Markdown — só contagens e ids de agente, nunca texto de sessão. */
export function relatorio(rs: readonly Registro[], alvo = 0.9): string {
  const linhas: string[] = [];
  const r = resumo(rs);
  linhas.push(`Pedidos ao Jev: ${r.pedidos} (${Object.entries(r.porStatus).map(([k, v]) => `${k} ${v}`).join(', ')})`, '');
  linhas.push(
    '| agente | opções | passos c/ ferramenta | heterogêneos | concordância por passo (IC 95%) | sem suspeita | por chamada | quando o Jev escolheu ferramenta | linha de base "repetir anterior" | passos sem ferramenta |',
    '|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const l of porAgente(rs)) {
    linhas.push(
      `| ${l.ator} | ${l.opcoes} | ${l.passos} | ${l.heterogeneos} | ${fmtTaxa(l.passo)} | ${fmtTaxa(l.limpos)} | ` +
        `${l.chamadas.n ? `${l.chamadas.acertos}/${l.chamadas.n}` : '—'} | ${fmtTaxa(l.escolheuFerramenta)} | ` +
        `${fmtTaxa(l.repetirAnterior)} | ${fmtTaxa(l.semFerramenta)} |`,
    );
  }
  const ok = rs.filter(respondido);
  const com = ok.filter(comFerramenta);
  linhas.push(
    `| **todos** | | ${com.length} | ${com.filter((x) => x.rotulos.length > 1).length} | ${fmtTaxa(taxa(com))} | ` +
      `${fmtTaxa(taxa(com.filter((x) => x.suspeitas.length === 0)))} | | ` +
      `${fmtTaxa(taxa(com.filter((x) => x.escolha !== RESPONDER_SEM_FERRAMENTA)))} | ` +
      `${fmtTaxa(taxa(com.filter((x) => x.anterior !== null), (x) => x.rotulos.includes(x.anterior!)))} | ` +
      `${fmtTaxa(taxa(ok.filter((x) => !comFerramenta(x))))} |`,
  );
  for (const [grupo, doGrupo] of Object.entries(GRUPOS)) {
    const c = curva(rs.filter((x) => doGrupo(x.ator)));
    if (c[0]!.total === 0) continue;
    linhas.push(
      '',
      `**Curva — ${grupo}** (${c[0]!.total} passos com ferramenta)`,
      '',
      '| limiar | cardápio restrito a 1 | caem para o catálogo inteiro | acerto entre os restritos (IC 95%) | restritos à ferramenta errada | heterogêneos cortados |',
      '|---|---|---|---|---|---|',
    );
    for (const p of c) {
      linhas.push(
        `| ${p.limiar.toFixed(2)} | ${p.restritos} | ${p.total - p.restritos} | ${fmtTaxa(p.acerto)} | ${p.errados} | ${p.heterogeneosCortados} |`,
      );
    }
    const s = limiarSugerido(c, alvo);
    linhas.push(
      '',
      s
        ? `Menor limiar com o limite inferior do IC ≥ ${pct(alvo)}: ${s.limiar.toFixed(2)} (restringe ${s.restritos}/${s.total}).`
        : `Nenhum limiar da grade tem o limite inferior do IC ≥ ${pct(alvo)}.`,
    );
  }
  linhas.push(
    '',
    `Latência (ms): p50 ${r.latencia.p50}, p95 ${r.latencia.p95}, máx ${r.latencia.max}; acima de ${TETO_DE_LATENCIA_MS} ms: ${r.latencia.acimaDoTeto}.`,
    `Custo pelo usage.cost: total US$ ${r.custo.totalUsd.toFixed(6)}, por passo US$ ${r.custo.porPassoUsd?.toFixed(8) ?? '—'} (${r.custo.semCusto} sem usage.cost).`,
  );
  return linhas.join('\n');
}

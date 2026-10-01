/**
 * O que o teste ao vivo da AT-239 grava por execução, a tabela que sai disso,
 * a REGRA DE DECISÃO (escrita antes de qualquer rodada) e a estimativa de
 * custo que se faz ANTES de gastar. Tudo puro.
 */
import { percentil, wilson } from '../medicao.ts';
import type { Braco, Execucao, Fim } from './laco.ts';
import type { Verificacao } from './executor.ts';

export interface RegistroDeExecucao extends Execucao {
  data: string;
  sha: string;
  modelo: string;
  tarefa: string;
  rodada: number;
  braco: Braco;
  verificacao: Verificacao;
}

export const custoDoChat = (r: RegistroDeExecucao): number => r.passos.reduce((s, p) => s + p.custoDoChatUsd, 0);
export const custoDoJev = (r: RegistroDeExecucao): number => r.passos.reduce((s, p) => s + (p.roteamento?.custoUsd ?? 0), 0);
export const custoTotal = (r: RegistroDeExecucao): number => custoDoChat(r) + custoDoJev(r);
export const gastoDe = (rs: readonly RegistroDeExecucao[]): number => rs.reduce((s, r) => s + custoTotal(r), 0);

/** Execução interrompida pelo teto de gasto não entra na tabela: ela não terminou por motivo do braço. */
export const contaNaTabela = (r: RegistroDeExecucao): boolean => r.fim !== 'teto_de_gasto';

/**
 * Falha da CONTA ou da REDE no chat (chave sem limite, proxy que recusa,
 * transporte que caiu): não é desfecho do braço, é a medição que não aconteceu.
 * O `vivo.ts` NÃO grava essa execução — gravada, ela entraria na tabela como
 * "a task não saiu" e a retomada nunca a repetiria (medido em 2026-10-01: com o
 * limite da chave esgotado, as duas execuções do ensaio terminaram `erro` no
 * primeiro passo com `HTTP 403` e foram contadas). Erro do PROVIDER com corpo
 * 200 (`error` no JSON) segue sendo desfecho do modelo, como no engine.
 */
export const ERRO_DE_INFRA = /^(HTTP (401|402|403|407|429)\b|transporte:)/;
export function falhaDeInfra(e: Pick<Execucao, 'passos'>): string | null {
  for (const p of e.passos) if (p.erro && ERRO_DE_INFRA.test(p.erro)) return `passo ${p.iteracao}: ${p.erro}`;
  return null;
}

const mediana = (xs: readonly number[]): number | null => percentil(xs, 50);
const media = (xs: readonly number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

export interface Linha {
  modelo: string;
  braco: Braco;
  execucoes: number;
  sucesso: number;
  ic: [number, number];
  passosMediana: number | null;
  passosMedia: number | null;
  passosRecuperados: number;
  passosTotais: number;
  voltasComCatalogoInteiro: number;
  latenciaP50Ms: number | null;
  latenciaP95Ms: number | null;
  latenciaDoLlmP50Ms: number | null;
  latenciaDoJevP50Ms: number | null;
  custoMedioUsd: number | null;
  custoMedioDoJevUsd: number | null;
  custoPorSucessoUsd: number | null;
  /** Passos em que o Jev foi consultado / aplicou um menu menor / caiu para o catálogo inteiro. */
  consultados: number;
  aplicados: number;
  quedas: number;
  motivosDaQueda: Record<string, number>;
  /** O Jev respondeu `responder_sem_ferramenta` ou não havia ferramenta anterior: catálogo inteiro sem queda. */
  semRestricao: number;
  foraDoCardapio: number;
  fins: Partial<Record<Fim, number>>;
}

export function linhas(rs: readonly RegistroDeExecucao[]): Linha[] {
  const grupos = new Map<string, RegistroDeExecucao[]>();
  for (const r of rs.filter(contaNaTabela)) {
    const k = `${r.modelo}\u0000${r.braco}`;
    grupos.set(k, [...(grupos.get(k) ?? []), r]);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, g]) => {
      const [modelo, braco] = k.split('\u0000') as [string, Braco];
      const passos = g.flatMap((r) => r.passos);
      const roteados = passos.flatMap((p) => (p.roteamento ? [p.roteamento] : []));
      const sucesso = g.filter((r) => r.verificacao.ok).length;
      const motivos: Record<string, number> = {};
      for (const q of roteados) if (q.motivoDaQueda) motivos[q.motivoDaQueda] = (motivos[q.motivoDaQueda] ?? 0) + 1;
      const fins: Partial<Record<Fim, number>> = {};
      for (const r of g) fins[r.fim] = (fins[r.fim] ?? 0) + 1;
      const custos = g.map(custoTotal);
      return {
        modelo,
        braco,
        execucoes: g.length,
        sucesso,
        ic: wilson(sucesso, g.length),
        passosMediana: mediana(g.map((r) => r.passos.length)),
        passosMedia: media(g.map((r) => r.passos.length)),
        passosRecuperados: passos.filter((p) => p.recuperado).length,
        passosTotais: passos.length,
        voltasComCatalogoInteiro: roteados.filter((q) => q.repetidoComCatalogoInteiro).length,
        latenciaP50Ms: mediana(g.map((r) => r.latenciaMs)),
        latenciaP95Ms: percentil(g.map((r) => r.latenciaMs), 95),
        latenciaDoLlmP50Ms: mediana(g.map((r) => r.passos.reduce((s, p) => s + p.latenciaMs, 0))),
        latenciaDoJevP50Ms: mediana(roteados.map((q) => q.latenciaMs)),
        custoMedioUsd: media(custos),
        custoMedioDoJevUsd: media(g.map(custoDoJev)),
        custoPorSucessoUsd: sucesso === 0 ? null : custos.reduce((a, b) => a + b, 0) / sucesso,
        consultados: roteados.length,
        aplicados: roteados.filter((q) => q.aplicado).length,
        quedas: roteados.filter((q) => q.motivoDaQueda !== null).length,
        motivosDaQueda: motivos,
        semRestricao: roteados.filter((q) => !q.aplicado && q.motivoDaQueda === null).length,
        foraDoCardapio: roteados.reduce((s, q) => s + q.foraDoCardapio.length, 0),
        fins,
      };
    });
}

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
const seg = (ms: number | null): string => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);
const usd = (x: number | null): string => (x === null ? '—' : `US$ ${x.toFixed(4)}`);
const num = (x: number | null, casas = 1): string => (x === null ? '—' : x.toFixed(casas));

export function tabela(ls: readonly Linha[]): string {
  const cab =
    '| modelo | Jev | execuções | a task saiu | passos/execução (mediana · média) | passos via `tool_call_recovery` | latência da execução p50 · p95 | latência do LLM (chat + Jev) p50 | custo/execução (chat + Jev) | do qual Jev | custo por task que saiu | Jev: aplicado · sem restrição · queda | voltas com catálogo inteiro | fora do cardápio | fins |\n' +
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const corpo = ls.map((l) => {
    const quedas = Object.entries(l.motivosDaQueda).map(([m, n]) => `${m} ${n}`).join(', ');
    const fins = Object.entries(l.fins).map(([f, n]) => `${f} ${n}`).join(', ');
    const jev =
      l.consultados === 0
        ? '—'
        : `${l.aplicados}/${l.consultados} · ${l.semRestricao} · ${l.quedas}${quedas ? ` (${quedas})` : ''}`;
    return (
      `| \`${l.modelo}\` | ${l.braco} | ${l.execucoes} | ${l.sucesso}/${l.execucoes} = ${l.execucoes ? pct(l.sucesso / l.execucoes) : '—'} (${pct(l.ic[0])}–${pct(l.ic[1])}) ` +
      `| ${num(l.passosMediana, 0)} · ${num(l.passosMedia)} | ${l.passosRecuperados}/${l.passosTotais} | ${seg(l.latenciaP50Ms)} · ${seg(l.latenciaP95Ms)} | ${seg(l.latenciaDoLlmP50Ms)} ` +
      `| ${usd(l.custoMedioUsd)} | ${usd(l.custoMedioDoJevUsd)} | ${usd(l.custoPorSucessoUsd)} | ${jev} | ${l.braco === 'ligado' ? l.voltasComCatalogoInteiro : '—'} | ${l.braco === 'ligado' ? l.foraDoCardapio : '—'} | ${fins} |`
    );
  });
  return [cab, ...corpo].join('\n');
}

/**
 * A REGRA DE DECISÃO, escrita antes de qualquer rodada paga (2026-10-01). Por
 * modelo, comparando o braço ligado com o desligado:
 *
 * - **margem de qualidade**: a taxa de "a task saiu" do ligado não pode ficar
 *   mais de 10 pontos abaixo da do desligado (a margem que a seção "live test"
 *   de `medicao-do-jev.md` usa para o tamanho de amostra pequeno);
 * - **custo**: o custo médio por task que SAIU (chat + Jev) do ligado não pode
 *   passar o do desligado — o Jev se paga ou não se paga;
 * - **latência**: a mediana da execução inteira do ligado não pode passar 1,2×
 *   a do desligado (o Jev é uma chamada a mais, em série, por passo).
 *
 * Manter ligado = os três passam em TODOS os modelos. Desligar = a margem de
 * qualidade reprova em todos, ou nenhum modelo passa nos três. Restringir = o
 * resto, nomeando os modelos em que passou. Amostra pequena não vira "passou":
 * com menos de 10 execuções por braço o veredito é `amostra_insuficiente`.
 */
export const MARGEM_DE_QUALIDADE = 0.1;
export const FATOR_DE_LATENCIA = 1.2;
export const MINIMO_DE_EXECUCOES = 10;

export type Veredito = 'manter_ligado' | 'restringir' | 'desligar' | 'amostra_insuficiente';

export interface Comparacao {
  modelo: string;
  deltaSucesso: number;
  razaoDeCusto: number | null;
  razaoDeLatencia: number | null;
  qualidade: boolean;
  custo: boolean;
  latencia: boolean;
}

export function comparar(ls: readonly Linha[]): { comparacoes: Comparacao[]; veredito: Veredito; passaram: string[] } {
  const modelos = [...new Set(ls.map((l) => l.modelo))].sort();
  const comparacoes: Comparacao[] = [];
  let insuficiente = modelos.length === 0;
  for (const m of modelos) {
    const on = ls.find((l) => l.modelo === m && l.braco === 'ligado');
    const off = ls.find((l) => l.modelo === m && l.braco === 'desligado');
    if (!on || !off || on.execucoes < MINIMO_DE_EXECUCOES || off.execucoes < MINIMO_DE_EXECUCOES) {
      insuficiente = true;
      continue;
    }
    const deltaSucesso = on.sucesso / on.execucoes - off.sucesso / off.execucoes;
    const razaoDeCusto = on.custoPorSucessoUsd !== null && off.custoPorSucessoUsd ? on.custoPorSucessoUsd / off.custoPorSucessoUsd : null;
    const razaoDeLatencia = on.latenciaP50Ms !== null && off.latenciaP50Ms ? on.latenciaP50Ms / off.latenciaP50Ms : null;
    comparacoes.push({
      modelo: m,
      deltaSucesso,
      razaoDeCusto,
      razaoDeLatencia,
      qualidade: deltaSucesso >= -MARGEM_DE_QUALIDADE,
      custo: razaoDeCusto !== null && razaoDeCusto <= 1,
      latencia: razaoDeLatencia !== null && razaoDeLatencia <= FATOR_DE_LATENCIA,
    });
  }
  const passaram = comparacoes.filter((c) => c.qualidade && c.custo && c.latencia).map((c) => c.modelo);
  if (insuficiente) return { comparacoes, veredito: 'amostra_insuficiente', passaram };
  if (passaram.length === comparacoes.length) return { comparacoes, veredito: 'manter_ligado', passaram };
  if (passaram.length === 0 || comparacoes.every((c) => !c.qualidade)) return { comparacoes, veredito: 'desligar', passaram };
  return { comparacoes, veredito: 'restringir', passaram };
}

export interface PrecoPorMilhao {
  entrada: number;
  saida: number;
}

export interface Estimativa {
  porExecucaoUsd: number;
  totalUsd: number;
  chamadas: number;
}

/**
 * Antes de gastar: o custo de uma execução com `passos` passos, se a primeira
 * chamada lê `base` tokens e cada passo acrescenta `crescimento` tokens ao
 * histórico, com `saida` tokens de saída por passo, mais o Jev por passo no
 * braço ligado (US$ 0,0000727, o medido na AT-237). Sem cache (teto, não piso).
 */
export const CUSTO_DO_JEV_POR_PASSO_USD = 0.0000727;

export function estimar(a: {
  base: number;
  crescimento: number;
  saida: number;
  passos: number;
  preco: PrecoPorMilhao;
  execucoesPorBraco: number;
}): Estimativa {
  let porExecucao = 0;
  for (let k = 0; k < a.passos; k++) {
    porExecucao += ((a.base + k * a.crescimento) * a.preco.entrada + a.saida * a.preco.saida) / 1e6;
  }
  const ligado = porExecucao + a.passos * CUSTO_DO_JEV_POR_PASSO_USD;
  return {
    porExecucaoUsd: (porExecucao + ligado) / 2,
    totalUsd: a.execucoesPorBraco * (porExecucao + ligado),
    chamadas: a.execucoesPorBraco * a.passos * 3,
  };
}

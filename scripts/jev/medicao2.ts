/**
 * As contas da segunda rodada (AT-237): acerto sob a régua estrita e sob as
 * camadas de equivalência, top-1 e top-k, curva acerto × limiar, cascata de
 * degraus e o gap por agente e por par (rótulo → escolha). Função pura sobre
 * `Linha`, que junta a resposta do Jev ao que o passo de fato fez.
 */
import { acertoDoPasso, TODAS_AS_CAMADAS, type Camada, type ChamadaClassificada } from './equivalencia.ts';
import { wilson, type Taxa } from './medicao.ts';
import { RESPONDER_SEM_FERRAMENTA } from './passos.ts';
import type { Metade } from './divisao.ts';

export interface Linha {
  id: string;
  ator: string;
  metade: Metade;
  /** O passo não existia na 1ª rodada (validação extra, segundo o pedido do dono). */
  novo: boolean;
  chamadas: ChamadaClassificada[];
  status: string;
  escolha: string | null;
  confianca: number | null;
  probabilidades: Record<string, number> | null;
  suspeitas: string[];
  tokensDeEntrada: number | null;
  latenciaMs: number;
  custoUsd: number | null;
  /** A última ferramenta chamada antes deste passo na MESMA execução (a linha de base grátis). */
  anterior: string | null;
}

export const ESTRITA: readonly Camada[] = [];
export const rotulosDe = (l: Linha): string[] => [...new Set(l.chamadas.map((c) => c.ferramenta))];

export function taxaDe(ls: readonly Linha[], ok: (l: Linha) => boolean): Taxa {
  const acertos = ls.filter(ok).length;
  return { n: ls.length, acertos, ic: wilson(acertos, ls.length) };
}

export const acerto1 = (camadas: readonly Camada[]) => (l: Linha) => acertoDoPasso(l.escolha, l.chamadas, camadas);

/** As ferramentas em ordem de probabilidade (sem a opção reservada); a escolha vem primeiro se não há probabilidades. */
export function ranking(l: Linha): string[] {
  const p = l.probabilidades;
  const ordem = p && Object.keys(p).length ? Object.entries(p).sort((a, b) => b[1] - a[1]).map(([k]) => k) : l.escolha ? [l.escolha] : [];
  return ordem.filter((k) => k !== RESPONDER_SEM_FERRAMENTA);
}

/** Top-k: o passo tem ferramenta e alguma das k mais prováveis serve; sem ferramenta: como no top-1. */
export const acertoK = (k: number, camadas: readonly Camada[]) => (l: Linha) => {
  if (l.chamadas.length === 0) return acertoDoPasso(l.escolha, l.chamadas, camadas);
  return ranking(l)
    .slice(0, k)
    .some((f) => acertoDoPasso(f, l.chamadas, camadas));
};

/** Linha de base sem Jev: oferecer só a ferramenta que o agente usou por último. */
export const acertoAnterior = (camadas: readonly Camada[]) => (l: Linha) =>
  l.anterior !== null && acertoDoPasso(l.anterior, l.chamadas, camadas);

/** Menu de DOIS sem segunda chamada: a escolha do Jev + a ferramenta anterior (união, sem parâmetro a ajustar). */
export const acertoUniao = (camadas: readonly Camada[]) => (l: Linha) =>
  acertoDoPasso(l.escolha, l.chamadas, camadas) || acertoAnterior(camadas)(l);

export const respondidas = (ls: readonly Linha[]): Linha[] => ls.filter((l) => l.status === 'ok');
export const comFerramenta = (ls: readonly Linha[]): Linha[] => ls.filter((l) => l.chamadas.length > 0);

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
export const fmt = (t: Taxa): string => (t.n === 0 ? '—' : `${t.acertos}/${t.n} = ${pct(t.acertos / t.n)} (${pct(t.ic[0])}–${pct(t.ic[1])})`);

/** Curva: com confiança ≥ limiar e uma ferramenta escolhida o menu vira uma; o acerto é entre os restritos. */
export function curvaPorLimiar(
  ls: readonly Linha[],
  camadas: readonly Camada[],
  limiares: readonly number[] = [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
): { limiar: number; restritos: number; acerto: Taxa; total: number }[] {
  const base = comFerramenta(respondidas(ls));
  return limiares.map((limiar) => {
    const r = base.filter((l) => l.escolha !== RESPONDER_SEM_FERRAMENTA && (l.confianca ?? 0) >= limiar);
    return { limiar, restritos: r.length, acerto: taxaDe(r, acerto1(camadas)), total: base.length };
  });
}

export interface LinhaPorAgente {
  ator: string;
  n: number;
  estrita: Taxa;
  equivalencia: Taxa;
  top2: Taxa;
}

export function porAgente(ls: readonly Linha[]): LinhaPorAgente[] {
  const c = comFerramenta(respondidas(ls));
  return [...new Set(c.map((l) => l.ator))].sort().map((ator) => {
    const doAtor = c.filter((l) => l.ator === ator);
    return {
      ator,
      n: doAtor.length,
      estrita: taxaDe(doAtor, acerto1(ESTRITA)),
      equivalencia: taxaDe(doAtor, acerto1(TODAS_AS_CAMADAS)),
      top2: taxaDe(doAtor, acertoK(2, TODAS_AS_CAMADAS)),
    };
  });
}

/** Erros sob a régua por equivalência, contados por par (rótulo → escolha). */
export function pares(ls: readonly Linha[], camadas: readonly Camada[] = TODAS_AS_CAMADAS): { par: string; n: number }[] {
  const cont = new Map<string, number>();
  for (const l of respondidas(ls)) {
    if (acerto1(camadas)(l)) continue;
    const rotulo = l.chamadas.length === 0 ? RESPONDER_SEM_FERRAMENTA : rotulosDe(l).join('+');
    const k = `${rotulo} → ${l.escolha}`;
    cont.set(k, (cont.get(k) ?? 0) + 1);
  }
  return [...cont.entries()].map(([par, n]) => ({ par, n })).sort((a, b) => b.n - a.n);
}

export interface Degrau {
  nome: string;
  linhas: readonly Linha[];
  camadas: readonly Camada[];
}

/** A cascata: cada degrau é (variante de state, régua) sobre os MESMOS passos. */
export function cascata(degraus: readonly Degrau[]): string {
  const out = ['| degrau | n | top-1 (IC 95%) | top-2 (IC 95%) |', '|---|---|---|---|'];
  for (const d of degraus) {
    const c = comFerramenta(respondidas(d.linhas));
    out.push(`| ${d.nome} | ${c.length} | ${fmt(taxaDe(c, acerto1(d.camadas)))} | ${fmt(taxaDe(c, acertoK(2, d.camadas)))} |`);
  }
  return out.join('\n');
}

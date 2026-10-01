/**
 * Divisão em tuning × validação (AT-237, segunda rodada), POR SESSÃO/TAREFA —
 * nunca por passo: passos seguidos da mesma tarefa compartilham pedido, arquivos
 * e resultados, e sortear passo vazaria o assunto da tarefa para os dois lados.
 *
 * O grupo é a EXECUÇÃO do laço (tarefa do dev agent, uma rodada de gate) ou, nos
 * conversacionais, a sessão inteira do agente. Os grupos são ordenados por um
 * hash do próprio nome (`sha1`, sal fixo) e atribuídos, um a um, à metade que
 * tem MENOS passos até ali — determinístico, independente de qualquer resultado
 * de acerto, e sem uma metade minúscula. Quem decide a metade nunca viu uma
 * escolha do Jev.
 */
import { createHash } from 'node:crypto';
import type { Passo, Evento } from './passos.ts';
import { FERRAMENTAS_DE_FIM_DA_DIVISAO, inicioDaExecucao } from './variantes.ts';

export type Metade = 'tuning' | 'validacao';
export const SAL = 'jev-v2';

export function chaveDoGrupo(eventos: readonly Evento[], passos: readonly Passo[], p: Passo): string {
  return `${p.sessao}|${p.ator}|${inicioDaExecucao(eventos, passos, p, FERRAMENTAS_DE_FIM_DA_DIVISAO)}`;
}

const hash = (s: string): string => createHash('sha1').update(`${SAL}:${s}`).digest('hex');

export function dividir(eventos: readonly Evento[], passos: readonly Passo[]): { metade: Map<string, Metade>; grupos: Map<string, number> } {
  const grupos = new Map<string, number>();
  const chaveDoPasso = new Map<string, string>();
  for (const p of passos) {
    const k = chaveDoGrupo(eventos, passos, p);
    chaveDoPasso.set(p.id, k);
    grupos.set(k, (grupos.get(k) ?? 0) + 1);
  }
  const ordem = [...grupos.keys()].sort((a, b) => (hash(a) < hash(b) ? -1 : 1));
  const total = { tuning: 0, validacao: 0 };
  const doGrupo = new Map<string, Metade>();
  for (const k of ordem) {
    const m: Metade = total.tuning <= total.validacao ? 'tuning' : 'validacao';
    doGrupo.set(k, m);
    total[m] += grupos.get(k)!;
  }
  const metade = new Map<string, Metade>();
  for (const p of passos) metade.set(p.id, doGrupo.get(chaveDoPasso.get(p.id)!)!);
  return { metade, grupos };
}

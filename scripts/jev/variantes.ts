/**
 * As variantes de `state` da segunda rodada (AT-237). Cada uma é um conjunto de
 * ligas sobre a MESMA função, e cada liga tem UMA linha dizendo de onde o
 * engine tiraria o dado ANTES do passo. Nada do passo-alvo entra: nem a
 * ferramenta escolhida, nem o argumento, nem o resultado, nem o texto que o
 * modelo escreveu naquele passo (`Passo.texto` só é lido dos passos ANTERIORES).
 *
 * Fonte no produto (`ToolLoop.Default.loop/1`, `apps/engine/lib/engine/harness/tool_loop.ex`):
 *   - `kickoff`: `ctx.messages[0]`, a mensagem inicial do laço (`initial_message/2` de cada agente);
 *   - `resultado` completo: a mensagem `role: tool` que o próprio laço anexa
 *     (`concluir_despacho/5`, tool_loop.ex) — o event log a corta em 2 000;
 *   - `texto`: a mensagem `assistant` que o laço anexa a cada iteração (`content`);
 *   - `progresso`: contagens sobre as chamadas do próprio `ctx.messages`;
 *   - `escopo` de execução: `ctx.messages` recomeça a cada `ToolLoop.run` — os
 *     passos de uma tarefa anterior do mesmo agente NÃO estão no contexto.
 */
import type { Dados, Historia, Modulo, Tarefa } from './dados.ts';
import { classificarChamada } from './equivalencia.ts';
import { kickoffDaQaAutomacao, kickoffDaQaEstrategia, kickoffDoAppsec, kickoffDoDev } from './kickoff.ts';
import {
  CORTE_DO_CONTEXTO,
  cortar,
  identidadeDoAtor,
  pedidoDoPasso,
  type Catalogo,
  type Chamada,
  type Evento,
  type Passo,
} from './passos.ts';

export interface Variante {
  nome: string;
  /** `pedido` = a mensagem inicial do laço, reconstruída do código do engine. */
  kickoff: boolean;
  /** Teto de caracteres do resultado (e do argumento) de cada chamada recente. */
  corte: number;
  recentes: number;
  /** Só os passos da execução corrente (a que começou no último kickoff). */
  escopo: boolean;
  /** O texto que o modelo escreveu nos passos ANTERIORES. */
  texto: boolean;
  /** Contagens derivadas das chamadas anteriores da execução. */
  progresso: boolean;
  /** A sequência de ferramentas da execução INTEIRA (só os nomes, sem resultados) — o padrão que o recorte de 6 chamadas esconde. */
  trilha: boolean;
  /** O resultado dos comandos que esperaram aprovação, reconstruído do desfecho da ação (o log não tem `tool.result` deles). */
  acoes: boolean;
  /** A pergunta que descreve o comportamento em rajadas dos agentes de execução. */
  fluxo: boolean;
}

const base: Variante = { nome: 'original', kickoff: false, corte: 500, recentes: 6, escopo: false, texto: false, progresso: false, trilha: false, fluxo: false, acoes: false };

/**
 * A ordem é a da cascata: cada uma acrescenta UMA peça à anterior. Escritas
 * antes de rodar; as que falharem entram na tabela do mesmo jeito.
 */
export const VARIANTES: Record<string, Variante> = {
  original: base,
  kickoff: { ...base, nome: 'kickoff', kickoff: true },
  escopo: { ...base, nome: 'escopo', kickoff: true, escopo: true },
  resultados: { ...base, nome: 'resultados', kickoff: true, escopo: true, corte: 2000 },
  texto: { ...base, nome: 'texto', kickoff: true, escopo: true, corte: 2000, texto: true },
  progresso: { ...base, nome: 'progresso', kickoff: true, escopo: true, corte: 2000, texto: true, progresso: true },
  // Variantes de tuning que saem da tentativa de subir o top-1 depois da cascata acima.
  trilha: { ...base, nome: 'trilha', kickoff: true, escopo: true, trilha: true },
  fluxo: { ...base, nome: 'fluxo', kickoff: true, escopo: true, trilha: true, fluxo: true },
  // Depois de ver, no tuning, que 'sem resultado gravado' era o resultado dos comandos aprovados à mão.
  acoes: { ...base, nome: 'acoes', kickoff: true, escopo: true, acoes: true },
  acoes_completo: { ...base, nome: 'acoes_completo', kickoff: true, escopo: true, acoes: true, corte: 2000, texto: true, progresso: true },
  enxuto: { ...base, nome: 'enxuto', kickoff: true, escopo: true, trilha: true, recentes: 2 },
  so_trilha: { ...base, nome: 'so_trilha', kickoff: true, escopo: true, trilha: true, recentes: 0 },
};

/** Ferramentas que ENCERRAM o laço (halt) — a execução seguinte recomeça do kickoff. */
export const FERRAMENTAS_DE_FIM_DA_DIVISAO: ReadonlySet<string> = new Set([
  'report_done',
  'report_blocked',
  'emit_qa_verdict',
  'emit_perf_seguranca_verdict',
  'emit_plano_de_teste',
  'emit_threat_model',
  'emit_infra_delegation_result',
]);

/**
 * A lista COMPLETA, para montar o `state`. A da DIVISÃO (acima) é a de antes de
 * qualquer pedido ao Jev e FICA como estava: a Anamnese (`emit_proficiency`,
 * `skip_proficiency` também encerram o laço) foi acrescentada aqui depois de
 * as primeiras rodadas de tuning, e mexer na divisão então trocaria de metade
 * passos cuja acurácia já foi vista.
 */
export const FERRAMENTAS_DE_FIM: ReadonlySet<string> = new Set([...FERRAMENTAS_DE_FIM_DA_DIVISAO, 'emit_proficiency', 'skip_proficiency']);

const AGENTES_DE_LACO = /^(dev-(?!lead$)|qa-|appsec$|anamnese$|infra-workflows$)/;
export const ehAgenteDeLaco = (ator: string): boolean => AGENTES_DE_LACO.test(ator);

/** O instante em que a execução (o `ToolLoop.run`) do passo começou; `''` = desde o início da sessão. */
export function inicioDaExecucao(
  eventos: readonly Evento[],
  passos: readonly Passo[],
  p: Passo,
  fim: ReadonlySet<string> = FERRAMENTAS_DE_FIM,
): string {
  if (!ehAgenteDeLaco(p.ator)) return '';
  let inicio = '';
  const anteriores = passos.filter((q) => q.sessao === p.sessao && q.ator === p.ator && q.em < p.em);
  for (const q of anteriores) {
    if (q.chamadas.some((c) => fim.has(c.ferramenta))) inicio = q.chamadas.at(-1)!.em;
  }
  if (p.ator.startsWith('dev-')) {
    for (const e of eventos) {
      if (e.tipo === 'dev.working' && e.sessao === p.sessao && e.ator === p.ator && e.em <= p.em && e.em > inicio) inicio = e.em;
    }
  }
  return inicio;
}

/** Os passos anteriores da MESMA execução (ou da sessão inteira, sem `escopo`). */
export function passosAnteriores(eventos: readonly Evento[], passos: readonly Passo[], p: Passo, escopo: boolean): Passo[] {
  const inicio = escopo ? inicioDaExecucao(eventos, passos, p) : '';
  return passos.filter((q) => q.sessao === p.sessao && q.ator === p.ator && q.em < p.em && q.em >= inicio);
}

export interface Contexto {
  dados: Dados;
  eventos: readonly Evento[];
  passos: readonly Passo[];
  catalogo: Catalogo;
  instrucoes: ReadonlyMap<string, string>;
}

const porId = <T extends { id: string }>(xs: readonly T[], id: string | null | undefined): T | null => xs.find((x) => x.id === id) ?? null;

/** A tarefa que o laço do passo trabalha: `dev.working` (dev) ou o último `dev.awaiting_gate` (gate de QA). */
export function tarefaDoPasso(cx: Contexto, p: Passo): Tarefa | null {
  const antes = cx.eventos.filter((e) => e.sessao === p.sessao && e.em <= p.em);
  if (p.ator.startsWith('dev-') && p.ator !== 'dev-lead') {
    const w = antes.filter((e) => e.tipo === 'dev.working' && e.ator === p.ator).at(-1);
    return porId(cx.dados.tarefas, typeof w?.payload.taskId === 'string' ? w.payload.taskId : null);
  }
  if (p.ator.startsWith('qa-') && p.ator !== 'qa-estrategia') {
    const w = antes.filter((e) => e.tipo === 'dev.awaiting_gate').at(-1);
    return porId(cx.dados.tarefas, typeof w?.payload.taskId === 'string' ? w.payload.taskId : null);
  }
  return null;
}

export function kickoffDoPasso(cx: Contexto, p: Passo): string | null {
  const modulos: Modulo[] = cx.dados.modulos.find((m) => m.projetoId === p.projetoId)?.modulos ?? [];
  const tarefa = tarefaDoPasso(cx, p);
  const historia: Historia | null = porId(cx.dados.historias, tarefa?.storyId);
  if (p.ator.startsWith('dev-') && p.ator !== 'dev-lead') return tarefa ? kickoffDoDev(tarefa, historia) : null;
  if (p.ator === 'qa-automacao') return tarefa ? kickoffDaQaAutomacao(tarefa, historia) : null;
  if (p.ator === 'qa-estrategia') return kickoffDaQaEstrategia(tarefa, historia, { erro: 'a lista de arquivos da entrega não fica no event log' });
  if (p.ator === 'appsec') return kickoffDoAppsec(null, modulos);
  return null;
}

export interface EstadoV2 {
  agente: string;
  pedido: string;
  contexto: string;
  passos_recentes: { ferramenta: string | null; argumentos: string; resultado: string; texto_do_modelo?: string }[];
  progresso?: Record<string, unknown>;
  trilha?: (string | null)[];
}

const TESTE = /\b(vitest|jest|mocha|pytest|npm (run )?test|npx (vitest|jest)|yarn test|pnpm (run )?test)\b/;

function falhou(c: Chamada): boolean | null {
  if (c.resultado === null) return null;
  return c.ok === false || /^\s*(falhou|erro)\b/i.test(c.resultado) || /^exit [1-9]/.test(c.resultado);
}

/** Contagens sobre as chamadas anteriores da execução. Tudo derivável de `ctx.messages`. */
export function progressoDe(anteriores: readonly Passo[]): Record<string, unknown> {
  const chamadas = anteriores.flatMap((q) => q.chamadas);
  const porFerramenta: Record<string, number> = {};
  const terminal = { leitura: 0, gravacao: 0, execucao: 0 };
  let testes = 0;
  for (const c of chamadas) {
    porFerramenta[c.ferramenta] = (porFerramenta[c.ferramenta] ?? 0) + 1;
    const k = classificarChamada(c.ferramenta, c.argumentos);
    if (k.classe) terminal[k.classe]++;
    const cmd = (c.argumentos as { command?: unknown } | null)?.command;
    if (c.ferramenta === 'terminal' && typeof cmd === 'string' && TESTE.test(cmd)) testes++;
  }
  const ultima = chamadas.at(-1);
  return {
    passos_anteriores: anteriores.length,
    chamadas_por_ferramenta: porFerramenta,
    comandos_de_terminal: terminal,
    execucoes_de_teste: testes,
    arquivos_gravados: porFerramenta.write_file ?? 0,
    ultima_ferramenta: ultima?.ferramenta ?? null,
    ultima_chamada_falhou: ultima ? falhou(ultima) : null,
  };
}

function resultadoDe(c: Chamada, v: Variante): string {
  const r = c.resultado ?? (v.acoes ? (c.resultadoReconstruido ?? null) : null);
  return r === null ? '(sem resultado gravado)' : cortar(r, v.corte);
}

export function montarEstadoV2(cx: Contexto, p: Passo, v: Variante): EstadoV2 {
  const anteriores = passosAnteriores(cx.eventos, cx.passos, p, v.escopo);
  const kick = v.kickoff ? kickoffDoPasso(cx, p) : null;
  const instrucao = cx.instrucoes.get(`${p.projetoId}|${p.ator}`);
  const contexto = [identidadeDoAtor(cx.catalogo, p.ator), instrucao].filter(Boolean).join('\n\n');

  // Uma entrada por CHAMADA; o texto do passo vai na primeira dele. Passo só de texto vira entrada sem ferramenta.
  const entradas: EstadoV2['passos_recentes'] = [];
  for (const q of anteriores) {
    const texto = v.texto && q.texto ? cortar(q.texto, v.corte) : undefined;
    if (q.chamadas.length === 0) {
      if (texto) entradas.push({ ferramenta: null, argumentos: '', resultado: '', texto_do_modelo: texto });
      continue;
    }
    q.chamadas.forEach((c, i) => {
      const e: EstadoV2['passos_recentes'][number] = {
        ferramenta: c.ferramenta,
        argumentos: cortar(JSON.stringify(c.argumentos), v.corte),
        resultado: resultadoDe(c, v),
      };
      if (i === 0 && texto) e.texto_do_modelo = texto;
      entradas.push(e);
    });
  }
  const estado: EstadoV2 = {
    agente: p.ator,
    pedido: kick ?? pedidoDoPasso(cx.eventos, p),
    contexto: cortar(contexto, CORTE_DO_CONTEXTO),
    passos_recentes: v.recentes === 0 ? [] : entradas.slice(-v.recentes),
  };
  if (v.progresso) estado.progresso = progressoDe(anteriores);
  if (v.trilha) estado.trilha = anteriores.map((q) => (q.chamadas.length ? [...new Set(q.chamadas.map((c) => c.ferramenta))].join('+') : null));
  return estado;
}

/**
 * Os dados brutos do replay (AT-237, segunda rodada): eventos, linhas de uso,
 * instruções por projeto, tarefas, histórias e mapas de módulos. Só LEITURA do
 * banco. `replay.ts` (primeira rodada) e `analise.ts` (segunda) compartilham
 * isto; o cache em disco existe para iterar OFFLINE sobre a mesma fotografia
 * do banco (e portanto sobre o mesmo conjunto de passos).
 *
 * O cache tem texto de sessão e, por isso, mora fora do checkout — quem o
 * escolhe é `replay.ts`/`analise.ts`, que recusam destino dentro dele.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Acao, Evento, LinhaDeUso } from './passos.ts';

export interface Tarefa {
  id: string;
  storyId: string;
  title: string;
  description: string | null;
}

export interface Historia {
  id: string;
  title: string;
  description: string | null;
  rf: string[];
  rnf: string[];
  dod: string[];
}

export interface Modulo {
  name: string;
  stack?: string;
  responsibility?: string;
}

export interface Dados {
  eventos: Evento[];
  usos: LinhaDeUso[];
  instrucoes: { projetoId: string; ator: string; conteudo: string }[];
  tarefas: Tarefa[];
  historias: Historia[];
  /** A versão vigente (a maior) do mapa de módulos de cada projeto. */
  modulos: { projetoId: string; modulos: Modulo[] }[];
  /** O desfecho das ações propostas (`proposed_actions`), de onde sai o resultado dos comandos que esperaram aprovação. */
  acoes: Acao[];
}

const INSTANTE = `to_char(%s AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const em = (col: string) => INSTANTE.replace('%s', col);

export const TIPOS_LIDOS = ['tool.call', 'tool.result', 'chat.message', 'dev.working', 'agent.response', 'dev.awaiting_gate', 'proposed_action.created'] as const;

export function consultas(projeto?: string): Record<keyof Dados, string> {
  // O slug NUNCA entra no texto do SQL: é a variável `slug` do psql
  // (`-v slug=…` em `comandoPsql`), que `:'slug'` cita com segurança.
  const filtro = projeto ? `AND p.slug = :'slug'` : '';
  const tipos = TIPOS_LIDOS.map((t) => `'${t}'`).join(', ');
  return {
    eventos: `SELECT json_build_object('sessao', e.session_id, 'seq', e.seq, 'tipo', e.type,
  'atorTipo', e.actor_kind, 'ator', e.actor_id, 'em', ${em('e.created_at')},
  'projetoId', s.project_id, 'payload', e.payload)::text
FROM session_events e JOIN sessions s ON s.id = e.session_id JOIN projects p ON p.id = s.project_id
WHERE e.type IN (${tipos}) ${filtro}
ORDER BY e.session_id, e.seq`,
    usos: `SELECT json_build_object('sessao', t.session_id, 'ator', t.actor_id, 'em', ${em('t.created_at')})::text
FROM token_usage t JOIN sessions s ON s.id = t.session_id JOIN projects p ON p.id = s.project_id
WHERE t.actor_kind = 'agent' ${filtro}
ORDER BY t.created_at`,
    instrucoes: `SELECT json_build_object('projetoId', project_id, 'ator', agent, 'conteudo', content)::text
FROM agent_instructions`,
    tarefas: `SELECT json_build_object('id', id, 'storyId', story_id, 'title', title, 'description', description)::text FROM tasks`,
    historias: `SELECT json_build_object('id', id, 'title', title, 'description', description,
  'rf', COALESCE(rf, '[]'::jsonb), 'rnf', COALESCE(rnf, '[]'::jsonb), 'dod', COALESCE(dod, '[]'::jsonb))::text FROM stories`,
    modulos: `SELECT json_build_object('projetoId', m.project_id, 'modulos', m.modules)::text
FROM module_maps m WHERE m.version = (SELECT max(version) FROM module_maps x WHERE x.project_id = m.project_id)`,
    acoes: `SELECT json_build_object('id', id, 'status', status, 'execution_result', execution_result, 'rejection_reason', rejection_reason)::text
FROM proposed_actions WHERE action_type IN ('terminal', 'write_file')`,
  };
}

export interface Fonte {
  container?: string;
  usuario: string;
  banco: string;
  databaseUrl?: string;
  projeto?: string;
}

/**
 * O SQL vai pelo STDIN (`-f -`), porque o psql não interpola variáveis em `-c`;
 * o projeto vai como variável (`-v slug=…`), nunca montado no texto.
 */
export function comandoPsql(o: Fonte): [string, string[]] {
  const psql = ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', ...(o.projeto ? ['-v', `slug=${o.projeto}`] : []), '-f', '-'];
  if (o.container) return ['docker', ['exec', '-i', o.container, 'psql', '-U', o.usuario, '-d', o.banco, ...psql]];
  return ['psql', [o.databaseUrl!, ...psql]];
}

function linhas<T>(o: Fonte, sql: string): T[] {
  const [bin, args] = comandoPsql(o);
  return execFileSync(bin, args, { input: sql, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as T);
}

export function lerDoBanco(o: Fonte): Dados {
  const q = consultas(o.projeto);
  return {
    eventos: linhas<Evento>(o, q.eventos),
    usos: linhas<LinhaDeUso>(o, q.usos),
    instrucoes: linhas(o, q.instrucoes),
    tarefas: linhas(o, q.tarefas),
    historias: linhas(o, q.historias),
    modulos: linhas(o, q.modulos),
    acoes: linhas(o, q.acoes),
  };
}

/** Lê o cache se existir; senão pergunta ao banco e o grava (modo 600). */
export function carregar(o: Fonte, cache?: string, refazer = false): Dados {
  if (cache && !refazer && existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8')) as Dados;
  const d = lerDoBanco(o);
  if (cache) writeFileSync(cache, JSON.stringify(d), { mode: 0o600 });
  return d;
}

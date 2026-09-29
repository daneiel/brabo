/**
 * `pnpm --filter @brabo/scripts idioma:extrair -- --container <postgres>` —
 * extrai do event log LOCAL as mensagens que o USUÁRIO escreveu, para o corpus
 * real da AT-160, num arquivo FORA do git.
 *
 *   --container <nome>      roda `psql` DENTRO desse container (`docker exec`);
 *                           é o caminho normal: a máquina não precisa ter psql
 *   --usuario <u> --banco <b>   credenciais do psql no container (padrão: brabo/brabo,
 *                           os defaults do compose)
 *   --database-url <url>    alternativa: `psql <url>` do host
 *   --saida <arquivo>       padrão: $XDG_CACHE_HOME/brabo/corpus-idioma/mensagens.jsonl
 *
 * SÓ LÊ: um `SELECT` sobre `session_events`, nada mais — nenhuma escrita,
 * nenhuma migration. O que entra na evidência segue a limpeza da AT-080:
 *   - só evento de ator `user` (item 6: mensagem de agente e de sistema nunca
 *     é evidência — a resposta do agente em espanhol NÃO realimenta o erro);
 *   - no formulário estruturado, só as RESPOSTAS (item 5): o
 *     `chat.structured_question_answered` vira um item com os valores, e o
 *     `chat.message` concatenado que a api grava logo depois
 *     (`"N. {label}: {resposta}"`, com o `label` escrito pelo AGENTE) é pulado.
 *
 * Rodar de novo é seguro: itens já no arquivo mantêm o rótulo, os novos entram
 * sem rótulo.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { corpusRealPadrao, dentroDoRepositorio, escreverCorpus, lerCorpus, type ItemDoCorpus } from './corpus.ts';

export const CONSULTA = `SELECT json_build_object(
  'sessao', session_id, 'seq', seq, 'tipo', type, 'ator', actor_id,
  'em', created_at, 'payload', payload
)::text
FROM session_events
WHERE actor_kind = 'user'
  AND type IN ('chat.message', 'chat.structured_question_answered')
ORDER BY session_id, seq`;

export interface Evento {
  sessao: string;
  seq: number;
  tipo: string;
  ator: string;
  em: string;
  payload: { text?: unknown; answers?: unknown };
}

/** Começo do texto que `AnswerStructuredQuestionUseCase` monta: `1. {label}: `. */
const TEXTO_DO_FORMULARIO = /^1\. [^\n]*: /;

export function montarItens(eventos: readonly Evento[]): ItemDoCorpus[] {
  const itens: ItemDoCorpus[] = [];
  // Por sessão+autor: o próximo chat.message é o eco do formulário?
  const ecoPendente = new Set<string>();
  for (const e of eventos) {
    const chave = `${e.sessao}\u0000${e.ator}`;
    if (e.tipo === 'chat.structured_question_answered') {
      const respostas =
        e.payload.answers && typeof e.payload.answers === 'object'
          ? Object.values(e.payload.answers as Record<string, unknown>).filter((v): v is string => typeof v === 'string')
          : [];
      ecoPendente.add(chave);
      if (respostas.length) {
        itens.push(item(e, respostas.join('\n'), 'formulario'));
      }
      continue;
    }
    const texto = typeof e.payload.text === 'string' ? e.payload.text : '';
    if (ecoPendente.has(chave)) {
      ecoPendente.delete(chave);
      if (TEXTO_DO_FORMULARIO.test(texto)) continue;
    }
    if (texto.trim() === '') continue;
    itens.push(item(e, texto, 'chat'));
  }
  return itens;
}

function item(e: Evento, texto: string, caso: string): ItemDoCorpus {
  return { id: `${e.sessao}:${e.seq}`, idioma: null, texto, caso, origem: 'real', grupo: e.ator, em: e.em };
}

/** Novos itens entram sem rótulo; os que já existem mantêm o que o dono rotulou. */
export function mesclar(existentes: readonly ItemDoCorpus[], novos: readonly ItemDoCorpus[]): ItemDoCorpus[] {
  const porId = new Map(existentes.map((i) => [i.id, i]));
  const saida = [...existentes];
  for (const n of novos) if (!porId.has(n.id)) saida.push(n);
  return saida;
}

export interface Opcoes {
  container?: string;
  usuario: string;
  banco: string;
  databaseUrl?: string;
  saida: string;
}

export function lerOpcoes(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): Opcoes {
  const o: Opcoes = { usuario: 'brabo', banco: 'brabo', saida: corpusRealPadrao(env) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue; // `pnpm run x -- --flag` repassa o `--`
    const v = (): string => {
      const valor = argv[++i];
      if (!valor) throw new Error(`${a} precisa de um valor`);
      return valor;
    };
    if (a === '--container') o.container = v();
    else if (a === '--usuario') o.usuario = v();
    else if (a === '--banco') o.banco = v();
    else if (a === '--database-url') o.databaseUrl = v();
    else if (a === '--saida') o.saida = v();
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  if (!o.container === !o.databaseUrl) {
    throw new Error('diga de onde ler: --container <nome> OU --database-url <url> (um dos dois)');
  }
  if (dentroDoRepositorio(o.saida)) {
    throw new Error(`recusado: --saida ${o.saida} fica dentro do repositório; o corpus real mora fora do git`);
  }
  return o;
}

/** O comando `psql` que a extração roda — só leitura, uma consulta. */
export function comandoPsql(o: Opcoes): [string, string[]] {
  const psql = ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', CONSULTA];
  if (o.container) return ['docker', ['exec', '-i', o.container, 'psql', '-U', o.usuario, '-d', o.banco, ...psql]];
  return ['psql', [o.databaseUrl!, ...psql]];
}

function principal(): void {
  let o: Opcoes;
  try {
    o = lerOpcoes(process.argv.slice(2));
  } catch (erro) {
    console.error((erro as Error).message);
    process.exit(2);
  }
  const [bin, args] = comandoPsql(o);
  const saida = execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  const eventos = saida
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Evento);
  const novos = montarItens(eventos);
  const existentes = existsSync(o.saida) ? lerCorpus(o.saida) : [];
  const todos = mesclar(existentes, novos);
  escreverCorpus(o.saida, todos);
  const semRotulo = todos.filter((i) => !i.idioma).length;
  console.error(
    `${eventos.length} eventos de usuário lidos, ${novos.length} mensagens, ` +
      `${todos.length - existentes.length} novas. Corpus: ${o.saida} (${todos.length} itens, ${semRotulo} sem rótulo).\n` +
      `Rotule com: pnpm --filter @brabo/scripts idioma:rotular -- --padrao pt-BR`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) principal();

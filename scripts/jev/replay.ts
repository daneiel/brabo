/**
 * `pnpm --filter @brabo/scripts jev:replay -- --container brabo-dev-postgres-1` —
 * reproduz, FORA do produto, a pergunta que o roteador da AT-235 faria ao Jev
 * em cada passo já gravado no event log LOCAL, e mede o acerto (AT-237).
 *
 *   --container <nome>        roda `psql` dentro desse container (padrão de dev)
 *   --usuario/--banco         credenciais do psql (padrão brabo/brabo, os do compose)
 *   --database-url <url>      alternativa: `psql <url>` do host
 *   --projeto <slug>          só as sessões desse projeto
 *   --limite <n>              no máximo n passos (os mais antigos primeiro)
 *   --teto-usd <x>            para ANTES de passar desse gasto (padrão 2.00)
 *   --timeout-ms <n>          teto de CADA pedido (padrão 10000; o do produto
 *                             seria 2000, e medir acima dele é o que diz a cauda)
 *   --arquivo-de-chave <arq>  lê OPENROUTER_TEST_KEY de um arquivo KEY=valor
 *                             (senão, da variável de ambiente)
 *   --saida <arq>             padrão $XDG_CACHE_HOME/brabo/replay-jev/respostas.jsonl
 *   --estimar                 só conta passos e estima o custo; não chama a rede
 *   --so-relatorio            não chama a rede; imprime o relatório da --saida
 *   --conferir-custo          soma o `total_cost` de `GET /api/v1/generation` de
 *                             cada resposta da --saida (a cobrança, não o que a
 *                             resposta declarou) e compara com o `usage.cost`
 *
 * SÓ LÊ o banco: três `SELECT`. A saída tem texto de sessão (o `state` não vai
 * junto, mas o id sim) e por isso mora FORA do checkout — o script recusa
 * destino dentro dele. O relatório impresso tem só contagens. Rodar de novo
 * RETOMA: passo já respondido na --saida não é perguntado outra vez.
 *
 * A chave NUNCA é impressa, logada nem gravada.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENDPOINT_DO_JEV, lerResposta, montarPedido } from './jev.ts';
import { relatorio, type Registro } from './medicao.ts';
import { catalogoDoAtor, montarEstado, montarPassos, type Catalogo, type Evento, type LinhaDeUso, type Passo } from './passos.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');

/** Preço de entrada do Jev 1.13 MEDIDO (367 tokens → US$ 0,000015414); só para ESTIMAR. */
export const USD_POR_MILHAO_DE_ENTRADA = 0.042;

const INSTANTE = `to_char(%s AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const em = (col: string) => INSTANTE.replace('%s', col);

export function consultas(projeto?: string): { eventos: string; usos: string; instrucoes: string } {
  // O slug NUNCA entra no texto do SQL: é a variável `slug` do psql
  // (`-v slug=…` em `comandoPsql`), que `:'slug'` cita com segurança.
  const filtro = projeto ? `AND p.slug = :'slug'` : '';
  return {
    eventos: `SELECT json_build_object('sessao', e.session_id, 'seq', e.seq, 'tipo', e.type,
  'atorTipo', e.actor_kind, 'ator', e.actor_id, 'em', ${em('e.created_at')},
  'projetoId', s.project_id, 'payload', e.payload)::text
FROM session_events e JOIN sessions s ON s.id = e.session_id JOIN projects p ON p.id = s.project_id
WHERE e.type IN ('tool.call', 'tool.result', 'chat.message', 'dev.working') ${filtro}
ORDER BY e.session_id, e.seq`,
    usos: `SELECT json_build_object('sessao', t.session_id, 'ator', t.actor_id, 'em', ${em('t.created_at')})::text
FROM token_usage t JOIN sessions s ON s.id = t.session_id JOIN projects p ON p.id = s.project_id
WHERE t.actor_kind = 'agent' ${filtro}
ORDER BY t.created_at`,
    instrucoes: `SELECT json_build_object('projetoId', project_id, 'ator', agent, 'conteudo', content)::text
FROM agent_instructions`,
  };
}

export interface Opcoes {
  container?: string;
  usuario: string;
  banco: string;
  databaseUrl?: string;
  projeto?: string;
  limite?: number;
  tetoUsd: number;
  timeoutMs: number;
  arquivoDeChave?: string;
  saida: string;
  estimar: boolean;
  soRelatorio: boolean;
  conferirCusto: boolean;
}

export function saidaPadrao(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : join(homedir(), '.cache');
  return join(base, 'brabo', 'replay-jev', 'respostas.jsonl');
}

export function dentroDoRepositorio(caminho: string, raiz = RAIZ): boolean {
  const rel = relative(raiz, resolve(caminho));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function lerOpcoes(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): Opcoes {
  const o: Opcoes = { usuario: 'brabo', banco: 'brabo', tetoUsd: 2, timeoutMs: 10_000, saida: saidaPadrao(env), estimar: false, soRelatorio: false, conferirCusto: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    const v = (): string => {
      const valor = argv[++i];
      if (!valor) throw new Error(`${a} precisa de um valor`);
      return valor;
    };
    const num = (): number => {
      const n = Number(v());
      if (!Number.isFinite(n) || n <= 0) throw new Error(`${a} precisa de um número positivo`);
      return n;
    };
    if (a === '--container') o.container = v();
    else if (a === '--usuario') o.usuario = v();
    else if (a === '--banco') o.banco = v();
    else if (a === '--database-url') o.databaseUrl = v();
    else if (a === '--projeto') o.projeto = v();
    else if (a === '--limite') o.limite = num();
    else if (a === '--teto-usd') o.tetoUsd = num();
    else if (a === '--timeout-ms') o.timeoutMs = num();
    else if (a === '--arquivo-de-chave') o.arquivoDeChave = v();
    else if (a === '--saida') o.saida = v();
    else if (a === '--estimar') o.estimar = true;
    else if (a === '--so-relatorio') o.soRelatorio = true;
    else if (a === '--conferir-custo') o.conferirCusto = true;
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  if (!o.soRelatorio && !o.conferirCusto && !o.container === !o.databaseUrl) {
    throw new Error('diga de onde ler: --container <nome> OU --database-url <url> (um dos dois)');
  }
  if (dentroDoRepositorio(o.saida)) {
    throw new Error(`recusado: --saida ${o.saida} fica dentro do repositório; a saída tem ids de sessão e mora fora do git`);
  }
  return o;
}

/**
 * O SQL vai pelo STDIN (`-f -`), porque o psql não interpola variáveis em `-c`;
 * o projeto vai como variável (`-v slug=…`), nunca montado no texto.
 */
export function comandoPsql(o: Opcoes): [string, string[]] {
  const psql = ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', ...(o.projeto ? ['-v', `slug=${o.projeto}`] : []), '-f', '-'];
  if (o.container) return ['docker', ['exec', '-i', o.container, 'psql', '-U', o.usuario, '-d', o.banco, ...psql]];
  return ['psql', [o.databaseUrl!, ...psql]];
}

/** A chave, lida de um arquivo `KEY=valor` ou do ambiente. Nunca sai daqui para a saída. */
export function lerChave(o: Opcoes, env: NodeJS.ProcessEnv = process.env): string {
  if (o.arquivoDeChave) {
    for (const linha of readFileSync(o.arquivoDeChave, 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?OPENROUTER_TEST_KEY\s*=\s*(.*)$/.exec(linha);
      if (m) return m[1]!.trim().replace(/^(['"])(.*)\1$/, '$2');
    }
    throw new Error(`${o.arquivoDeChave} não define OPENROUTER_TEST_KEY`);
  }
  const k = env.OPENROUTER_TEST_KEY;
  if (!k) throw new Error('OPENROUTER_TEST_KEY ausente (ambiente ou --arquivo-de-chave)');
  return k;
}

/** Estimativa grosseira de tokens: ~4 caracteres por token. Só para o teto de gasto. */
export function estimarTokens(corpo: unknown): number {
  return Math.ceil(JSON.stringify(corpo).length / 4);
}

function linhas<T>(o: Opcoes, sql: string): T[] {
  const [bin, args] = comandoPsql(o);
  return execFileSync(bin, args, { input: sql, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as T);
}

function lerSaida(caminho: string): Registro[] {
  if (!existsSync(caminho)) return [];
  return readFileSync(caminho, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Registro);
}

/** A última ferramenta do passo ANTERIOR com ferramenta, do mesmo ator e sessão. */
export function ferramentaAnterior(passos: readonly Passo[], p: Passo): string | null {
  const antes = passos.filter((q) => q.sessao === p.sessao && q.ator === p.ator && q.em < p.em && q.chamadas.length > 0);
  return antes.at(-1)?.chamadas.at(-1)?.ferramenta ?? null;
}

async function uso(chave: string): Promise<number | null> {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(15_000) });
    const j = (await r.json()) as { data?: { usage?: unknown } };
    return typeof j.data?.usage === 'number' ? j.data.usage : null;
  } catch {
    return null;
  }
}

/** Soma a cobrança registrada pelo OpenRouter para cada geração da saída. */
async function conferirCusto(chave: string, rs: readonly Registro[]): Promise<void> {
  let declarado = 0;
  let cobrado = 0;
  let conferidas = 0;
  let semRegistro = 0;
  for (const r of rs) {
    if (!r.geracao) continue;
    declarado += r.custoUsd ?? 0;
    try {
      const resp = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(r.geracao)}`, {
        headers: { Authorization: `Bearer ${chave}` },
        signal: AbortSignal.timeout(15_000),
      });
      const j = (await resp.json()) as { data?: { total_cost?: unknown } };
      if (typeof j.data?.total_cost === 'number') {
        cobrado += j.data.total_cost;
        conferidas++;
      } else semRegistro++;
    } catch {
      semRegistro++;
    }
  }
  console.log(
    `gerações conferidas: ${conferidas} (${semRegistro} sem registro); usage.cost declarado US$ ${declarado.toFixed(6)}; ` +
      `total_cost cobrado US$ ${cobrado.toFixed(6)}; razão ${declarado > 0 ? (cobrado / declarado).toFixed(3) : '—'}.`,
  );
}

async function principal(): Promise<void> {
  let o: Opcoes;
  try {
    o = lerOpcoes(process.argv.slice(2));
  } catch (erro) {
    console.error((erro as Error).message);
    process.exit(2);
  }
  if (o.soRelatorio) {
    console.log(relatorio(lerSaida(o.saida)));
    return;
  }
  if (o.conferirCusto) {
    await conferirCusto(lerChave(o), lerSaida(o.saida));
    return;
  }
  const catalogo = JSON.parse(readFileSync(join(AQUI, 'catalogo.json'), 'utf8')) as Catalogo;
  const q = consultas(o.projeto);
  const eventos = linhas<Evento>(o, q.eventos);
  const usos = linhas<LinhaDeUso>(o, q.usos);
  const instrucoes = new Map(
    linhas<{ projetoId: string; ator: string; conteudo: string }>(o, q.instrucoes).map((i) => [`${i.projetoId}|${i.ator}`, i.conteudo]),
  );
  const { passos, semFronteira, foraDoCatalogo } = montarPassos(eventos, usos, catalogo);
  // Catálogo de uma ferramenta só nunca seria roteado (condição c da AT-235).
  const elegiveis = passos.filter((p) => (catalogoDoAtor(catalogo, p.ator)?.length ?? 0) >= 2);
  const alvo = o.limite ? elegiveis.slice(0, o.limite) : elegiveis;
  const pedidos = alvo.map((p) => {
    const ferramentas = catalogoDoAtor(catalogo, p.ator)!;
    return { p, ferramentas, corpo: montarPedido(montarEstado(eventos, passos, p, catalogo, instrucoes), ferramentas, catalogo) };
  });
  const tokens = pedidos.reduce((s, x) => s + estimarTokens(x.corpo), 0);
  const sessoes = new Set(alvo.map((p) => p.sessao));
  const chamadas = eventos.filter((e) => e.tipo === 'tool.call').length;
  console.error(
    `recorte: ${sessoes.size} sessões, ${eventos.length} eventos lidos (${chamadas} tool.call), ${usos.length} linhas de token_usage; ` +
      `${passos.length} passos de agentes medidos, ${elegiveis.length} com catálogo ≥ 2, ${alvo.length} no alvo; ` +
      `${semFronteira} tool.call sem fronteira de passo, ${foraDoCatalogo} fora do catálogo. ` +
      `Estimativa: ~${tokens} tokens ≈ US$ ${((tokens * USD_POR_MILHAO_DE_ENTRADA) / 1e6).toFixed(4)}.`,
  );
  if (o.estimar) return;

  const chave = lerChave(o);
  mkdirSync(dirname(o.saida), { recursive: true, mode: 0o700 });
  const feitos = new Set(lerSaida(o.saida).map((r) => r.id));
  const antes = await uso(chave);
  let gasto = 0;
  for (const { p, ferramentas, corpo } of pedidos) {
    if (feitos.has(p.id)) continue;
    const estimado = (estimarTokens(corpo) * USD_POR_MILHAO_DE_ENTRADA) / 1e6;
    if (gasto + estimado * 2 > o.tetoUsd) {
      console.error(`teto de US$ ${o.tetoUsd} alcançado (gasto US$ ${gasto.toFixed(6)}); parando antes de ${p.id}.`);
      break;
    }
    const base: Omit<Registro, 'status' | 'escolha' | 'confianca' | 'latenciaMs' | 'custoUsd' | 'tokensDeEntrada'> = {
      id: p.id,
      ator: p.ator,
      rotulos: p.rotulos,
      chamadas: p.chamadas.map((c) => c.ferramenta),
      suspeitas: p.suspeitas,
      anterior: ferramentaAnterior(passos, p),
      opcoes: ferramentas.length + 1,
    };
    const t0 = performance.now();
    let registro: Registro;
    try {
      const r = await fetch(ENDPOINT_DO_JEV, {
        method: 'POST',
        headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(o.timeoutMs),
      });
      const latenciaMs = Math.round(performance.now() - t0);
      const texto = await r.text();
      if (!r.ok) {
        registro = { ...base, status: 'erro_http', escolha: null, confianca: null, latenciaMs, custoUsd: null, tokensDeEntrada: null, detalhe: `${r.status} ${texto.slice(0, 200)}` };
      } else {
        const lido = lerResposta(JSON.parse(texto), ferramentas);
        registro =
          lido.status === 'ok'
            ? { ...base, status: 'ok', escolha: lido.escolha, confianca: lido.confianca, latenciaMs, custoUsd: lido.custoUsd, tokensDeEntrada: lido.tokensDeEntrada, geracao: lido.geracao ?? undefined, detalhe: lido.modelo ?? undefined }
            : { ...base, status: lido.status, escolha: null, confianca: null, latenciaMs, custoUsd: null, tokensDeEntrada: null, detalhe: lido.detalhe };
      }
    } catch (erro) {
      const latenciaMs = Math.round(performance.now() - t0);
      const timeout = (erro as Error).name === 'TimeoutError';
      registro = { ...base, status: timeout ? 'timeout' : 'erro_de_rede', escolha: null, confianca: null, latenciaMs, custoUsd: null, tokensDeEntrada: null, detalhe: (erro as Error).name };
    }
    gasto += registro.custoUsd ?? estimado;
    appendFileSync(o.saida, `${JSON.stringify(registro)}\n`, { mode: 0o600 });
  }
  const depois = await uso(chave);
  console.error(
    `gasto pelo usage.cost desta rodada: US$ ${gasto.toFixed(6)}; ` +
      (antes !== null && depois !== null ? `delta de GET /api/v1/key: US$ ${(depois - antes).toFixed(6)}.` : 'GET /api/v1/key não respondeu.'),
  );
  console.log(relatorio(lerSaida(o.saida)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  principal().catch((erro) => {
    console.error((erro as Error).message);
    process.exit(1);
  });
}

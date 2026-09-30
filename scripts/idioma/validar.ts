/**
 * `pnpm --filter @brabo/scripts idioma:validar` — a validação PAGA de idioma e
 * custo (AT-167), chamando o OpenRouter DIRETO, fora do produto e sem gravar
 * nada no banco. A parte pura (matriz, textos lidos do produto, julgamento)
 * está em `validacao.ts`.
 *
 *   --modelos a,b          (padrão: deepseek/deepseek-v4.1-flash,anthropic/claude-haiku-4.5)
 *   --bracos baseline,tratamento   (padrão: os dois)
 *   --casos C01,C02,…      (padrão: C01–C17)
 *   --rodadas 5            (AT-169 resposta 5)
 *   --teto-usd 4.5         pára ANTES da chamada que passaria disto (soma do `usage.cost`)
 *   --max-tokens 4000      teto de saída por chamada (o produto não manda nenhum); com 1000
 *                          o raciocínio do DeepSeek esgotava o teto e a resposta saía VAZIA
 *                          (medido) — resposta vazia vira `falha`, nunca `indeterminado`
 *   --concorrencia 6
 *   --saida <pasta>        (padrão: $XDG_CACHE_HOME/brabo/validacao-idioma/<data>/, fora do git)
 *   --arquivo-de-chave <arq>   lê `OPENROUTER_TEST_KEY=` de um arquivo (senão, do ambiente)
 *   --pular-existentes     não repete (modelo, braço, caso, rodada) que já está na saída
 *   --relatorio            só imprime o relatório do que está na saída, sem chamar nada
 *
 * A chave NUNCA é impressa. O custo sai do `usage.cost` de cada resposta
 * (`usage: {include: true}`), nunca de preço de catálogo.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { RAIZ_DO_REPOSITORIO, dentroDoRepositorio } from './corpus.ts';
import {
  CASOS,
  FONTES,
  IDIOMA_DO_PROJETO,
  deltasDaOrientacao,
  julgar,
  lerFerramentas,
  lerOrientacao,
  lerPersona,
  lerResumo,
  mediana,
  naAmostra,
  orientacao,
  posicionar,
  resultadoDaFerramenta,
  tabela,
  veredicto,
  type Braco,
  type Caso,
  type Chamada,
  type PosicaoDaOrientacao,
  type Resposta,
} from './validacao.ts';

const URL_DO_HUB = 'https://openrouter.ai/api/v1';
const MODELOS_PADRAO = ['deepseek/deepseek-v4.1-flash', 'anthropic/claude-haiku-4.5'];
/** O teto de iterações por turno aqui é 4, não os 12 do Criativo: orçamento. */
const ITERACOES_POR_TURNO = 4;

interface Opcoes {
  modelos: string[];
  bracos: Braco[];
  casos: string[];
  rodadas: number;
  tetoUsd: number;
  maxTokens: number;
  concorrencia: number;
  saida: string;
  arquivoDeChave: string | null;
  pularExistentes: boolean;
  relatorio: boolean;
}

function lerOpcoes(argv: string[]): Opcoes {
  const data = new Date().toISOString().slice(0, 10);
  const cache = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  const o: Opcoes = {
    modelos: MODELOS_PADRAO,
    bracos: ['baseline', 'tratamento'],
    casos: CASOS.map((c) => c.id),
    rodadas: 5,
    tetoUsd: 4.5,
    maxTokens: 4000,
    concorrencia: 6,
    saida: join(cache, 'brabo', 'validacao-idioma', data),
    arquivoDeChave: null,
    pularExistentes: false,
    relatorio: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${a} exige um valor`);
      return x;
    };
    if (a === '--modelos') o.modelos = v().split(',');
    else if (a === '--bracos') o.bracos = v().split(',') as Braco[];
    else if (a === '--casos') o.casos = v().split(',');
    else if (a === '--rodadas') o.rodadas = Number(v());
    else if (a === '--teto-usd') o.tetoUsd = Number(v());
    else if (a === '--max-tokens') o.maxTokens = Number(v());
    else if (a === '--concorrencia') o.concorrencia = Number(v());
    else if (a === '--saida') o.saida = resolve(v());
    else if (a === '--arquivo-de-chave') o.arquivoDeChave = v();
    else if (a === '--pular-existentes') o.pularExistentes = true;
    else if (a === '--relatorio') o.relatorio = true;
    else throw new Error(`opção desconhecida: ${a}`);
  }
  if (dentroDoRepositorio(o.saida)) throw new Error('a saída mora FORA do checkout (as respostas não entram no git)');
  return o;
}

function lerChave(o: Opcoes): string {
  return chaveDe(o.arquivoDeChave);
}

/** A chave de um arquivo `OPENROUTER_TEST_KEY=…` ou do ambiente. NUNCA é impressa. */
export function chaveDe(arquivoDeChave: string | null): string {
  if (arquivoDeChave) {
    for (const linha of readFileSync(arquivoDeChave, 'utf8').split('\n')) {
      const m = linha.trim().match(/^(?:export\s+)?OPENROUTER_TEST_KEY=(.*)$/);
      if (m) return (m[1] as string).trim().replace(/^["']|["']$/g, '');
    }
    throw new Error(`OPENROUTER_TEST_KEY ausente em ${arquivoDeChave}`);
  }
  const k = process.env.OPENROUTER_TEST_KEY;
  if (!k) throw new Error('OPENROUTER_TEST_KEY ausente (ambiente ou --arquivo-de-chave)');
  return k;
}

async function usoDaChave(chave: string): Promise<number | null> {
  try {
    const r = await fetch(`${URL_DO_HUB}/key`, { headers: { Authorization: `Bearer ${chave}` } });
    const j = (await r.json()) as { data?: { usage?: number } };
    return typeof j.data?.usage === 'number' ? j.data.usage : null;
  } catch {
    return null;
  }
}

export interface Mensagem {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

interface Retorno {
  content: string;
  toolCalls: NonNullable<Mensagem['tool_calls']>;
  modelo: string | null;
  upstream: string | null;
  prompt: number | null;
  completion: number | null;
  cached: number | null;
  reasoning: number | null;
  custo: number | null;
}

export class TetoAtingido extends Error {}

export class Cliente {
  gasto = 0;
  private readonly chave: string;
  private readonly teto: number;
  private readonly maxTokens: number;
  constructor(chave: string, teto: number, maxTokens: number) {
    this.chave = chave;
    this.teto = teto;
    this.maxTokens = maxTokens;
  }

  async chamar(modelo: string, mensagens: Mensagem[], ferramentas: unknown[] | null): Promise<Retorno> {
    if (this.gasto >= this.teto) throw new TetoAtingido(`teto de US$ ${this.teto} atingido (gasto ${this.gasto.toFixed(4)})`);
    const corpo = {
      model: modelo,
      messages: mensagens,
      ...(ferramentas ? { tools: ferramentas } : {}),
      max_tokens: this.maxTokens,
      usage: { include: true },
    };
    let ultimo = '';
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      if (tentativa > 0) await new Promise((r) => setTimeout(r, 2000 * 2 ** tentativa));
      try {
        const r = await fetch(`${URL_DO_HUB}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.chave}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
          signal: AbortSignal.timeout(180_000),
        });
        const texto = await r.text();
        if (r.status === 429 || r.status >= 500) {
          ultimo = `HTTP ${r.status}`;
          continue;
        }
        const j = JSON.parse(texto) as {
          error?: { message?: string };
          model?: string;
          provider?: string;
          choices?: { message?: { content?: string | null; tool_calls?: Retorno['toolCalls'] } }[];
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            cost?: number;
            prompt_tokens_details?: { cached_tokens?: number };
            completion_tokens_details?: { reasoning_tokens?: number };
          };
        };
        if (!r.ok || j.error) throw new Error(`HTTP ${r.status}: ${j.error?.message ?? 'sem mensagem'}`);
        const u = j.usage ?? {};
        const custo = typeof u.cost === 'number' ? u.cost : null;
        if (custo !== null) this.gasto += custo;
        const msg = j.choices?.[0]?.message ?? {};
        return {
          content: msg.content ?? '',
          toolCalls: msg.tool_calls ?? [],
          modelo: j.model ?? null,
          upstream: j.provider ?? null,
          prompt: u.prompt_tokens ?? null,
          completion: u.completion_tokens ?? null,
          cached: u.prompt_tokens_details?.cached_tokens ?? null,
          reasoning: u.completion_tokens_details?.reasoning_tokens ?? null,
          custo,
        };
      } catch (e) {
        if (e instanceof TetoAtingido) throw e;
        ultimo = (e as Error).message;
        if (/^HTTP 4\d\d/.test(ultimo)) break;
      }
    }
    throw new Error(`chamada falhou: ${ultimo}`);
  }
}

export interface Contexto {
  cliente: Cliente;
  sha: string;
  data: string;
  persona: string;
  ferramentas: ReturnType<typeof lerFerramentas>;
  nomes: string[];
  orient: ReturnType<typeof lerOrientacao>;
  resumo: ReturnType<typeof lerResumo>;
  modelos: string[];
  gravarChamada: (c: Chamada) => void;
  gravarResposta: (r: Resposta) => void;
  /** Só o diagnóstico (AT-279): para depois de N turnos. */
  turnosMax?: number;
  /** Só o diagnóstico (AT-279): a orientação SEM a cláusula do artefato (RN-623), para isolar o efeito dela. */
  semClausula?: boolean;
}

/** O histórico como a reidratação o reconstrói: texto, ferramenta vira texto, sem `role: "tool"` (RN-580). */
function reidratar(msgs: Mensagem[]): Mensagem[] {
  const [sistema, ...resto] = msgs;
  const out: Mensagem[] = sistema ? [sistema] : [];
  for (const m of resto) {
    if (m.role === 'tool') continue;
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const f = m.tool_calls.map((t) => `[ferramenta ${t.function.name}: ${t.function.arguments}]`).join('\n');
      out.push({ role: 'assistant', content: [m.content, f].filter(Boolean).join('\n') });
    } else if (m.content) out.push({ role: m.role, content: m.content });
  }
  return out;
}

export async function conversa(
  ctx: Contexto,
  modelo: string,
  braco: Braco,
  caso: Caso,
  rodada: number,
  /** Onde a orientação vai; ausente = como o produto faz (última `system`). */
  posicao?: PosicaoDaOrientacao,
): Promise<void> {
  const outro = ctx.modelos.find((m) => m !== modelo) ?? modelo;
  for (let s = 0; s < caso.sessoes.length; s++) {
    let msgs: Mensagem[] = [{ role: 'system', content: ctx.persona }];
    let quebrada: string | null = null;
    const turnos = caso.sessoes[s] as NonNullable<Caso['sessoes'][number]>;
    for (let t = 0; t < Math.min(turnos.length, ctx.turnosMax ?? turnos.length); t++) {
      const turno = turnos[t] as NonNullable<(typeof turnos)[number]>;
      const base = { data: ctx.data, sha: ctx.sha, braco, modelo, sobTeste: modelo, caso: caso.id, rodada, sessao: s, turno: t, ...(posicao ? { posicao } : {}) };
      let compactou = false;
      if (!quebrada && turno.retomarAntes) msgs = reidratar(msgs);
      if (!quebrada && turno.compactarAntes) {
        const [sistema, ...resto] = msgs;
        const antigas = resto.slice(0, -2);
        const recentes = resto.slice(-2);
        const turnosTxt = antigas.map((m) => `${m.role}: ${m.content}`).join('\n\n');
        const prefixo = braco === 'tratamento' ? ctx.resumo.prefixo : ctx.resumo.prefixoAntigo;
        const inicio = Date.now();
        try {
          const r = await ctx.cliente.chamar(modelo, [{ role: 'user', content: `${prefixo}${turnosTxt}` }], null);
          ctx.gravarChamada({
            ...base, iteracao: 0, papel: 'context-manager', compactouAntes: false, orientacao: null,
            modeloRespondido: r.modelo, upstream: r.upstream, promptTokens: r.prompt, completionTokens: r.completion,
            cachedTokens: r.cached, reasoningTokens: r.reasoning, custoUsd: r.custo, latenciaMs: Date.now() - inicio, erro: null,
          });
          const resumo = r.content || `(${antigas.length} turnos anteriores omitidos)`;
          msgs = [sistema as Mensagem, { role: 'system', content: `${ctx.resumo.cabecalho}${resumo}` }, ...recentes];
          compactou = true;
        } catch (e) {
          if (e instanceof TetoAtingido) throw e;
          quebrada = (e as Error).message;
        }
      }
      msgs.push({ role: 'user', content: turno.texto });
      let ultimoTexto = '';
      const usadas: string[] = [];
      const upstreams: string[] = [];
      const modeloDoTurno = turno.noOutroModelo ? outro : modelo;
      for (let it = 0; !quebrada && it < ITERACOES_POR_TURNO; it++) {
        const texto = braco === 'tratamento' ? orientacao(ctx.orient, turno.autor, ctx.semClausula ? null : IDIOMA_DO_PROJETO, ctx.nomes) : null;
        const envio: Mensagem[] = texto ? posicionar(posicao ?? 'ultima-system', msgs, texto) : msgs;
        const inicio = Date.now();
        let r: Retorno;
        try {
          r = await ctx.cliente.chamar(modeloDoTurno, envio, ctx.ferramentas);
        } catch (e) {
          if (e instanceof TetoAtingido) throw e;
          quebrada = (e as Error).message;
          ctx.gravarChamada({
            ...base, modelo: modeloDoTurno, iteracao: it, papel: 'agente', compactouAntes: compactou, orientacao: texto,
            modeloRespondido: null, upstream: null, promptTokens: null, completionTokens: null, cachedTokens: null,
            reasoningTokens: null, custoUsd: null, latenciaMs: Date.now() - inicio, erro: quebrada,
          });
          break;
        }
        ctx.gravarChamada({
          ...base, modelo: modeloDoTurno, iteracao: it, papel: 'agente', compactouAntes: compactou, orientacao: texto,
          modeloRespondido: r.modelo, upstream: r.upstream, promptTokens: r.prompt, completionTokens: r.completion,
          cachedTokens: r.cached, reasoningTokens: r.reasoning, custoUsd: r.custo, latenciaMs: Date.now() - inicio, erro: null,
        });
        if (r.upstream) upstreams.push(r.upstream);
        if (r.content) ultimoTexto = r.content;
        msgs.push({ role: 'assistant', content: r.content, ...(r.toolCalls.length ? { tool_calls: r.toolCalls } : {}) });
        if (r.toolCalls.length === 0) break;
        let aguardando = false;
        for (const tc of r.toolCalls) {
          usadas.push(tc.function.name);
          let args: unknown = null;
          try {
            args = JSON.parse(tc.function.arguments || 'null');
          } catch {
            args = null;
          }
          if (tc.function.name === 'ask_structured_questions') {
            aguardando = true;
            const qs = (args as { questions?: { label?: string; options?: string[] }[] } | null)?.questions ?? [];
            const perguntas = qs.map((q) => [q.label, ...(q.options ?? [])].filter(Boolean).join(' ')).join('\n');
            ultimoTexto = [ultimoTexto, perguntas].filter(Boolean).join('\n');
          }
          msgs.push({ role: 'tool', tool_call_id: tc.id, content: resultadoDaFerramenta(tc.function.name, args) });
        }
        if (aguardando) break;
      }
      // Resposta vazia é falha do INSTRUMENTO (o teto de saída), nunca `indeterminado`.
      const vazia = !quebrada && ultimoTexto.trim() === '';
      if (turno.esperado) {
        const veredito = quebrada || vazia ? 'falha' : julgar(ultimoTexto);
        const chave = `${modelo}|${braco}|${caso.id}|${rodada}|${s}|${t}`;
        ctx.gravarResposta({
          braco, modelo, caso: caso.id, rodada, sessao: s, turno: t, esperado: turno.esperado, veredito,
          revisar: veredito === 'indeterminado' || veredito !== turno.esperado || Boolean(turno.revisarSempre) || naAmostra(chave),
          noLimiar: caso.noLimiar, texto: quebrada ? `(falha: ${quebrada})` : vazia ? '(falha: resposta vazia — o teto de max_tokens esgotou no raciocínio?)' : ultimoTexto, usouFerramenta: usadas, upstream: upstreams, ...(posicao ? { posicao } : {}),
        });
      }
    }
  }
}

async function emPool<T>(itens: T[], n: number, f: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  let parar: unknown = null;
  await Promise.all(
    Array.from({ length: Math.min(n, itens.length) }, async () => {
      while (i < itens.length && !parar) {
        const x = itens[i++] as T;
        try {
          await f(x);
        } catch (e) {
          parar = e;
        }
      }
    }),
  );
  if (parar) throw parar;
}

function lerJsonl<T>(arq: string): T[] {
  if (!existsSync(arq)) return [];
  return readFileSync(arq, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
}

const pct = (a: number, n: number) => (n === 0 ? '—' : `${((100 * a) / n).toFixed(1)}%`);

export function relatorio(chamadas: Chamada[], respostas: Resposta[]): string {
  const linhas: string[] = [];
  const modelos = [...new Set(respostas.map((r) => r.modelo))];
  linhas.push('## Por cenário × braço × modelo (juiz: classificador local, lista `ampliada`)', '');
  linhas.push('| caso | modelo | braço | n | acerto | erro (es) | indeterminado | falha | a revisar |');
  linhas.push('|---|---|---|---|---|---|---|---|---|');
  const t = tabela(respostas);
  for (const caso of CASOS) {
    for (const m of modelos) {
      for (const b of ['baseline', 'tratamento'] as const) {
        const c = t.get(`${caso.id}|${m}|${b}`);
        if (!c) continue;
        linhas.push(`| ${caso.id} | ${m} | ${b} | ${c.n} | ${c.acerto} (${pct(c.acerto, c.n)}) | ${c.erro} (${c.espanhol}) | ${c.indeterminado} | ${c.falha} | ${c.revisar} |`);
      }
    }
  }
  linhas.push('', '## Limiar (AT-169: braço tratado, zero espanhol com pt-BR esperado, acerto ≥ 95% em C01–C04 e C06–C15)', '');
  linhas.push('| modelo | espanhol quando pt | acerto no limiar | indeterminado | taxa estrita | veredito |');
  linhas.push('|---|---|---|---|---|---|');
  for (const m of modelos) {
    const v = veredicto(respostas, m);
    linhas.push(`| ${m} | ${v.espanholQuandoPt} | ${v.acertoNoLimiar}/${v.nNoLimiar} | ${v.indeterminadoNoLimiar} | ${pct(v.acertoNoLimiar, v.nNoLimiar)} | ${v.nNoLimiar === 0 ? 'não medido' : v.aprovado ? 'passa' : 'não passa'} |`);
  }
  linhas.push('', '## Custo incremental da orientação (Δ `prompt_tokens` pareado, primeira chamada)', '');
  linhas.push('| modelo | orientação (caracteres) | pares | Δ mediana | Δ mín–máx |');
  linhas.push('|---|---|---|---|---|');
  for (const [k, e] of deltasDaOrientacao(chamadas)) {
    const m = k.split('|')[0];
    linhas.push(`| ${m} | ${e.orientacao.length}: «${e.orientacao.slice(0, 40)}…» | ${e.deltas.length} | ${mediana(e.deltas)} | ${Math.min(...e.deltas)}–${Math.max(...e.deltas)} |`);
  }
  linhas.push('', '## Gasto (soma do `usage.cost` de cada resposta)', '');
  linhas.push('| modelo | braço | chamadas | com erro | prompt tokens | completion tokens | reasoning | cached | US$ |');
  linhas.push('|---|---|---|---|---|---|---|---|---|');
  const grupos = new Map<string, Chamada[]>();
  for (const c of chamadas) {
    const k = `${c.modelo}|${c.braco}`;
    grupos.set(k, [...(grupos.get(k) ?? []), c]);
  }
  let total = 0;
  for (const [k, cs] of grupos) {
    const [m, b] = k.split('|');
    const s = (f: (c: Chamada) => number | null) => cs.reduce((a, c) => a + (f(c) ?? 0), 0);
    const usd = s((c) => c.custoUsd);
    total += usd;
    linhas.push(`| ${m} | ${b} | ${cs.length} | ${cs.filter((c) => c.erro).length} | ${s((c) => c.promptTokens)} | ${s((c) => c.completionTokens)} | ${s((c) => c.reasoningTokens)} | ${s((c) => c.cachedTokens)} | ${usd.toFixed(4)} |`);
  }
  linhas.push('', `Total pelo \`usage.cost\`: US$ ${total.toFixed(4)}.`, '');
  linhas.push('## Upstream que serviu (fator de confusão, não fixado)', '');
  const up = new Map<string, number>();
  for (const c of chamadas) if (!c.erro) up.set(`${c.modelo} → ${c.upstream ?? '(não informado)'}`, (up.get(`${c.modelo} → ${c.upstream ?? '(não informado)'}`) ?? 0) + 1);
  for (const [k, n] of [...up].sort()) linhas.push(`- ${k}: ${n}`);
  const ferr = respostas.filter((r) => r.caso === 'C13');
  if (ferr.length) {
    linhas.push('', `C13 com ferramenta chamada: ${ferr.filter((r) => r.usouFerramenta.length > 0).length}/${ferr.length}.`);
  }
  return linhas.join('\n');
}

function revisao(respostas: Resposta[]): string {
  const out = ['# Respostas marcadas para revisão humana', ''];
  for (const r of respostas.filter((x) => x.revisar)) {
    out.push(`## ${r.caso} · ${r.modelo} · ${r.braco} · rodada ${r.rodada} · sessão ${r.sessao} · turno ${r.turno}`);
    out.push(`esperado: ${r.esperado} · classificador: ${r.veredito} · revisão humana: ______`, '', '```text', r.texto.replace(/```/g, "'''"), '```', '');
  }
  return out.join('\n');
}

async function main(): Promise<void> {
  const o = lerOpcoes(process.argv.slice(2));
  mkdirSync(o.saida, { recursive: true, mode: 0o700 });
  const arqChamadas = join(o.saida, 'chamadas.jsonl');
  const arqRespostas = join(o.saida, 'respostas.jsonl');
  if (!o.relatorio) {
    const chave = lerChave(o);
    const ler = (p: string) => readFileSync(join(RAIZ_DO_REPOSITORIO, p), 'utf8');
    const orient = lerOrientacao(ler(FONTES.orientacao));
    const ferramentas = lerFerramentas(RAIZ_DO_REPOSITORIO);
    const cliente = new Cliente(chave, o.tetoUsd, o.maxTokens);
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: RAIZ_DO_REPOSITORIO, encoding: 'utf8' }).trim();
    const ctx: Contexto = {
      cliente, sha, data: new Date().toISOString(), persona: lerPersona(ler(FONTES.persona)), ferramentas,
      nomes: ferramentas.map((f) => f.function.name), orient, resumo: lerResumo(ler(FONTES.resumo)), modelos: o.modelos,
      gravarChamada: (c) => appendFileSync(arqChamadas, `${JSON.stringify(c)}\n`, { mode: 0o600 }),
      gravarResposta: (r) => appendFileSync(arqRespostas, `${JSON.stringify(r)}\n`, { mode: 0o600 }),
    };
    const feitas = new Set(o.pularExistentes ? lerJsonl<Chamada>(arqChamadas).map((c) => `${c.sobTeste}|${c.braco}|${c.caso}|${c.rodada}`) : []);
    const antes = await usoDaChave(chave);
    console.error(`/key antes: ${antes ?? 'não lido'} · saída: ${o.saida}`);
    for (const modelo of o.modelos) {
      for (const braco of o.bracos) {
        const tarefas = CASOS.filter((c) => o.casos.includes(c.id)).flatMap((c) =>
          Array.from({ length: o.rodadas }, (_, r) => ({ c, r })).filter(({ c, r }) => !feitas.has(`${modelo}|${braco}|${c.id}|${r}`)),
        );
        try {
          await emPool(tarefas, o.concorrencia, ({ c, r }) => conversa(ctx, modelo, braco, c, r));
        } finally {
          const agora = await usoDaChave(chave);
          console.error(`${modelo} · ${braco}: ${tarefas.length} conversas · usage.cost acumulado US$ ${cliente.gasto.toFixed(4)} · /key ${agora ?? 'não lido'} (Δ ${antes !== null && agora !== null ? (agora - antes).toFixed(4) : '?'})`);
        }
      }
    }
  }
  const chamadas = lerJsonl<Chamada>(arqChamadas);
  const respostas = lerJsonl<Resposta>(arqRespostas);
  writeFileSync(join(o.saida, 'revisao.md'), revisao(respostas), { mode: 0o600 });
  console.log(relatorio(chamadas, respostas));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}

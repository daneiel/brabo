/**
 * `pnpm --filter @brabo/scripts jev:analise -- <modo>` — a segunda rodada da
 * medição do Jev (AT-237): variantes de `state`, divisão tuning × validação,
 * equivalências, top-2 e cascata. Só LÊ o banco (três `SELECT`s + três tabelas
 * de apoio, em `dados.ts`) e escreve FORA do checkout.
 *
 *   --container/--usuario/--banco/--database-url/--projeto   de onde ler (como em `replay.ts`)
 *   --dados-cache <arq>      fotografia do banco (texto de sessão: fora do repositório)
 *   --refazer-dados          refaz a fotografia
 *   --saida-dir <dir>        uma `<variante>.jsonl` por variante (padrão ~/.cache/brabo/replay-jev/v2)
 *   --variante <nome>        pergunta ao Jev com essa variante (retoma o que já respondeu)
 *   --metade tuning|validacao|ambas   quais passos (padrão tuning — a validação não se olha antes da hora)
 *   --estimar                só conta e estima o custo, sem rede
 *   --relatorio [--final <variante>]  tabelas a partir das saídas
 *   --dump-erros <arq> --variante <v> --metade <m>   estado + escolha dos passos ERRADOS (para leitura à mão)
 *   --teto-usd <x>           teto do gasto ACUMULADO de todas as saídas do diretório (padrão 1.00)
 *   --arquivo-de-chave <arq> lê OPENROUTER_TEST_KEY de um arquivo KEY=valor
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { perguntar } from './cliente.ts';
import { carregar, type Dados, type Fonte } from './dados.ts';
import { dividir, type Metade } from './divisao.ts';
import { classificarChamada, TODAS_AS_CAMADAS, type Camada } from './equivalencia.ts';
import { INSTRUCAO_COM_FLUXO, montarPedido } from './jev.ts';
import { TETO_DE_LATENCIA_MS, type Registro } from './medicao.ts';
import {
  acerto1,
  acertoAnterior,
  acertoK,
  acertoUniao,
  cascata,
  comFerramenta,
  curvaPorLimiar,
  ESTRITA,
  fmt,
  pares,
  porAgente,
  respondidas,
  rotulosDe,
  taxaDe,
  type Degrau,
  type Linha,
} from './medicao2.ts';
import { catalogoDoAtor, montarPassos, type Catalogo, type Passo } from './passos.ts';
import { montarEstadoV2, passosAnteriores, VARIANTES, type Contexto } from './variantes.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');
const USD_POR_MILHAO_DE_ENTRADA = 0.042;

export interface Opcoes extends Fonte {
  dadosCache?: string;
  refazerDados: boolean;
  saidaDir: string;
  variante?: string;
  metade: Metade | 'ambas';
  estimar: boolean;
  relatorio: boolean;
  final?: string;
  dumpErros?: string;
  tetoUsd: number;
  timeoutMs: number;
  arquivoDeChave?: string;
  limite?: number;
}

export function dentroDoRepositorio(caminho: string, raiz = RAIZ): boolean {
  const rel = relative(raiz, resolve(caminho));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function lerOpcoes(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): Opcoes {
  const cache = env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : join(homedir(), '.cache');
  const o: Opcoes = {
    usuario: 'brabo',
    banco: 'brabo',
    refazerDados: false,
    saidaDir: join(cache, 'brabo', 'replay-jev', 'v2'),
    metade: 'tuning',
    estimar: false,
    relatorio: false,
    tetoUsd: 1,
    timeoutMs: 10_000,
  };
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
    else if (a === '--dados-cache') o.dadosCache = v();
    else if (a === '--refazer-dados') o.refazerDados = true;
    else if (a === '--saida-dir') o.saidaDir = v();
    else if (a === '--variante') o.variante = v();
    else if (a === '--metade') {
      const m = v();
      if (m !== 'tuning' && m !== 'validacao' && m !== 'ambas') throw new Error('--metade: tuning, validacao ou ambas');
      o.metade = m;
    } else if (a === '--estimar') o.estimar = true;
    else if (a === '--relatorio') o.relatorio = true;
    else if (a === '--final') o.final = v();
    else if (a === '--dump-erros') o.dumpErros = v();
    else if (a === '--teto-usd') o.tetoUsd = num();
    else if (a === '--timeout-ms') o.timeoutMs = num();
    else if (a === '--limite') o.limite = num();
    else if (a === '--arquivo-de-chave') o.arquivoDeChave = v();
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  if (o.variante && !VARIANTES[o.variante]) throw new Error(`variante desconhecida: ${o.variante} (${Object.keys(VARIANTES).join(', ')})`);
  for (const c of [o.saidaDir, o.dadosCache, o.dumpErros]) {
    if (c && dentroDoRepositorio(c)) throw new Error(`recusado: ${c} fica dentro do repositório; a saída tem texto de sessão e mora fora do git`);
  }
  if (!o.relatorio && !o.container === !o.databaseUrl && !o.dadosCache) {
    throw new Error('diga de onde ler: --container <nome> OU --database-url <url> OU --dados-cache <arq> já gravado');
  }
  return o;
}

export function lerChave(arquivo: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  if (arquivo) {
    for (const linha of readFileSync(arquivo, 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?OPENROUTER_TEST_KEY\s*=\s*(.*)$/.exec(linha);
      if (m) return m[1]!.trim().replace(/^(['"])(.*)\1$/, '$2');
    }
    throw new Error(`${arquivo} não define OPENROUTER_TEST_KEY`);
  }
  const k = env.OPENROUTER_TEST_KEY;
  if (!k) throw new Error('OPENROUTER_TEST_KEY ausente (ambiente ou --arquivo-de-chave)');
  return k;
}

const lerJsonl = (caminho: string): Registro[] =>
  existsSync(caminho)
    ? readFileSync(caminho, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Registro)
    : [];

/** O gasto acumulado (soma de `usage.cost`) de TODAS as saídas do diretório, inclusive as `.descartado` (gasto é gasto). */
export function gastoAcumulado(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl') || f.endsWith('.descartado'))
    .flatMap((f) => lerJsonl(join(dir, f)))
    .reduce((s, r) => s + (r.custoUsd ?? 0), 0);
}

export interface Universo {
  cx: Contexto;
  elegiveis: Passo[];
  metade: Map<string, Metade>;
  catalogo: Catalogo;
}

export function montarUniverso(dados: Dados, catalogo: Catalogo): Universo {
  const { passos } = montarPassos(dados.eventos, dados.usos, catalogo, new Map(dados.acoes.map((x) => [x.id, x])));
  const elegiveis = passos.filter((p) => (catalogoDoAtor(catalogo, p.ator)?.length ?? 0) >= 2);
  const instrucoes = new Map(dados.instrucoes.map((i) => [`${i.projetoId}|${i.ator}`, i.conteudo]));
  const { metade } = dividir(dados.eventos, elegiveis);
  return { cx: { dados, eventos: dados.eventos, passos, catalogo, instrucoes }, elegiveis, metade, catalogo };
}

function linhaDe(u: Universo, p: Passo, r: Registro, primeiraRodada: ReadonlySet<string>): Linha {
  return {
    id: p.id,
    ator: p.ator,
    metade: u.metade.get(p.id)!,
    novo: !primeiraRodada.has(p.id),
    chamadas: p.chamadas.map((c) => classificarChamada(c.ferramenta, c.argumentos)),
    status: r.status,
    escolha: r.escolha,
    confianca: r.confianca,
    probabilidades: r.probabilidades ?? null,
    suspeitas: p.suspeitas,
    tokensDeEntrada: r.tokensDeEntrada,
    latenciaMs: r.latenciaMs,
    custoUsd: r.custoUsd,
    anterior: passosAnteriores(u.cx.eventos, u.cx.passos, p, true).filter((q) => q.chamadas.length > 0).at(-1)?.chamadas.at(-1)?.ferramenta ?? null,
  };
}

export function linhasDaVariante(u: Universo, dir: string, nome: string, primeiraRodada: ReadonlySet<string>): Linha[] {
  const porId = new Map(u.elegiveis.map((p) => [p.id, p]));
  return lerJsonl(join(dir, `${nome}.jsonl`)).flatMap((r) => {
    const p = porId.get(r.id);
    return p ? [linhaDe(u, p, r, primeiraRodada)] : [];
  });
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const mediana = (xs: number[]): number | null => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : null);

function tabelaDeVariantes(u: Universo, dir: string, primeira: ReadonlySet<string>): string {
  const cab = ['| variante | metade | n | estrita top-1 | equivalência top-1 | equivalência top-2 | tokens (mediana) | latência p50/máx ms |', '|---|---|---|---|---|---|---|---|'];
  for (const nome of Object.keys(VARIANTES)) {
    const todas = linhasDaVariante(u, dir, nome, primeira);
    for (const m of ['tuning', 'validacao'] as const) {
      const ls = respondidas(todas.filter((l) => l.metade === m));
      if (ls.length === 0) continue;
      const c = comFerramenta(ls);
      const lat = ls.map((l) => l.latenciaMs).sort((a, b) => a - b);
      cab.push(
        `| ${nome} | ${m} | ${c.length} | ${fmt(taxaDe(c, acerto1(ESTRITA)))} | ${fmt(taxaDe(c, acerto1(TODAS_AS_CAMADAS)))} | ${fmt(taxaDe(c, acertoK(2, TODAS_AS_CAMADAS)))} | ` +
          `${mediana(ls.map((l) => l.tokensDeEntrada ?? 0))} | ${lat[Math.floor(lat.length / 2)]}/${lat.at(-1)} |`,
      );
    }
  }
  return cab.join('\n');
}

/** Os degraus da cascata, na ordem em que foram escritos antes de rodar. */
export const DEGRAUS_DA_CASCATA: readonly { nome: string; variante: string; camadas: readonly Camada[] }[] = [
  { nome: 'input original, régua estrita (a da 1ª rodada)', variante: 'original', camadas: ESTRITA },
  { nome: '+ E1: terminal de leitura ≡ read_file/search_workspace', variante: 'original', camadas: ['E1'] },
  { nome: '+ E2: read_file ≡ search_workspace', variante: 'original', camadas: ['E1', 'E2'] },
  { nome: '+ E3: terminal que grava ≡ write_file', variante: 'original', camadas: TODAS_AS_CAMADAS },
  { nome: '+ pedido = mensagem inicial do laço (kickoff do código do engine)', variante: 'kickoff', camadas: TODAS_AS_CAMADAS },
  { nome: '+ passos recentes só da execução corrente', variante: 'escopo', camadas: TODAS_AS_CAMADAS },
  { nome: '+ resultados e argumentos até 2 000 caracteres', variante: 'resultados', camadas: TODAS_AS_CAMADAS },
  { nome: '+ texto do modelo nos passos anteriores', variante: 'texto', camadas: TODAS_AS_CAMADAS },
  { nome: '+ contagens derivadas (progresso)', variante: 'progresso', camadas: TODAS_AS_CAMADAS },
];

export function relatorioFinal(u: Universo, dir: string, primeira: ReadonlySet<string>, final: string): string {
  const out: string[] = [];
  out.push('## Variantes tentadas', '', tabelaDeVariantes(u, dir, primeira), '');
  const doFinal = linhasDaVariante(u, dir, final, primeira);
  const val = (nome: string) => linhasDaVariante(u, dir, nome, primeira).filter((l) => l.metade === 'validacao');
  const graus: Degrau[] = DEGRAUS_DA_CASCATA.map((d) => ({ nome: d.nome, linhas: val(d.variante), camadas: d.camadas }));
  out.push('## Cascata (validação)', '', cascata(graus.filter((g) => g.linhas.length > 0)), '');
  const v = respondidas(doFinal.filter((l) => l.metade === 'validacao'));
  const c = comFerramenta(v);
  out.push(
    `## Manchete (${final}, validação)`,
    '',
    `- n = ${c.length} passos com ferramenta (mais ${v.length - c.length} sem ferramenta)`,
    `- top-1 estrita: ${fmt(taxaDe(c, acerto1(ESTRITA)))}`,
    `- top-1 por equivalência: ${fmt(taxaDe(c, acerto1(TODAS_AS_CAMADAS)))}`,
    `- top-2 por equivalência: ${fmt(taxaDe(c, acertoK(2, TODAS_AS_CAMADAS)))}; top-2 estrita: ${fmt(taxaDe(c, acertoK(2, ESTRITA)))}`,
    `- top-3 por equivalência: ${fmt(taxaDe(c, acertoK(3, TODAS_AS_CAMADAS)))}`,
    `- linha de base "repetir a ferramenta anterior": estrita ${fmt(taxaDe(c.filter((l) => l.anterior !== null), acertoAnterior(ESTRITA)))}; por equivalência ${fmt(taxaDe(c.filter((l) => l.anterior !== null), acertoAnterior(TODAS_AS_CAMADAS)))}`,
    `- menu de dois sem segunda chamada, {escolha do Jev, ferramenta anterior}: estrita ${fmt(taxaDe(c, acertoUniao(ESTRITA)))}; por equivalência ${fmt(taxaDe(c, acertoUniao(TODAS_AS_CAMADAS)))}`,
    `- sem a Anamnese (kickoff não reconstruível, agente pausado no produto): ${fmt(taxaDe(c.filter((l) => l.ator !== 'anamnese'), acerto1(TODAS_AS_CAMADAS)))}`,
    '',
  );
  out.push(`## Por agente (${final}, validação)`, '', '| agente | n | estrita | equivalência | top-2 |', '|---|---|---|---|---|');
  for (const l of porAgente(v)) out.push(`| ${l.ator} | ${l.n} | ${fmt(l.estrita)} | ${fmt(l.equivalencia)} | ${fmt(l.top2)} |`);
  out.push('', `## Pares rótulo → escolha (${final}, validação, erros sob a equivalência)`, '', '| par | n |', '|---|---|');
  for (const p of pares(v).slice(0, 15)) out.push(`| ${p.par} | ${p.n} |`);
  out.push('', `## Curva acerto × limiar (${final}, validação, equivalência)`, '', '| limiar | menu restrito a 1 | acerto entre os restritos (IC 95%) |', '|---|---|---|');
  for (const p of curvaPorLimiar(v, TODAS_AS_CAMADAS)) out.push(`| ${p.limiar.toFixed(2)} | ${p.restritos}/${p.total} | ${fmt(p.acerto)} |`);
  const novos = respondidas(doFinal.filter((l) => l.novo));
  if (novos.length) {
    out.push('', `Passos novos desde a 1ª rodada (${final}, as duas metades): n = ${comFerramenta(novos).length}; ${fmt(taxaDe(comFerramenta(novos), acerto1(TODAS_AS_CAMADAS)))} por equivalência, ${fmt(taxaDe(comFerramenta(novos), acerto1(ESTRITA)))} estrita.`);
  }
  const sem = v.filter((l) => l.chamadas.length === 0);
  out.push('', `Passos sem ferramenta (${final}, validação): ${fmt(taxaDe(sem, acerto1(ESTRITA)))}.`);
  const todas = respondidas(doFinal);
  const lat = todas.map((l) => l.latenciaMs).sort((x, y) => x - y);
  const tok = todas.map((l) => l.tokensDeEntrada ?? 0).sort((x, y) => x - y);
  const q = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.ceil(p * xs.length) - 1)];
  const custos = todas.map((l) => l.custoUsd ?? 0);
  out.push(
    `Entrada (${final}): tokens p50 ${q(tok, 0.5)}, p95 ${q(tok, 0.95)}, máx ${tok.at(-1)}; latência ms p50 ${q(lat, 0.5)}, p95 ${q(lat, 0.95)}, máx ${lat.at(-1)}; acima de ${TETO_DE_LATENCIA_MS} ms: ${lat.filter((x) => x > TETO_DE_LATENCIA_MS).length}/${lat.length}.`,
    `Custo por passo (${final}): US$ ${(custos.reduce((s, x) => s + x, 0) / Math.max(1, custos.length)).toFixed(8)}; gasto acumulado do diretório: US$ ${gastoAcumulado(dir).toFixed(6)}.`,
  );
  return out.join('\n');
}

async function principal(): Promise<void> {
  let o: Opcoes;
  try {
    o = lerOpcoes(process.argv.slice(2));
  } catch (erro) {
    console.error((erro as Error).message);
    process.exit(2);
  }
  const catalogo = JSON.parse(readFileSync(join(AQUI, 'catalogo.json'), 'utf8')) as Catalogo;
  const dados = carregar(o, o.dadosCache, o.refazerDados);
  const u = montarUniverso(dados, catalogo);
  const primeira = new Set(
    lerJsonl(join(homedir(), '.cache', 'brabo', 'replay-jev', 'respostas.jsonl')).map((r) => r.id),
  );
  const contagem = { tuning: 0, validacao: 0 };
  for (const p of u.elegiveis) contagem[u.metade.get(p.id)!]++;
  console.error(`passos elegíveis ${u.elegiveis.length} (tuning ${contagem.tuning}, validação ${contagem.validacao}); ${u.elegiveis.filter((p) => !primeira.has(p.id)).length} novos desde a 1ª rodada.`);

  if (o.relatorio) {
    console.log(relatorioFinal(u, o.saidaDir, primeira, o.final ?? 'escopo'));
    return;
  }
  if (!o.variante) {
    console.error('diga --variante <nome> (ou --relatorio).');
    process.exit(2);
  }
  const v = VARIANTES[o.variante]!;
  const alvo = u.elegiveis.filter((p) => o.metade === 'ambas' || u.metade.get(p.id) === o.metade);
  if (o.dumpErros) {
    const linhas = linhasDaVariante(u, o.saidaDir, o.variante, primeira).filter((l) => (o.metade === 'ambas' || l.metade === o.metade) && l.status === 'ok');
    const porId = new Map(u.elegiveis.map((p) => [p.id, p]));
    const erros = linhas.filter((l) => !acerto1(TODAS_AS_CAMADAS)(l)).map((l) => {
      const p = porId.get(l.id)!;
      return { id: l.id, ator: l.ator, rotulos: rotulosDe(l), comandos: p.chamadas.map((c) => (c.argumentos as { command?: string })?.command ?? null), escolha: l.escolha, confianca: l.confianca, texto: p.texto, estado: montarEstadoV2(u.cx, p, v) };
    });
    writeFileSync(o.dumpErros, erros.map((e) => JSON.stringify(e)).join('\n'), { mode: 0o600 });
    console.error(`${erros.length} passos errados gravados em ${o.dumpErros}`);
    return;
  }
  const pedidos = alvo.slice(0, o.limite).map((p) => {
    const ferramentas = catalogoDoAtor(catalogo, p.ator)!;
    return { p, ferramentas, corpo: montarPedido(montarEstadoV2(u.cx, p, v), ferramentas, catalogo, v.fluxo ? INSTRUCAO_COM_FLUXO : undefined) };
  });
  const tokens = pedidos.reduce((s, x) => s + Math.ceil(JSON.stringify(x.corpo).length / 4), 0);
  const arquivo = join(o.saidaDir, `${o.variante}.jsonl`);
  const feitos = new Set(lerJsonl(arquivo).map((r) => r.id));
  console.error(
    `variante ${o.variante}, metade ${o.metade}: ${pedidos.length} passos (${pedidos.filter((x) => !feitos.has(x.p.id)).length} a perguntar), ` +
      `~${tokens} tokens ≈ US$ ${((tokens * USD_POR_MILHAO_DE_ENTRADA) / 1e6).toFixed(4)}; acumulado até aqui US$ ${gastoAcumulado(o.saidaDir).toFixed(6)} (teto ${o.tetoUsd}).`,
  );
  if (o.estimar) return;
  const chave = lerChave(o.arquivoDeChave);
  mkdirSync(o.saidaDir, { recursive: true, mode: 0o700 });
  let gasto = gastoAcumulado(o.saidaDir);
  const antes = gasto;
  for (const { p, ferramentas, corpo } of pedidos) {
    if (feitos.has(p.id)) continue;
    const estimado = (Math.ceil(JSON.stringify(corpo).length / 4) * USD_POR_MILHAO_DE_ENTRADA) / 1e6;
    if (gasto + estimado * 2 > o.tetoUsd) {
      console.error(`teto de US$ ${o.tetoUsd} alcançado (acumulado US$ ${gasto.toFixed(6)}); parando antes de ${p.id}.`);
      break;
    }
    const r = await perguntar(
      corpo,
      ferramentas,
      { id: p.id, ator: p.ator, rotulos: p.rotulos, chamadas: p.chamadas.map((c) => c.ferramenta), suspeitas: p.suspeitas, anterior: null, opcoes: ferramentas.length + 1 },
      chave,
      o.timeoutMs,
    );
    gasto += r.custoUsd ?? estimado;
    appendFileSync(arquivo, `${JSON.stringify(r)}\n`, { mode: 0o600 });
  }
  console.error(`gasto desta chamada: US$ ${(gasto - antes).toFixed(6)}; acumulado US$ ${gasto.toFixed(6)}.`);
  const ls = respondidas(linhasDaVariante(u, o.saidaDir, o.variante, primeira).filter((l) => o.metade === 'ambas' || l.metade === o.metade));
  const c = comFerramenta(ls);
  console.log(`${o.variante} (${o.metade}): estrita ${fmt(taxaDe(c, acerto1(ESTRITA)))}; equivalência ${fmt(taxaDe(c, acerto1(TODAS_AS_CAMADAS)))}; top-2 ${fmt(taxaDe(c, acertoK(2, TODAS_AS_CAMADAS)))}; ${pct(ls.length / Math.max(1, pedidos.length))} respondidos.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  principal().catch((erro) => {
    console.error((erro as Error).message);
    process.exit(1);
  });
}

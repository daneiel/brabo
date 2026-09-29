/**
 * `pnpm --filter @brabo/scripts idioma:revisar` — recalcula o veredito do
 * limiar da AT-169 com os rótulos da REVISÃO HUMANA das respostas da validação
 * paga (AT-167), sem chamar rede nem gastar nada.
 *
 *   --saida <pasta>   onde estão `respostas.jsonl`, `revisao-feita.md` e (opcional)
 *                     `amostra-lida.md` (padrão: $XDG_CACHE_HOME/brabo/validacao-idioma/2026-09-29/)
 *
 * Os arquivos de rótulo moram FORA do git, com as respostas. Cada entrada de
 * `revisao-feita.md` repete o cabeçalho de `revisao.md` e acrescenta uma linha
 * `revisão: idioma=<pt|es|en|misto> · correta=<sim|nao|formulario|c11> · motivo: …`:
 *   - `sim` / `nao`: a resposta está / não está no idioma esperado;
 *   - `formulario`: a PROSA está no idioma esperado, mas as perguntas do formulário
 *     estruturado (`ask_structured_questions`) saíram em outro idioma;
 *   - `c11`: tradução para o inglês dentro de uma moldura em português — a decisão
 *     sobre a semântica é do dono, então o relatório mostra as DUAS leituras.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { dentroDoRepositorio } from './corpus.ts';
import type { Resposta } from './validacao.ts';

export type Correta = 'sim' | 'nao' | 'formulario' | 'c11';

export interface Rotulo {
  /** Idioma REAL do texto que o usuário lê. */
  idioma: string;
  correta: Correta;
  /** Só no `c11`: a tradução está no texto gravado? (só a última mensagem do turno é guardada). */
  traducao: 'presente' | 'ausente' | null;
  motivo: string;
}

export interface Leitura {
  /** Tradução em inglês dentro de moldura em português conta como acerto? */
  c11: boolean;
  /** Prosa no idioma certo com o formulário em outro conta como acerto? */
  formulario: boolean;
}

export const chaveDe = (r: Pick<Resposta, 'caso' | 'modelo' | 'braco' | 'rodada' | 'sessao' | 'turno'>): string =>
  `${r.caso}|${r.modelo}|${r.braco}|${r.rodada}|${r.sessao}|${r.turno}`;

const CABECALHO = /^## (C\d\d) · (\S+) · (baseline|tratamento) · rodada (\d+) · sessão (\d+) · turno (\d+)$/;
const LINHA = /^revisão: idioma=(\S+) · correta=(sim|nao|formulario|c11)(?: · traducao=(presente|ausente))? · motivo: (.*)$/;

/** Lê `revisao-feita.md` (ou `amostra-lida.md`): chave da resposta → rótulo. Entrada malformada LANÇA. */
export function lerRotulos(md: string): Map<string, Rotulo> {
  const out = new Map<string, Rotulo>();
  let chave: string | null = null;
  for (const linha of md.split('\n')) {
    const h = linha.match(CABECALHO);
    if (h) {
      chave = `${h[1]}|${h[2]}|${h[3]}|${h[4]}|${h[5]}|${h[6]}`;
      continue;
    }
    if (!linha.startsWith('revisão:')) continue;
    const m = linha.match(LINHA);
    if (!m || chave === null) throw new Error(`revisão: linha de rótulo malformada ou sem cabeçalho: ${linha.slice(0, 80)}`);
    if (out.has(chave)) throw new Error(`revisão: rótulo duplicado para ${chave}`);
    const correta = m[2] as Correta;
    if (correta === 'c11' && !m[3]) throw new Error(`revisão: c11 sem traducao=presente|ausente em ${chave}`);
    out.set(chave, { idioma: m[1] as string, correta, traducao: (m[3] as 'presente' | 'ausente' | undefined) ?? null, motivo: m[4] as string });
    chave = null;
  }
  return out;
}

export interface Rotulada {
  resposta: Resposta;
  rotulo: Rotulo;
  /** `humano`: veio da revisão; `classificador`: concordante não lida (vale o veredito). */
  fonte: 'humano' | 'classificador';
}

/**
 * Junta as respostas aos rótulos. Toda resposta marcada para revisão TEM de ter
 * rótulo (senão a revisão está incompleta e lança); a concordante não marcada
 * vale pelo classificador — o erro dessa suposição é o que a amostra mede.
 */
export function rotular(respostas: readonly Resposta[], rotulos: ReadonlyMap<string, Rotulo>): Rotulada[] {
  return respostas.map((r) => {
    const rotulo = rotulos.get(chaveDe(r));
    if (rotulo) return { resposta: r, rotulo, fonte: 'humano' as const };
    if (r.revisar) throw new Error(`revisão incompleta: falta o rótulo de ${chaveDe(r)}`);
    if (r.veredito !== r.esperado) throw new Error(`resposta divergente sem marca de revisão: ${chaveDe(r)}`);
    return { resposta: r, rotulo: { idioma: r.esperado, correta: 'sim' as const, traducao: null, motivo: 'concordante não lida' }, fonte: 'classificador' as const };
  });
}

export function acertou(c: Correta, leitura: Leitura): boolean {
  if (c === 'sim') return true;
  if (c === 'nao') return false;
  return c === 'c11' ? leitura.c11 : leitura.formulario;
}

/** Intervalo de Wilson a 95%. */
export function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.959964;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

export interface VeredictoRevisado {
  modelo: string;
  /** Respostas em espanhol onde pt-BR era esperado (idioma REAL, braço tratado, todos os casos). */
  espanholQuandoPt: number;
  acerto: number;
  n: number;
  taxa: number;
  ic: [number, number];
  aprovado: boolean;
}

/** O limiar da AT-169 (braço tratado, C01–C04 e C06–C15) sobre os rótulos revisados. */
export function veredictoRevisado(rot: readonly Rotulada[], modelo: string, leitura: Leitura): VeredictoRevisado {
  const tratadas = rot.filter((x) => x.resposta.modelo === modelo && x.resposta.braco === 'tratamento');
  const espanholQuandoPt = tratadas.filter((x) => x.resposta.esperado === 'pt' && x.rotulo.idioma === 'es').length;
  const limiar = tratadas.filter((x) => x.resposta.noLimiar);
  const acerto = limiar.filter((x) => acertou(x.rotulo.correta, leitura)).length;
  const taxa = limiar.length === 0 ? 0 : acerto / limiar.length;
  return {
    modelo,
    espanholQuandoPt,
    acerto,
    n: limiar.length,
    taxa,
    ic: wilson(acerto, limiar.length),
    aprovado: limiar.length > 0 && espanholQuandoPt === 0 && taxa >= 0.95,
  };
}

export interface ErroDoClassificador {
  /** Respostas marcadas e lidas. */
  lidas: number;
  /** O classificador disse "acertou" e o humano disse "nao" / "formulario". */
  falsosPositivos: number;
  /** O classificador disse "não acertou" (erro ou indeterminado) e o humano disse "sim". */
  falsosNegativos: number;
  /** Veredito definitivo (pt/es/en, não `indeterminado`) do classificador nas lidas, e quantos o humano contradisse. */
  definitivasLidas: number;
  definitivasContrariadas: number;
  /** Caiu no C11: o classificador não tem como acertar (é decisão de semântica). */
  c11: number;
  /** Os indeterminados lidos e como a leitura os resolveu. */
  indeterminados: Record<Correta, number>;
}

export function erroDoClassificador(rot: readonly Rotulada[]): ErroDoClassificador {
  const lidas = rot.filter((x) => x.fonte === 'humano');
  const clfAcerta = (x: Rotulada) => x.resposta.veredito === x.resposta.esperado;
  return {
    lidas: lidas.length,
    falsosPositivos: lidas.filter((x) => clfAcerta(x) && (x.rotulo.correta === 'nao' || x.rotulo.correta === 'formulario')).length,
    falsosNegativos: lidas.filter((x) => !clfAcerta(x) && x.rotulo.correta === 'sim').length,
    definitivasLidas: lidas.filter((x) => x.resposta.veredito !== 'indeterminado' && x.resposta.veredito !== 'falha' && x.rotulo.correta !== 'c11').length,
    definitivasContrariadas: lidas.filter(
      (x) =>
        x.resposta.veredito !== 'indeterminado' &&
        x.resposta.veredito !== 'falha' &&
        x.rotulo.correta !== 'c11' &&
        clfAcerta(x) !== (x.rotulo.correta === 'sim'),
    ).length,
    c11: lidas.filter((x) => x.rotulo.correta === 'c11').length,
    indeterminados: (['sim', 'nao', 'formulario', 'c11'] as const).reduce(
      (acc, c) => ({ ...acc, [c]: lidas.filter((x) => x.resposta.veredito === 'indeterminado' && x.rotulo.correta === c).length }),
      {} as Record<Correta, number>,
    ),
  };
}

export interface CelulaRevisada {
  n: number;
  sim: number;
  nao: number;
  formulario: number;
  c11: number;
  espanhol: number;
}

export function tabelaRevisada(rot: readonly Rotulada[]): Map<string, CelulaRevisada> {
  const m = new Map<string, CelulaRevisada>();
  for (const x of rot) {
    const k = `${x.resposta.caso}|${x.resposta.modelo}|${x.resposta.braco}`;
    const c = m.get(k) ?? { n: 0, sim: 0, nao: 0, formulario: 0, c11: 0, espanhol: 0 };
    c.n++;
    c[x.rotulo.correta]++;
    if (x.rotulo.idioma === 'es' && x.resposta.esperado === 'pt') c.espanhol++;
    m.set(k, c);
  }
  return m;
}

const pct = (a: number, n: number) => (n === 0 ? '—' : `${((100 * a) / n).toFixed(1)}%`);
const faixa = (ic: [number, number]) => `${(100 * ic[0]).toFixed(1)}–${(100 * ic[1]).toFixed(1)}%`;

export function relatorioRevisado(rot: readonly Rotulada[], amostra: ReadonlyMap<string, Rotulo> | null): string {
  const modelos = [...new Set(rot.map((x) => x.resposta.modelo))];
  const L: string[] = [];
  const e = erroDoClassificador(rot);
  L.push('## Respostas lidas (marcadas para revisão)', '');
  const lidas = rot.filter((x) => x.fonte === 'humano');
  const cont = (c: Correta) => lidas.filter((x) => x.rotulo.correta === c).length;
  L.push(`Lidas: ${lidas.length}. Corretas: ${cont('sim')}. Incorretas: ${cont('nao')}. Prosa certa com formulário em outro idioma: ${cont('formulario')}. C11 (decisão do dono): ${cont('c11')}.`, '');
  L.push('## Erro do classificador (sobre as lidas)', '');
  L.push(`Veredito definitivo (pt/es/en) do classificador nas lidas: ${e.definitivasLidas}; contrariado pela leitura: ${e.definitivasContrariadas}. Nesta conta o "formulário" conta como contradição de um "acertou".`, '');
  L.push(`Falsos positivos (disse "acertou", humano disse não): ${e.falsosPositivos}. Falsos negativos (disse "não acertou", humano disse sim): ${e.falsosNegativos}. C11 (o classificador não tem certo/errado aqui): ${e.c11}. Indeterminados lidos: ${Object.values(e.indeterminados).reduce((a, b) => a + b, 0)} — ${e.indeterminados.sim} eram corretos, ${e.indeterminados.nao} incorretos, ${e.indeterminados.formulario} prosa certa com formulário em outro idioma, ${e.indeterminados.c11} C11.`, '');
  if (amostra) {
    const n = amostra.size;
    const erradas = [...amostra.values()].filter((r) => r.correta !== 'sim').length;
    L.push(`Amostra de não marcadas: ${n} lidas, ${erradas} divergentes do classificador (taxa ${pct(erradas, n)}, IC de Wilson ${faixa(wilson(erradas, n))}).`, '');
  }
  L.push('## Por caso × braço × modelo (rótulos revisados)', '');
  L.push('| caso | modelo | braço | n | sim | não | formulário | c11 | espanhol c/ pt esperado |', '|---|---|---|---|---|---|---|---|---|');
  const t = tabelaRevisada(rot);
  const casos = [...new Set(rot.map((x) => x.resposta.caso))].sort();
  for (const caso of casos)
    for (const m of modelos)
      for (const b of ['baseline', 'tratamento'] as const) {
        const c = t.get(`${caso}|${m}|${b}`);
        if (c) L.push(`| ${caso} | ${m} | ${b} | ${c.n} | ${c.sim} | ${c.nao} | ${c.formulario} | ${c.c11} | ${c.espanhol} |`);
      }
  L.push('', '## Limiar da AT-169 por modelo, nas leituras (braço tratado, C01–C04 e C06–C15)', '');
  L.push('| modelo | C11 conta | formulário conta | acertos | taxa | IC 95% | espanhol c/ pt | veredito |', '|---|---|---|---|---|---|---|---|');
  for (const m of modelos)
    for (const c11 of [true, false])
      for (const formulario of [true, false]) {
        const v = veredictoRevisado(rot, m, { c11, formulario });
        L.push(`| ${m} | ${c11 ? 'sim' : 'não'} | ${formulario ? 'sim' : 'não'} | ${v.acerto}/${v.n} | ${pct(v.acerto, v.n)} | ${faixa(v.ic)} | ${v.espanholQuandoPt} | ${v.aprovado ? 'passa' : 'não passa'} |`);
      }
  return L.join('\n');
}

function lerJsonl<T>(arq: string): T[] {
  return readFileSync(arq, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
}

function main(): void {
  const args = process.argv.slice(2);
  let saida = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'brabo', 'validacao-idioma', '2026-09-29');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--saida') saida = resolve(args[++i] ?? '');
    else throw new Error(`opção desconhecida: ${args[i]}`);
  }
  if (dentroDoRepositorio(saida)) throw new Error('a saída mora FORA do checkout (as respostas não entram no git)');
  const respostas = lerJsonl<Resposta>(join(saida, 'respostas.jsonl'));
  const rotulos = lerRotulos(readFileSync(join(saida, 'revisao-feita.md'), 'utf8'));
  const arqAmostra = join(saida, 'amostra-lida.md');
  const amostra = existsSync(arqAmostra) ? lerRotulos(readFileSync(arqAmostra, 'utf8')) : null;
  console.log(relatorioRevisado(rotular(respostas, rotulos), amostra));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

/**
 * O instrumento da AT-160: roda a heurística da AT-080 contra um corpus
 * rotulado e devolve os números de onde saem os limiares da AT-163.
 *
 * Régua de acerto (a MESMA para todo item):
 *   - rótulo `pt`/`es`/`en` → acerto é o veredito ser essa língua;
 *   - rótulo `und`/`mul` ou língua FORA das três (a lista é aberta, AT-168) →
 *     acerto é `indeterminado`, porque é o único veredito correto que uma
 *     heurística de três línguas pode dar sobre elas.
 * E dois tipos de falha que NÃO se somam: `indeterminado` num item decidível é
 * PERDA DE COBERTURA (a preferência conhecida fica — AT-080, "texto curto ou
 * inconclusivo preserva a preferência"); veredito de língua ERRADA é ERRO, o
 * único que muda o que o agente faz. `falso es` é contado à parte: é o defeito
 * que o épico existe para eliminar.
 *
 * O relatório nunca imprime o TEXTO de um item — só id, rótulo e caso —, para
 * que a saída do corpus real possa ser colada num PR sem levar mensagem junto.
 */
import {
  avaliarSequencia,
  classificar,
  IDIOMAS,
  type Classificacao,
  type Idioma,
  type Marcadores,
  type Parametros,
  type Veredito,
} from './heuristica.ts';
import { linguaDoRotulo, type ItemDoCorpus } from './corpus.ts';

export const COLUNAS: readonly Veredito[] = ['pt', 'es', 'en', 'indeterminado'];

export function esperadoDe(rotulo: string): Veredito {
  const l = linguaDoRotulo(rotulo);
  return (IDIOMAS as readonly string[]).includes(l) ? (l as Idioma) : 'indeterminado';
}

export interface Linha {
  item: ItemDoCorpus;
  rotulo: string;
  esperado: Veredito;
  c: Classificacao;
}

export function avaliarItens(itens: readonly ItemDoCorpus[], m: Marcadores, p: Parametros): Linha[] {
  return itens
    .filter((i): i is ItemDoCorpus & { idioma: string } => typeof i.idioma === 'string' && i.idioma !== '')
    .map((item) => {
      const rotulo = linguaDoRotulo(item.idioma);
      return { item, rotulo, esperado: esperadoDe(rotulo), c: classificar(item.texto, m, p) };
    });
}

export interface Contagem {
  n: number;
  acerto: number;
  indeterminado: number;
  erro: number;
  falsoEs: number;
}

function vazia(): Contagem {
  return { n: 0, acerto: 0, indeterminado: 0, erro: 0, falsoEs: 0 };
}

function somar(c: Contagem, l: Linha): void {
  c.n += 1;
  const v = l.c.veredito;
  if (v === l.esperado) c.acerto += 1;
  else if (v === 'indeterminado') c.indeterminado += 1;
  else c.erro += 1;
  if (v === 'es' && l.rotulo !== 'es') c.falsoEs += 1;
}

export function contar(linhas: readonly Linha[]): Contagem {
  const c = vazia();
  for (const l of linhas) somar(c, l);
  return c;
}

export function agrupar(linhas: readonly Linha[], chave: (l: Linha) => string): Map<string, Contagem> {
  const mapa = new Map<string, Contagem>();
  for (const l of linhas) {
    const k = chave(l);
    if (!mapa.has(k)) mapa.set(k, vazia());
    somar(mapa.get(k)!, l);
  }
  return new Map([...mapa.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** Rótulo (linha) × veredito (coluna). */
export function matrizDeConfusao(linhas: readonly Linha[]): Map<string, Record<Veredito, number>> {
  const m = new Map<string, Record<Veredito, number>>();
  for (const l of linhas) {
    if (!m.has(l.rotulo)) m.set(l.rotulo, { pt: 0, es: 0, en: 0, indeterminado: 0 });
    m.get(l.rotulo)![l.c.veredito] += 1;
  }
  return new Map([...m.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export const FAIXAS: readonly [number, number][] = [
  [0, 0.5],
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 0.8],
  [0.8, 0.9],
  [0.9, 1],
  [1, 1.0001],
];

export interface Faixa {
  de: number;
  ate: number;
  n: number;
  /** A língua de maior pontuação É o rótulo. */
  vencedoraCerta: number;
  /** A vencedora é uma língua e o rótulo é outra coisa (outra língua, und, mul). */
  vencedoraErrada: number;
}

/**
 * Taxa de acerto da VENCEDORA CRUA por faixa de confiança — antes de limiar,
 * margem e evidência mínima. É a curva de onde o limiar se lê: acima de qual
 * confiança a vencedora passa a acertar o bastante para mudar alguma coisa.
 * Item sem ponto nenhum (confiança indefinida) fica de fora.
 */
export function faixasDeConfianca(linhas: readonly Linha[]): Faixa[] {
  return FAIXAS.map(([de, ate]) => {
    const dentro = linhas.filter((l) => l.c.vencedora !== null && l.c.confianca >= de && l.c.confianca < ate);
    const certa = dentro.filter((l) => l.c.vencedora === l.rotulo).length;
    return { de, ate, n: dentro.length, vencedoraCerta: certa, vencedoraErrada: dentro.length - certa };
  });
}

export interface PontoDaVarredura {
  limiar: number;
  minPalavras: number;
  /** Itens decidíveis (rótulo pt/es/en) que receberam veredito de língua. */
  cobertura: number;
  decidiveis: number;
  /** Vereditos de língua errados, sobre TODOS os itens. */
  erros: number;
  decididos: number;
  falsoEs: number;
}

export function varredura(
  itens: readonly ItemDoCorpus[],
  m: Marcadores,
  base: Parametros,
  limiares: readonly number[] = [0.5, 0.6, 0.7, 0.8, 0.9, 1],
  minimos: readonly number[] = [0, 3, 5, 10, 20],
): PontoDaVarredura[] {
  const pontos: PontoDaVarredura[] = [];
  for (const minPalavras of minimos) {
    for (const limiar of limiares) {
      const linhas = avaliarItens(itens, m, { ...base, limiar, minPalavras });
      const decidiveis = linhas.filter((l) => l.esperado !== 'indeterminado');
      const decididos = linhas.filter((l) => l.c.veredito !== 'indeterminado');
      pontos.push({
        limiar,
        minPalavras,
        decidiveis: decidiveis.length,
        cobertura: decidiveis.filter((l) => l.c.veredito === l.esperado).length,
        decididos: decididos.length,
        erros: decididos.filter((l) => l.c.veredito !== l.esperado).length,
        falsoEs: decididos.filter((l) => l.c.veredito === 'es' && l.rotulo !== 'es').length,
      });
    }
  }
  return pontos;
}

/**
 * Item decidível cuja limpeza tirou mais da metade das palavras — o item 3 da
 * inspeção futura da AT-080 ("a limpeza não apaga português legítimo?").
 */
export function limpezaAgressiva(linhas: readonly Linha[], fracao = 0.5): Linha[] {
  return linhas.filter(
    (l) => l.esperado !== 'indeterminado' && l.c.palavrasAntes > 0 && l.c.palavras / l.c.palavrasAntes < fracao,
  );
}

// ------------------------------------------------------------- sequências

export interface Sequencia {
  id: string;
  descricao?: string;
  inicial: Idioma | null;
  esperadoFinal: Idioma | null;
  trocasMaximas: number;
  mensagens: string[];
}

export interface ResultadoDeSequencia {
  id: string;
  mensagens: number;
  final: Idioma | null;
  esperadoFinal: Idioma | null;
  trocas: number;
  trocasMaximas: number;
  ok: boolean;
  /** Vereditos da amostra a cada mensagem, para ver a trajetória. */
  trajetoria: string;
}

export function avaliarSequencias(
  sequencias: readonly Sequencia[],
  m: Marcadores,
  p: Parametros,
): ResultadoDeSequencia[] {
  return sequencias.map((s) => {
    const passos = avaliarSequencia(s.mensagens, m, p, s.inicial);
    const final = passos.length ? passos[passos.length - 1]!.estado : s.inicial;
    const trocas = passos.filter((x) => x.trocou).length;
    return {
      id: s.id,
      mensagens: s.mensagens.length,
      final,
      esperadoFinal: s.esperadoFinal,
      trocas,
      trocasMaximas: s.trocasMaximas,
      ok: final === s.esperadoFinal && trocas <= s.trocasMaximas,
      trajetoria: passos.map((x) => (x.classificacao.veredito === 'indeterminado' ? '·' : x.classificacao.veredito)).join(' '),
    };
  });
}

/**
 * Corpus REAL em sequência: agrupa por autor (`grupo`), ordena por instante e
 * reproduz a detecção como a api faria. Não há "esperado" por mensagem aqui —
 * o que se mede é ESTABILIDADE (quantas trocas) e para onde a detecção vai.
 * O autor sai como "autor 1, 2…", nunca com o id.
 */
export function sequenciasDoCorpusReal(itens: readonly ItemDoCorpus[]): Sequencia[] {
  const porAutor = new Map<string, ItemDoCorpus[]>();
  for (const i of itens) {
    if (i.origem !== 'real' || !i.grupo) continue;
    if (!porAutor.has(i.grupo)) porAutor.set(i.grupo, []);
    porAutor.get(i.grupo)!.push(i);
  }
  return [...porAutor.values()].map((lista, n) => {
    lista.sort((a, b) => (a.em ?? '').localeCompare(b.em ?? ''));
    const rotulos = lista.map((i) => (i.idioma ? esperadoDe(i.idioma) : 'indeterminado'));
    const contagem = new Map<string, number>();
    for (const r of rotulos) if (r !== 'indeterminado') contagem.set(r, (contagem.get(r) ?? 0) + 1);
    const maioria = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as Idioma | undefined;
    return {
      id: `autor ${n + 1}`,
      inicial: null,
      esperadoFinal: maioria ?? null,
      trocasMaximas: 1,
      mensagens: lista.map((i) => i.texto),
    };
  });
}

// -------------------------------------------------------------------- CPU

export interface Custo {
  mensagens: number;
  caracteres: number;
  microsPorMensagem: number;
  microsPorMilCaracteres: number;
  /** Custo de uma avaliação no formato de produção: a amostra de 10 mensagens. */
  microsPorAvaliacaoDaAmostra: number;
}

export function medirCusto(itens: readonly ItemDoCorpus[], m: Marcadores, p: Parametros, repeticoes = 50): Custo {
  const textos = itens.map((i) => i.texto);
  const caracteres = textos.reduce((s, t) => s + t.length, 0);
  for (const t of textos) classificar(t, m, p); // aquecimento do JIT
  const t0 = process.hrtime.bigint();
  for (let r = 0; r < repeticoes; r++) for (const t of textos) classificar(t, m, p);
  const nsTotal = Number(process.hrtime.bigint() - t0);
  const porMensagem = nsTotal / (repeticoes * textos.length) / 1000;

  const amostra = textos.slice(0, p.janelaMensagens);
  avaliarSequencia(amostra, m, p);
  const t1 = process.hrtime.bigint();
  for (let r = 0; r < repeticoes; r++) avaliarSequencia(amostra, m, p);
  // avaliarSequencia avalia a janela UMA vez por mensagem: dividir pelo número
  // de mensagens dá o custo de UMA avaliação da amostra (a que roda a cada
  // mensagem nova do usuário).
  const porAvaliacao = Number(process.hrtime.bigint() - t1) / (repeticoes * amostra.length) / 1000;
  return {
    mensagens: textos.length,
    caracteres,
    microsPorMensagem: porMensagem,
    microsPorMilCaracteres: nsTotal / (repeticoes * caracteres) / 1000 * 1000,
    microsPorAvaliacaoDaAmostra: porAvaliacao,
  };
}

// --------------------------------------------------------------- relatório

const pct = (a: number, b: number): string => (b === 0 ? '—' : `${((100 * a) / b).toFixed(1)}%`);

function tabela(cabecalho: string[], linhas: (string | number)[][]): string {
  return [
    `| ${cabecalho.join(' | ')} |`,
    `|${cabecalho.map(() => '---').join('|')}|`,
    ...linhas.map((l) => `| ${l.join(' | ')} |`),
  ].join('\n');
}

export function relatorioDeContagem(titulo: string, mapa: Map<string, Contagem>): string {
  return [
    `**${titulo}**`,
    '',
    tabela(
      ['grupo', 'n', 'acerto', 'indeterminado (mantém o conhecido)', 'erro (língua errada)', 'falso `es`'],
      [...mapa.entries()].map(([k, c]) => [
        k,
        c.n,
        `${c.acerto} (${pct(c.acerto, c.n)})`,
        `${c.indeterminado} (${pct(c.indeterminado, c.n)})`,
        `${c.erro} (${pct(c.erro, c.n)})`,
        c.falsoEs,
      ]),
    ),
  ].join('\n');
}

export function relatorioDaMatriz(matriz: Map<string, Record<Veredito, number>>): string {
  return [
    '**Matriz de confusão** (linha = rótulo, coluna = veredito)',
    '',
    tabela(
      ['rótulo', ...COLUNAS],
      [...matriz.entries()].map(([r, v]) => [r, ...COLUNAS.map((c) => v[c])]),
    ),
  ].join('\n');
}

export function relatorioDasFaixas(faixas: readonly Faixa[]): string {
  return [
    '**Vencedora crua por faixa de confiança** (sem limiar, margem nem evidência mínima)',
    '',
    tabela(
      ['confiança', 'n', 'vencedora = rótulo', 'vencedora ≠ rótulo'],
      faixas.map((f) => [
        f.de === 1 ? '= 1,0' : `[${f.de.toFixed(1)}, ${f.ate.toFixed(1)})`,
        f.n,
        `${f.vencedoraCerta} (${pct(f.vencedoraCerta, f.n)})`,
        `${f.vencedoraErrada} (${pct(f.vencedoraErrada, f.n)})`,
      ]),
    ),
  ].join('\n');
}

export function relatorioDaVarredura(pontos: readonly PontoDaVarredura[]): string {
  return [
    '**Varredura limiar × evidência mínima** (margem fixa no candidato)',
    '',
    tabela(
      ['evidência mínima', 'limiar', 'cobertura (decidíveis certos)', 'erro entre decididos', 'falso `es`'],
      pontos.map((p) => [
        p.minPalavras,
        p.limiar.toFixed(1),
        `${p.cobertura}/${p.decidiveis} (${pct(p.cobertura, p.decidiveis)})`,
        `${p.erros}/${p.decididos} (${pct(p.erros, p.decididos)})`,
        p.falsoEs,
      ]),
    ),
  ].join('\n');
}

export function relatorioDasSequencias(r: readonly ResultadoDeSequencia[]): string {
  return [
    '**Sequências** (amostra de N mensagens + histerese; `·` = indeterminado)',
    '',
    tabela(
      ['sequência', 'msgs', 'esperado', 'final', 'trocas (máx.)', 'ok', 'veredito da amostra a cada mensagem'],
      r.map((x) => [
        x.id,
        x.mensagens,
        x.esperadoFinal ?? '—',
        x.final ?? '—',
        `${x.trocas} (${x.trocasMaximas})`,
        x.ok ? 'sim' : '**não**',
        x.trajetoria,
      ]),
    ),
  ].join('\n');
}

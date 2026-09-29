/**
 * `pnpm --filter @brabo/scripts idioma:medir` — imprime em Markdown os números
 * da heurística de idioma da AT-080 contra um corpus rotulado (AT-160).
 *
 *   --corpus <arquivo.jsonl>   corpus a medir (repetível; padrão: o sintético)
 *   --real                     acrescenta o corpus REAL da máquina
 *                              ($XDG_CACHE_HOME/brabo/corpus-idioma/mensagens.jsonl)
 *   --variante at080|ampliada|todas   (padrão: todas)
 *   --sem-cpu                  omite a medição de CPU (saída determinística)
 *
 * A saída NUNCA contém o texto de um item, só ids, rótulos e contagens.
 */
import { existsSync, readFileSync } from 'node:fs';
import { PARAMETROS_AT080, VARIANTES, type Marcadores } from './heuristica.ts';
import { CORPUS_SINTETICO, SEQUENCIAS_SINTETICAS, corpusRealPadrao, lerCorpus, type ItemDoCorpus } from './corpus.ts';
import {
  agrupar,
  avaliarItens,
  avaliarSequencias,
  contar,
  faixasDeConfianca,
  limpezaAgressiva,
  matrizDeConfusao,
  medirCusto,
  relatorioDaMatriz,
  relatorioDasFaixas,
  relatorioDasSequencias,
  relatorioDaVarredura,
  relatorioDeContagem,
  sequenciasDoCorpusReal,
  varredura,
  type Sequencia,
} from './medicao.ts';

export interface Opcoes {
  corpora: string[];
  real: boolean;
  variantes: Marcadores[];
  cpu: boolean;
}

export function lerOpcoes(argv: readonly string[]): Opcoes {
  const corpora: string[] = [];
  let real = false;
  let variante = 'todas';
  let cpu = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue; // `pnpm run x -- --flag` repassa o `--`
    if (a === '--corpus') corpora.push(argv[++i] ?? '');
    else if (a === '--real') real = true;
    else if (a === '--variante') variante = argv[++i] ?? '';
    else if (a === '--sem-cpu') cpu = false;
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  const variantes =
    variante === 'todas' ? Object.values(VARIANTES) : VARIANTES[variante] ? [VARIANTES[variante]!] : [];
  if (variantes.length === 0) throw new Error(`variante desconhecida: ${variante} (at080, ampliada ou todas)`);
  if (corpora.length === 0 && !real) corpora.push(CORPUS_SINTETICO);
  if (real) corpora.push(corpusRealPadrao());
  return { corpora, real, variantes, cpu };
}

export function relatorio(itens: readonly ItemDoCorpus[], sequencias: readonly Sequencia[], o: Opcoes): string {
  const p = PARAMETROS_AT080;
  const rotulados = itens.filter((i) => typeof i.idioma === 'string' && i.idioma !== '');
  const partes: string[] = [
    '## Medição da heurística de idioma (AT-160)',
    '',
    `Itens: ${itens.length} (rotulados: ${rotulados.length}, sem rótulo: ${itens.length - rotulados.length}). ` +
      `Parâmetros candidatos da AT-080: evidência mínima ${p.minPalavras} palavras, limiar ${p.limiar}, ` +
      `margem ${p.margem}, amostra ${p.janelaMensagens} mensagens / ${p.janelaCaracteres} caracteres, ` +
      `histerese ${p.histerese}.`,
  ];
  for (const m of o.variantes) {
    const linhas = avaliarItens(rotulados, m, p);
    const total = contar(linhas);
    partes.push(
      '',
      `### Variante \`${m.nome}\``,
      '',
      `Total: ${total.acerto}/${total.n} acertos, ${total.indeterminado} indeterminados em item decidível ou não, ` +
        `${total.erro} erros de língua, ${total.falsoEs} falso \`es\`.`,
      '',
      relatorioDeContagem('Por idioma (os parâmetros candidatos, por mensagem isolada)', agrupar(linhas, (l) => l.rotulo)),
      '',
      relatorioDeContagem('Por caso', agrupar(linhas, (l) => l.item.caso ?? '(sem caso)')),
      '',
      relatorioDaMatriz(matrizDeConfusao(linhas)),
      '',
      relatorioDasFaixas(faixasDeConfianca(linhas)),
      '',
      relatorioDaVarredura(varredura(rotulados, m, p)),
    );
    const erros = linhas.filter((l) => l.c.veredito !== 'indeterminado' && l.c.veredito !== l.esperado);
    partes.push(
      '',
      `**Erros de língua (parâmetros candidatos):** ${erros.length}` +
        (erros.length ? ` — ${erros.map((l) => `${l.item.id} (${l.rotulo} → ${l.c.veredito})`).join(', ')}` : ''),
    );
    const agressiva = limpezaAgressiva(linhas);
    partes.push(
      '',
      `**Limpeza que apagou mais da metade das palavras de um item decidível:** ${agressiva.length}` +
        (agressiva.length ? ` — ${agressiva.map((l) => `${l.item.id} (${l.rotulo}, ${l.c.palavras}/${l.c.palavrasAntes})`).join(', ')}` : ''),
    );
    if (sequencias.length) {
      partes.push('', relatorioDasSequencias(avaliarSequencias(sequencias, m, p)));
    }
    if (o.cpu && itens.length) {
      const c = medirCusto(itens, m, p);
      partes.push(
        '',
        `**CPU** (${c.mensagens} mensagens, ${c.caracteres} caracteres; varia com a máquina): ` +
          `${c.microsPorMensagem.toFixed(1)} µs por mensagem, ${c.microsPorMilCaracteres.toFixed(1)} µs por mil caracteres, ` +
          `${c.microsPorAvaliacaoDaAmostra.toFixed(1)} µs por avaliação da amostra de ${p.janelaMensagens} mensagens.`,
      );
    }
  }
  return partes.join('\n') + '\n';
}

function principal(): void {
  const o = lerOpcoes(process.argv.slice(2));
  const itens: ItemDoCorpus[] = [];
  for (const c of o.corpora) {
    if (!existsSync(c)) {
      console.error(
        `corpus não encontrado: ${c}` +
          (o.real ? '\nExtraia antes: pnpm --filter @brabo/scripts idioma:extrair -- --container <postgres>' : ''),
      );
      process.exit(2);
    }
    itens.push(...lerCorpus(c));
  }
  const sequencias: Sequencia[] = [];
  if (o.corpora.includes(CORPUS_SINTETICO)) {
    sequencias.push(...(JSON.parse(readFileSync(SEQUENCIAS_SINTETICAS, 'utf8')) as { sequencias: Sequencia[] }).sequencias);
  }
  sequencias.push(...sequenciasDoCorpusReal(itens));
  process.stdout.write(relatorio(itens, sequencias, o));
}

if (import.meta.url === `file://${process.argv[1]}`) principal();

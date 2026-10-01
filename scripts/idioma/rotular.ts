/**
 * `pnpm --filter @brabo/scripts idioma:rotular -- --padrao pt-BR` — rotulagem
 * assistida do corpus REAL (AT-160), no terminal, item a item.
 *
 *   --padrao <código>   o rótulo que ENTER aceita (o idioma em que você costuma
 *                       escrever). Sem ele, ENTER não aceita nada.
 *   --corpus <arquivo>  padrão: $XDG_CACHE_HOME/brabo/corpus-idioma/mensagens.jsonl
 *
 * Por item: ENTER aceita o padrão; um código BCP-47 (`pt-BR`, `es`, `en`,
 * `fr`…) rotula com ele; `und` = não há idioma a decidir ("ok", só código, só
 * log); `mul` = misto sem língua dominante; `p` pula; `q` grava e sai. Grava a
 * cada resposta, então parar no meio não perde nada.
 *
 * A assistência NÃO é o palpite da heurística, de propósito: mostrar o que a
 * heurística acha e aceitar com ENTER ancoraria o rótulo na coisa que o rótulo
 * existe para medir, e a acurácia no corpus real sairia inflada. O padrão é o
 * idioma do DONO, que ele declara.
 */
import { createInterface } from 'node:readline/promises';
import { corpusRealPadrao, escreverCorpus, lerCorpus } from './corpus.ts';

const CODIGO = /^(und|mul|[a-z]{2,3}(-[a-z0-9]{2,8})*)$/i;

export type Resposta = { tipo: 'rotulo'; valor: string } | { tipo: 'pular' } | { tipo: 'sair' } | { tipo: 'invalida' };

export function interpretar(entrada: string, padrao?: string): Resposta {
  const e = entrada.trim();
  if (e === '') return padrao ? { tipo: 'rotulo', valor: padrao } : { tipo: 'invalida' };
  if (e === 'q') return { tipo: 'sair' };
  if (e === 'p') return { tipo: 'pular' };
  return CODIGO.test(e) ? { tipo: 'rotulo', valor: e } : { tipo: 'invalida' };
}

async function principal(): Promise<void> {
  const argv = process.argv.slice(2);
  let padrao: string | undefined;
  let caminho = corpusRealPadrao();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--') continue; // `pnpm run x -- --flag` repassa o `--`
    else if (argv[i] === '--padrao') padrao = argv[++i];
    else if (argv[i] === '--corpus') caminho = argv[++i] ?? caminho;
    else {
      console.error(`argumento desconhecido: ${argv[i]}`);
      process.exit(2);
    }
  }
  if (padrao && !CODIGO.test(padrao)) {
    console.error(`--padrao ${padrao} não é um código de idioma (ex.: pt-BR, en, und)`);
    process.exit(2);
  }
  const itens = lerCorpus(caminho);
  const pendentes = itens.filter((i) => !i.idioma);
  console.log(`${pendentes.length} de ${itens.length} sem rótulo. ENTER = ${padrao ?? '(sem padrão)'}; código; und; mul; p = pular; q = sair.`);
  // Iterador de linhas, e não `rl.question`: com a entrada vinda de um pipe,
  // linhas que chegam antes da pergunta seguinte seriam descartadas.
  const rl = createInterface({ input: process.stdin });
  const linhas = rl[Symbol.asyncIterator]();
  const perguntar = async (prompt: string): Promise<string | null> => {
    process.stdout.write(prompt);
    const r = await linhas.next();
    return r.done ? null : r.value;
  };
  let feitos = 0;
  try {
    for (const item of pendentes) {
      const texto = item.texto.length > 800 ? `${item.texto.slice(0, 800)}… (+${item.texto.length - 800})` : item.texto;
      console.log(`\n── ${++feitos}/${pendentes.length} · ${item.caso ?? ''}\n${texto}`);
      let entrada = await perguntar('idioma> ');
      let r = entrada === null ? ({ tipo: 'sair' } as const) : interpretar(entrada, padrao);
      while (r.tipo === 'invalida') {
        entrada = await perguntar('código BCP-47, und, mul, p ou q> ');
        r = entrada === null ? { tipo: 'sair' } : interpretar(entrada, padrao);
      }
      if (r.tipo === 'sair') break;
      if (r.tipo === 'pular') continue;
      item.idioma = r.valor;
      escreverCorpus(caminho, itens);
    }
  } finally {
    rl.close();
  }
  console.log(`\nGravado em ${caminho}. Meça com: pnpm --filter @brabo/scripts idioma:medir -- --real`);
}

if (import.meta.url === `file://${process.argv[1]}`) void principal();

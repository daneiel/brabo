/**
 * Refs com símbolo — as citações `caminho:linha` das RNs que dizem QUAL
 * símbolo mora naquela linha, conferidas contra o código.
 *
 * Por que existe (AT-096): a RN-547 citava `fechar_a_instalacao` em
 * `install.sh:966` e `post_interno` em `:682`. Em 17/09 eles estavam em
 * `:1107` e `:809`; em 18/09, em `:1463` e `:1165`. Número de linha anda a
 * cada PR que mexe no arquivo, e ninguém volta às RNs para acertar — o mesmo
 * modo de falha das contagens em prosa (ADR 0029: gerar > verificar >
 * lembrar). Aqui não há o que gerar, mas há o que VERIFICAR: quando a própria
 * RN nomeia o símbolo ao lado da linha, a linha pode ser conferida.
 *
 * O PADRÃO, estreito de propósito (uma aferição barulhenta é desligada no
 * primeiro mês):
 *
 *   `<caminho>:<N>` (`<símbolo>`       — ref EXPLÍCITA
 *   `:<N>` (`<símbolo>`                — ref de CONTINUAÇÃO, herda o caminho
 *
 * - a ref é um código em crase terminando em `:<N>`, só dígitos (faixa
 *   `:10-20` e lista `:10,20` não casam);
 * - o símbolo vem IMEDIATAMENTE depois, abrindo parêntese, em crase — só
 *   espaço (inclusive quebra de linha) entre os dois;
 * - o símbolo é um identificador: letras, dígitos, `_`, `$`, com `?`/`!` no
 *   fim (Elixir), segmentos por `.`, e opcionalmente `()` ou `/<aridade>`.
 *   `MARCADOR_SCHEMA=3`, frase ou caminho NÃO são símbolo e ficam de fora;
 * - AMBÍGUO fica de fora: ref colada em outra por `/` (`:640`/`:647`) ou
 *   símbolo seguido de `/` (`a`/`b`) — o pareamento ref↔símbolo não é
 *   decidível;
 * - a continuação herda o ÚLTIMO caminho explícito do MESMO item (o item
 *   termina em linha em branco ou num novo `- ` de lista); sem caminho no
 *   item, fica de fora;
 * - o caminho resolve contra a raiz; se não existir ali, vale o ÚNICO
 *   arquivo versionado que termine nele (`decide.ts:40` → o único
 *   `…/decide.ts`). Nenhum ou mais de um: fica de fora, contado à parte.
 *
 * A CONFERÊNCIA: o símbolo (inteiro, ou o último segmento depois de `.`, sem
 * `()`/aridade) aparece como palavra numa JANELA de ±`JANELA` linhas em torno
 * de `N`. A janela existe porque a citação às vezes aponta a linha do corpo e
 * não a da assinatura; ela é pequena porque o objetivo é pegar a DERIVA, que
 * anda dezenas ou centenas de linhas.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const JANELA = 3;

export const ARQUIVOS_DE_RN = [
  'docs/business-rules.md',
  'docs/business-rules/custo.md',
  'docs/business-rules/autenticacao.md',
];

const SIMBOLO = /^[A-Za-z_$][\w$]*[?!]?(?:\.[A-Za-z_$][\w$]*[?!]?)*(?:\(\)|\/\d+)?$/;

/** Os itens de um markdown: blocos separados por linha em branco ou `- `. */
function itens(texto) {
  const blocos = [];
  let atual = [];
  let inicio = 1;
  texto.split('\n').forEach((linha, i) => {
    const novoItem = /^\s*[-*]\s/.test(linha);
    if (linha.trim() === '' || novoItem) {
      if (atual.length > 0) blocos.push({ inicio, texto: atual.join('\n') });
      atual = [];
      inicio = i + 1;
      if (linha.trim() === '') {
        inicio = i + 2;
        return;
      }
    }
    atual.push(linha);
  });
  if (atual.length > 0) blocos.push({ inicio, texto: atual.join('\n') });
  return blocos;
}

/**
 * Extrai as refs com símbolo de um texto de RN.
 * @returns {{caminho: string, linha: number, simbolo: string, linhaNoDoc: number}[]}
 */
export function extrairRefs(texto) {
  const refs = [];
  // Todo código em crase terminando em `:<N>` — explícito ou continuação.
  const REF = /`([^`\s]*):(\d+)`/g;

  for (const bloco of itens(texto)) {
    let caminhoCorrente = null;
    for (const achado of bloco.texto.matchAll(REF)) {
      const [inteiro, caminhoCru, numero] = achado;
      const inicioDaRef = achado.index;
      const fimDaRef = inicioDaRef + inteiro.length;

      if (caminhoCru !== '') {
        // Só é caminho se parece arquivo: tem extensão ou barra.
        if (!/[./]/.test(caminhoCru)) continue;
        caminhoCorrente = caminhoCru;
      }
      const caminho = caminhoCru === '' ? caminhoCorrente : caminhoCru;
      if (caminho === null) continue;

      // Ref colada na anterior por `/` — `:640`/`:647` — é lista, não par: o
      // símbolo que vem depois pode ser de qualquer uma das duas. (A primeira
      // da lista cai sozinha: depois dela vem `/`, não `(`.)
      if (bloco.texto.slice(inicioDaRef - 2, inicioDaRef) === '`/') continue;

      const depois = /^\s*\(`([^`\n]+)`(.?)/.exec(bloco.texto.slice(fimDaRef));
      if (depois === null) continue;
      const [, simbolo, seguinte] = depois;
      if (seguinte === '/') continue; // (`a`/`b`) — qual é qual?
      if (!SIMBOLO.test(simbolo)) continue;

      const linhaNoDoc = bloco.inicio + bloco.texto.slice(0, inicioDaRef).split('\n').length - 1;
      refs.push({ caminho, linha: Number(numero), simbolo, linhaNoDoc });
    }
  }
  return refs;
}

/** O que se procura na janela: o símbolo inteiro e o último segmento. */
export function candidatos(simbolo) {
  const limpo = simbolo.replace(/\(\)$/, '').replace(/\/\d+$/, '');
  const ultimo = limpo.split('.').at(-1);
  return [...new Set([limpo, ultimo])];
}

function comoPalavra(nome) {
  const escapado = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `?`/`!` colados a identificador são PARTE do nome em Elixir (`git_dir?`
  // não é `git_dir`), mas `?` seguido de `:` é campo opcional em TS
  // (`onConfirmado?: () => void`) — só o primeiro caso separa os nomes.
  return new RegExp(`(?<![\\w$])${escapado}(?![\\w$])(?![?!][\\w(])`);
}

/**
 * Confere uma ref contra as linhas do arquivo.
 * @returns {{bate: boolean, achadoEm: number | null}} `achadoEm` é a linha
 *   mais próxima de `linha` onde o símbolo aparece no arquivo INTEIRO (para a
 *   sugestão de correção), ou `null` se não aparece em lugar nenhum.
 */
export function conferir(linhasDoArquivo, linha, simbolo, janela = JANELA) {
  const padroes = candidatos(simbolo).map(comoPalavra);
  const aparece = (i) => i >= 1 && i <= linhasDoArquivo.length && padroes.some((p) => p.test(linhasDoArquivo[i - 1]));

  for (let d = 0; d <= janela; d++) {
    if (aparece(linha - d) || aparece(linha + d)) return { bate: true, achadoEm: aparece(linha - d) ? linha - d : linha + d };
  }
  let achadoEm = null;
  for (let i = 1; i <= linhasDoArquivo.length; i++) {
    if (aparece(i) && (achadoEm === null || Math.abs(i - linha) < Math.abs(achadoEm - linha))) achadoEm = i;
  }
  return { bate: false, achadoEm };
}

/**
 * Resolve o caminho citado: da raiz, ou o ÚNICO arquivo versionado que
 * termine nele. `null` quando não resolve ou é ambíguo.
 */
export function resolverCaminho(caminho, raiz, versionados) {
  if (existsSync(join(raiz, caminho))) return caminho;
  const sufixo = `/${caminho.replace(/^\.?\//, '')}`;
  const achados = versionados.filter((v) => v.endsWith(sufixo));
  return achados.length === 1 ? achados[0] : null;
}

/**
 * Afere todas as refs com símbolo dos arquivos de RN.
 * @returns {{total: number, batem: number, naoBatem: object[], naoResolvidas: object[]}}
 */
export function aferir(raiz, versionados, arquivos = ARQUIVOS_DE_RN) {
  const cache = new Map();
  const linhasDe = (caminho) => {
    if (!cache.has(caminho)) cache.set(caminho, readFileSync(join(raiz, caminho), 'utf8').split('\n'));
    return cache.get(caminho);
  };

  const resultado = { total: 0, batem: 0, naoBatem: [], naoResolvidas: [] };
  for (const doc of arquivos) {
    for (const ref of extrairRefs(readFileSync(join(raiz, doc), 'utf8'))) {
      const onde = { doc, ...ref };
      const resolvido = resolverCaminho(ref.caminho, raiz, versionados);
      if (resolvido === null) {
        resultado.naoResolvidas.push(onde);
        continue;
      }
      resultado.total++;
      const { bate, achadoEm } = conferir(linhasDe(resolvido), ref.linha, ref.simbolo);
      if (bate) resultado.batem++;
      else resultado.naoBatem.push({ ...onde, resolvido, achadoEm });
    }
  }
  return resultado;
}

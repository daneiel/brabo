/**
 * A tabela de procedimentos do runbook — cada procedimento de OPERAÇÃO diz o
 * arquivo que o prova e o gatilho que roda essa prova (AT-193, EP-015).
 *
 * Por que existe: o critério do EP-015 é *"nenhuma linha da tabela de
 * procedimentos tem a coluna de verificação vazia ou remetendo a 'ver abaixo',
 * e as provas que existem rodam por agenda, não por memória"*. A medição da
 * AT-129 (25/09) achou que essa tabela NÃO EXISTIA no repositório — morava na
 * nota do vault, com 7 linhas contra 28 procedimentos, e uma delas remetia a
 * outra nota. Uma tabela escrita à mão com nomes de arquivo repete o defeito
 * que o épico existe para fechar: o spec é renomeado, o workflow perde o
 * `schedule:`, e a célula continua afirmando. Este módulo é a parte que confere.
 *
 * O que ele lê: a PRIMEIRA tabela depois do cabeçalho
 * `## Procedures and how each is verified` de `docs/runbook.md`, com as colunas
 * exatas `procedure | anchor | verification | schedule`. O que reprova, por
 * linha:
 *
 *   - ÂNCORA       a célula `anchor` não tem link `(#id)`, ou o id não é um
 *                  `{#id}` explícito de um cabeçalho do runbook. Explícito, e
 *                  não o id que o Docusaurus derivaria do título: é o mesmo
 *                  contrato das âncoras de RN (título reescrito não quebra link).
 *   - VERIFICAÇÃO  a célula está vazia; remete a "see below/above" ou "ver
 *                  abaixo/acima"; cita um arquivo que não está versionado; cita
 *                  `make <alvo>` que o `Makefile` não tem; ou não cita NADA
 *                  conferível e também não começa com `**None**` — a declaração
 *                  explícita de que não há prova.
 *   - AGENDA       cada segmento (separado por `;`) começa com a CLASSE do
 *                  gatilho — `weekly`/`daily`/`monthly`, `every PR`,
 *                  `every tag` ou `manual` — e cada workflow citado nele tem de
 *                  existir e ter, no `on:`, o gatilho que a classe afirma
 *                  (`schedule:`, `pull_request`, `push: tags`). `manual` não
 *                  cita workflow: é a declaração de que ninguém roda aquilo sem
 *                  lembrar. Segmento sem classe reprova.
 *
 * A coluna se chama `schedule` e aceita `every PR`/`every tag` de propósito: a
 * pergunta do épico é "roda sem alguém lembrar?", e um spec que o `ci.yml` roda
 * em todo PR responde que sim — chamá-lo de `manual` seria mentir no sentido
 * oposto. O que o check garante é que a classe escrita é a que o workflow TEM:
 * `weekly` apontando para um workflow sem `schedule:` reprova, que é o caso que
 * a decisão da AT-193 nomeou.
 *
 * E o check cego: seção ausente, tabela ausente, cabeçalho de colunas mudado ou
 * zero linhas é `CEGO` e reprova — uma aferição que não achou o que aferir fica
 * verde para sempre.
 */

import { parse } from 'yaml';

export const SECAO = /^##\s+Procedures and how each is verified\b/;
export const COLUNAS = ['procedure', 'anchor', 'verification', 'schedule'];

const CELULA_DE_SEPARADOR = /^:?-{3,}:?$/;
const CABECALHO_COM_ANCORA = /^#{1,6}\s.*\{#([^}\s]+)\}\s*$/;

/** As células de uma linha de tabela markdown (`| a | b |`), sem as bordas. */
function celulas(linha) {
  const miolo = linha.trim().replace(/^\|/, '').replace(/\|$/, '');
  // `\|` dentro de célula é pipe literal, não separador.
  return miolo.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

/**
 * Acha a tabela da seção.
 * @returns {{cego: string|null, linhas: {linha: number, celulas: string[]}[]}}
 */
export function extrairTabela(texto) {
  const linhas = texto.split('\n');
  const inicio = linhas.findIndex((l) => SECAO.test(l));
  if (inicio === -1) return { cego: 'não achei a seção `## Procedures and how each is verified`', linhas: [] };

  let i = inicio + 1;
  while (i < linhas.length && !linhas[i].trim().startsWith('|')) {
    if (/^##\s/.test(linhas[i])) return { cego: 'a seção não tem tabela', linhas: [] };
    i++;
  }
  if (i >= linhas.length) return { cego: 'a seção não tem tabela', linhas: [] };

  const cabecalho = celulas(linhas[i]).map((c) => c.toLowerCase());
  if (cabecalho.join('|') !== COLUNAS.join('|')) {
    return { cego: `as colunas mudaram: \`${cabecalho.join(' | ')}\` (esperado \`${COLUNAS.join(' | ')}\`)`, linhas: [] };
  }
  const separador = linhas[i + 1] ?? '';
  if (!celulas(separador).every((c) => CELULA_DE_SEPARADOR.test(c))) {
    return { cego: 'a linha depois do cabeçalho não é o separador da tabela', linhas: [] };
  }

  const corpo = [];
  for (let j = i + 2; j < linhas.length && linhas[j].trim().startsWith('|'); j++) {
    corpo.push({ linha: j + 1, celulas: celulas(linhas[j]) });
  }
  if (corpo.length === 0) return { cego: 'a tabela não tem linhas', linhas: [] };
  return { cego: null, linhas: corpo };
}

/** Os ids `{#id}` explícitos dos cabeçalhos de um markdown. */
export function ancorasExplicitas(texto) {
  const ids = new Set();
  for (const linha of texto.split('\n')) {
    const m = CABECALHO_COM_ANCORA.exec(linha);
    if (m) ids.add(m[1]);
  }
  return ids;
}

/** Os alvos de um Makefile (`alvo:` no começo da linha). */
export function alvosDoMake(texto) {
  const alvos = new Set();
  for (const m of texto.matchAll(/^([A-Za-z0-9_.-]+):(?!=)/gm)) alvos.add(m[1]);
  return alvos;
}

/**
 * Os gatilhos de um workflow, pelo `on:` parseado de verdade (nunca por grep:
 * um `schedule:` num comentário não agenda nada).
 * @returns {Set<'schedule'|'pull_request'|'tag'|'workflow_dispatch'|'push'>}
 */
export function gatilhosDoWorkflow(texto) {
  const doc = parse(texto) ?? {};
  const on = doc.on ?? doc[true]; // YAML 1.1 lê `on` como booleano; o `yaml` v2 não, mas não custa.
  const chaves = typeof on === 'string' ? { [on]: null } : Array.isArray(on) ? Object.fromEntries(on.map((k) => [k, null])) : (on ?? {});
  const gatilhos = new Set();
  for (const [chave, valor] of Object.entries(chaves)) {
    if (chave === 'schedule' && Array.isArray(valor) && valor.length > 0) gatilhos.add('schedule');
    if (chave === 'pull_request' || chave === 'pull_request_target') gatilhos.add('pull_request');
    if (chave === 'workflow_dispatch') gatilhos.add('workflow_dispatch');
    if (chave === 'push') {
      gatilhos.add('push');
      if (valor && valor.tags) gatilhos.add('tag');
    }
  }
  return gatilhos;
}

const CLASSES = [
  { padrao: /^(weekly|daily|monthly|nightly)\b/i, gatilho: 'schedule', nome: 'agenda (`schedule:`)' },
  { padrao: /^every PR\b/i, gatilho: 'pull_request', nome: '`pull_request`' },
  { padrao: /^every (final )?tag\b/i, gatilho: 'tag', nome: '`push: tags`' },
  { padrao: /^manual\b/i, gatilho: null, nome: 'manual' },
];

const WORKFLOW = /^\.github\/workflows\/[^\s/]+\.ya?ml$/;
const PARECE_CAMINHO = /^[\w.@*-]+(\/[\w.@*-]+)+\/?$|^[\w.@*-]+\.(ts|mjs|js|sh|ya?ml|exs?|json)$/;

function crases(celula) {
  return [...celula.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
}

/**
 * Confere a tabela contra o repositório.
 *
 * @param {string} texto o `docs/runbook.md`
 * @param {{
 *   existe: (caminho: string) => boolean,
 *   alvos: Set<string>,
 *   gatilhos: (workflow: string) => Set<string>|null,
 * }} repo `gatilhos` devolve `null` quando o workflow não existe
 * @returns {{cego: string|null, linhas: number, comVerificacao: number, declaradasSem: number,
 *   problemas: {linha: number, procedimento: string, coluna: string, motivo: string}[]}}
 */
export function conferirTabela(texto, repo) {
  const { cego, linhas } = extrairTabela(texto);
  const resultado = { cego, linhas: linhas.length, comVerificacao: 0, declaradasSem: 0, problemas: [] };
  if (cego) return resultado;

  const ancoras = ancorasExplicitas(texto);

  for (const { linha, celulas: c } of linhas) {
    const [procedimento = '', ancora = '', verificacao = '', agenda = ''] = c;
    const reprova = (coluna, motivo) => resultado.problemas.push({ linha, procedimento, coluna, motivo });

    if (c.length !== COLUNAS.length) {
      reprova('—', `a linha tem ${c.length} células, não ${COLUNAS.length}`);
      continue;
    }

    // anchor
    const links = [...ancora.matchAll(/\]\(#([^)\s]+)\)/g)].map((m) => m[1]);
    if (links.length === 0) reprova('anchor', 'sem link `(#id)` para a seção do procedimento');
    for (const id of links) {
      if (!ancoras.has(id)) reprova('anchor', `\`#${id}\` não é um \`{#id}\` explícito de cabeçalho do runbook`);
    }

    // verification
    if (verificacao === '') {
      reprova('verification', 'vazia');
    } else {
      if (/\b(see|ver) (below|above|abaixo|acima)\b/i.test(verificacao)) {
        reprova('verification', 'remete a "ver abaixo/acima" em vez de nomear a prova');
      }
      let conferidas = 0;
      for (const token of crases(verificacao)) {
        const make = /^make ([A-Za-z0-9_.-]+)$/.exec(token);
        if (make) {
          conferidas++;
          if (!repo.alvos.has(make[1])) reprova('verification', `\`make ${make[1]}\` não é alvo do Makefile`);
        } else if (PARECE_CAMINHO.test(token)) {
          conferidas++;
          if (!repo.existe(token)) reprova('verification', `\`${token}\` não existe no repositório`);
        }
      }
      const declaraQueNaoHa = /^\*\*none\b/i.test(verificacao);
      if (declaraQueNaoHa) resultado.declaradasSem++;
      else if (conferidas > 0) resultado.comVerificacao++;
      else reprova('verification', 'não nomeia arquivo nem `make <alvo>`, e não declara `**None**`');
    }

    // schedule
    const segmentos = agenda.split(';').map((s) => s.trim()).filter(Boolean);
    if (segmentos.length === 0) reprova('schedule', 'vazia');
    for (const segmento of segmentos) {
      const classe = CLASSES.find((k) => k.padrao.test(segmento));
      const workflows = crases(segmento).filter((t) => WORKFLOW.test(t));
      if (!classe) {
        reprova('schedule', `"${segmento}" não começa com weekly|daily|monthly|every PR|every tag|manual`);
        continue;
      }
      if (classe.gatilho === null) {
        if (workflows.length > 0) reprova('schedule', `\`manual\` não cita workflow (${workflows.join(', ')}): um workflow que roda sozinho não é manual`);
        continue;
      }
      if (workflows.length === 0) {
        reprova('schedule', `"${segmento}" afirma ${classe.nome} e não cita o workflow (\`.github/workflows/<x>.yml\`)`);
        continue;
      }
      for (const wf of workflows) {
        const gatilhos = repo.gatilhos(wf);
        if (gatilhos === null) reprova('schedule', `\`${wf}\` não existe`);
        else if (!gatilhos.has(classe.gatilho)) reprova('schedule', `\`${wf}\` não tem ${classe.nome} no \`on:\``);
      }
    }
  }
  return resultado;
}

export const RUNBOOK = 'docs/runbook.md';

/**
 * O `repo` de `conferirTabela` sobre a árvore VERSIONADA — o mesmo que o
 * `docs:check` e o spec da árvore real usam, para os dois não divergirem.
 *
 * @param {(glob: string) => string[]} arquivos `git ls-files <glob>`
 * @param {(caminho: string) => string} ler
 */
export function repositorio(arquivos, ler) {
  const cache = new Map();
  return {
    existe: (caminho) => arquivos(caminho).length > 0,
    alvos: alvosDoMake(ler('Makefile')),
    gatilhos: (workflow) => {
      if (!cache.has(workflow)) {
        cache.set(workflow, arquivos(workflow).includes(workflow) ? gatilhosDoWorkflow(ler(workflow)) : null);
      }
      return cache.get(workflow);
    },
  };
}

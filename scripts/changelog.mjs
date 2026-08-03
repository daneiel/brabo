#!/usr/bin/env node
/**
 * Gera o CHANGELOG a partir dos conventional commits (Fase 5, item 6).
 *
 * Uso:
 *   node scripts/changelog.mjs v0.1.0            # do início até HEAD
 *   node scripts/changelog.mjs v0.2.0 v0.1.0     # desde a tag anterior
 *   node scripts/changelog.mjs v0.1.0 --stdout   # imprime sem gravar
 *   node scripts/changelog.mjs v0.3.0 v0.2.0 v0.3.0  # reconstrói uma antiga
 *
 * ## Por que um script e não standard-version / changesets
 *
 * São ~100 linhas contra uma dependência que traz opinião própria sobre bump
 * de versão, sobre criar commit e sobre criar tag — três coisas que neste
 * repositório são decisão do usuário (o CLAUDE.md é explícito: merge e release
 * em branch protegida são manuais). Aqui o script SÓ gera texto; quem decide
 * versão e tag é quem roda.
 *
 * Os commits deste repositório já seguem conventional commits em pt-BR, então
 * a única coisa que faltava era a formatação.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ARQUIVO = 'CHANGELOG.md';

// Ordem deliberada: o que muda a vida de quem usa vem primeiro; o que só
// interessa a quem mantém, por último. `feat` e `fix` no topo.
const SECOES = [
  ['feat', 'Novidades'],
  ['fix', 'Correções'],
  ['perf', 'Desempenho'],
  ['refactor', 'Refatorações'],
  ['docs', 'Documentação'],
  ['test', 'Testes'],
  ['build', 'Build'],
  ['ci', 'CI'],
  // `revert` NÃO é opcional nesta lista. Sem ele, um par plantar/reverter
  // aparece pela metade: o changelog mostra o commit que introduziu algo e
  // silencia o que o desfez. Aconteceu de verdade com o commit que plantou
  // uma CVE para provar o gate de auditoria — publicado sozinho, ele descreve
  // um repositório que nunca existiu.
  ['revert', 'Revertidos'],
  ['chore', 'Manutenção'],
];

function git(...args) {
  // stderr silenciado: o único uso que pode falhar é o `git describe` do
  // primeiro release, onde "No names found" é o resultado ESPERADO (ainda não
  // existe tag). Deixá-lo vazar faz uma execução bem-sucedida parecer quebrada.
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/**
 * Uma linha por commit, com o hash curto e o assunto. `%x00` como separador
 * porque assunto de commit pode conter qualquer coisa — inclusive `|`, que
 * seria a escolha ingênua.
 */
function commits(de, ate) {
  const intervalo = de ? `${de}..${ate}` : ate;
  const bruto = git('log', '--no-merges', '--pretty=format:%h%x00%s%x00%b%x1e', intervalo);
  if (!bruto) return [];

  return bruto
    .split('\x1e')
    .map((entrada) => entrada.trim())
    .filter(Boolean)
    .map((entrada) => {
      const [hash, assunto, corpo] = entrada.split('\x00');
      return { hash, assunto, corpo: corpo ?? '' };
    });
}

/** `feat(api)!: algo` -> { tipo, escopo, quebra, descricao } */
function analisar({ hash, assunto, corpo }) {
  const m = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(assunto);
  if (!m) return null; // não é conventional commit — fica de fora

  const quebra =
    Boolean(m[3]) || /^BREAKING[ -]CHANGE:/m.test(corpo);

  return { hash, tipo: m[1], escopo: m[2] ?? null, quebra, descricao: m[4] };
}

/**
 * A data da SEÇÃO é a do commit em `ate`, não a de hoje.
 *
 * Parece detalhe e não é: reconstruir o histórico rodando o gerador para cada
 * tag antiga carimbaria todas as versões com a data de quem rodou. E mesmo no
 * uso normal, a data do commit da tag é mais honesta que a do runner — que
 * pode ser outro dia se a release for republicada.
 */
function dataDe(ref) {
  try {
    return git('log', '-1', '--format=%ad', '--date=short', ref);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function render(versao, de, ate) {
  const analisados = commits(de, ate).map(analisar).filter(Boolean);
  const data = dataDe(ate);

  const linhas = [`## ${versao} — ${data}`, ''];

  // Quebras de compatibilidade primeiro e sempre, mesmo que o tipo do commit
  // seja `chore`: é a informação que decide se dá para atualizar sem ler nada.
  const quebras = analisados.filter((c) => c.quebra);
  if (quebras.length > 0) {
    linhas.push('### ⚠ Mudanças incompatíveis', '');
    for (const c of quebras) {
      linhas.push(`- ${escopo(c)}${c.descricao} (${c.hash})`);
    }
    linhas.push('');
  }

  for (const [tipo, titulo] of SECOES) {
    const doTipo = analisados.filter((c) => c.tipo === tipo && !c.quebra);
    if (doTipo.length === 0) continue;
    linhas.push(`### ${titulo}`, '');
    for (const c of doTipo) linhas.push(`- ${escopo(c)}${c.descricao} (${c.hash})`);
    linhas.push('');
  }

  if (analisados.length === 0) {
    linhas.push('_Nenhum commit em conventional commits neste intervalo._', '');
  }

  return linhas.join('\n');
}

const escopo = (c) => (c.escopo ? `**${c.escopo}**: ` : '');

// --- execução --------------------------------------------------------------
const args = process.argv.slice(2).filter((a) => a !== '--stdout');
const soImprimir = process.argv.includes('--stdout');
const [versao, anteriorArg, ateArg] = args;

if (!versao) {
  console.error(
    'uso: node scripts/changelog.mjs <versão> [tag-anterior] [até] [--stdout]',
  );
  process.exit(1);
}

// `até` existe para reconstruir uma versão ANTIGA (o intervalo termina na tag
// dela, não em HEAD). O default `HEAD` é o uso normal do release.
const ate = ateArg ?? 'HEAD';

// Tag anterior descoberta sozinha quando não informada — relativa a `ate`, e
// ignorando PRÉ-RELEASES.
//
// Eram dois erros no mesmo lugar. `describe ... HEAD` só acertava quando `ate`
// FOSSE HEAD: reconstruir uma versão antiga produzia intervalo invertido
// (`v1.4.0..v0.1.0`), que o git resolve como vazio. E sem `--exclude '*-*'` a
// tag anterior a `v1.4.0` é `v1.4.0-qa.1`, sobrando só os merges de promoção —
// que o `--no-merges` descarta.
//
// Os dois juntos produziam uma seção dizendo "nenhum commit neste intervalo"
// em vez de falhar: silencioso e errado. Foi o que deixou seis GitHub Releases
// publicadas com o corpo vazio.
//
// `null` quando não existe tag anterior: é o primeiro release, e aí o
// intervalo é a história inteira até `ate`.
let anterior = anteriorArg || null;
if (!anterior) {
  try {
    anterior = git(
      'describe',
      '--tags',
      '--abbrev=0',
      '--match',
      'v*',
      '--exclude',
      '*-*',
      `${ate}^`,
    );
  } catch {
    anterior = null;
  }
}

const secao = render(versao, anterior, ate);

if (soImprimir) {
  process.stdout.write(secao);
} else {
  // Prepend, nunca sobrescrita: o histórico das versões anteriores é o valor
  // do arquivo.
  const cabecalho = '# Changelog\n\nGerado dos conventional commits por `scripts/changelog.mjs`.\n\n';
  const atual = existsSync(ARQUIVO)
    ? readFileSync(ARQUIVO, 'utf8').replace(cabecalho, '')
    : '';
  writeFileSync(ARQUIVO, `${cabecalho}${secao}\n${atual}`.trimEnd() + '\n');
  console.error(`[changelog] ${ARQUIVO} atualizado (${versao}, desde ${anterior ?? 'o início'})`);
}

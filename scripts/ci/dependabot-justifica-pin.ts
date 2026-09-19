/**
 * dependabot-justifica-pin — decide se o corpo de um PR do Dependabot ganha a
 * linha `docs-not-needed: <motivo>`, e escreve essa linha. Fonte da política:
 * docs/explanation/branching-policy.md, seção "Dependabot enters through dev".
 *
 * Por que isto existe: o drift check (`scripts/docs/drift.mjs`) dispara por
 * ARQUIVO tocado, e o docmap vigia `release.yml` na regra
 * `politica-de-branches` (`block`). Um bump de action que só troca o SHA do
 * `uses:` e o comentário de versão ao lado toca `release.yml` e é bloqueado
 * por uma regra que não se aplica a ele — os #578/#580 (`docker/bake-action`,
 * `docker/setup-buildx-action`) foram destravados à mão, com a linha escrita
 * por um humano. A decisão do mantenedor (18/09, AT-094) é que o BOT a
 * escreva, e SÓ nesta classe de diff.
 *
 * A régua nunca vira "PR de bot pula o docmap". São DUAS condições, e as duas
 * são necessárias:
 *
 * - o AUTOR é o Dependabot (`ehBranchDoDependabot`: prefixo `dependabot/` E
 *   login do app — o prefixo sozinho é a porta que um humano abriria);
 * - o DIFF é só troca de pin: todo arquivo é YAML sob `.github/workflows/` ou
 *   `.github/actions/`, modificado (nunca criado, apagado, renomeado ou com
 *   modo trocado), e TODA linha alterada é um `uses: <action>@<sha>  # <versão>`
 *   pareado com outro da MESMA action, na MESMA indentação, mudando só o SHA
 *   e/ou o comentário de versão. Qualquer outra linha — job, gatilho, `with:`,
 *   `package.json`, lockfile — e nada é escrito: o docmap julga como sempre.
 *
 * A linha escrita vai marcada (`MARCA`), e a marca é o que torna a decisão
 * REVERSÍVEL: se um push posterior acrescenta ao PR algo que não é pin, a
 * linha do bot é REMOVIDA, e só ela — uma `docs-not-needed:` escrita por
 * humano nunca é tocada, nem para duplicar nem para apagar.
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

import { ehBranchDoDependabot } from './pr-police.ts';

/** Comentário HTML invisível na renderização, na linha de cima da nossa. */
export const MARCA = '<!-- dependabot-justifica-pin -->';

/**
 * `uses: owner/repo[/caminho]@<40 hex>  # <versão>`, com o `- ` de item de
 * lista opcional. O comentário é UM token (`v7.3.0`, `v4`): prosa depois da
 * versão não é troca de pin, é texto novo, e fica com o docmap.
 */
const PIN = /^(\s*(?:-\s+)?)uses:\s+([^\s@]+)@([0-9a-f]{40})\s+#\s*(\S+)\s*$/;

/** Onde uma action de terceiro é referenciada. `action.yml` de composite entra. */
const ARQUIVO_DE_ACTION = /^\.github\/(?:workflows|actions)\/.+\.ya?ml$/;

/** Cabeçalho de arquivo que não é "modificado no lugar". */
const CABECALHO_PROIBIDO =
  /^(?:new file mode|deleted file mode|rename from|rename to|copy from|copy to|similarity index|old mode|new mode|Binary files|GIT binary patch)/;

export type Analise =
  | { puro: true; linhas: number; arquivos: string[] }
  | { puro: false; motivo: string };

interface Pin {
  prefixo: string;
  action: string;
}

function lerPin(linha: string): Pin | null {
  const achado = PIN.exec(linha);
  if (achado === null) return null;
  const [, prefixo = '', action = ''] = achado;
  // Referência local não é pin de terceiro — e nem casaria com o SHA.
  if (action.startsWith('./')) return null;
  return { prefixo, action };
}

/**
 * Lê um diff unificado do git (a saída de `gh pr diff`) e diz se ele é só
 * troca de pin de action. Falha FECHADO: tudo o que não é reconhecido
 * explicitamente torna o diff não-puro.
 */
export function analisarDiff(diff: string): Analise {
  const secoes = diff.split(/^(?=diff --git )/m).filter((s) => s.startsWith('diff --git '));
  if (secoes.length === 0) return { puro: false, motivo: 'diff vazio ou ilegível' };

  const arquivos: string[] = [];
  let linhas = 0;

  for (const secao of secoes) {
    const partes = secao.split('\n');
    let arquivo = '';
    let i = 1;

    // Cabeçalho: até o primeiro `@@`.
    for (; i < partes.length && !partes[i]!.startsWith('@@'); i++) {
      const linha = partes[i]!;
      if (CABECALHO_PROIBIDO.test(linha)) {
        const nome = /^diff --git a\/(\S+)/.exec(partes[0]!)?.[1] ?? '?';
        return { puro: false, motivo: `\`${nome}\` não é só modificado (${linha.trim()})` };
      }
      if (linha.startsWith('+++ ')) {
        arquivo = linha.slice(4).replace(/^b\//, '');
      }
    }

    if (!arquivo || arquivo === '/dev/null') {
      return { puro: false, motivo: `seção sem arquivo de destino (${partes[0]})` };
    }
    if (!ARQUIVO_DE_ACTION.test(arquivo)) {
      return { puro: false, motivo: `\`${arquivo}\` não é workflow nem action` };
    }
    if (i >= partes.length) {
      return { puro: false, motivo: `\`${arquivo}\` sem hunk de texto` };
    }

    let removidas: string[] = [];
    let adicionadas: string[] = [];

    const fecharBloco = (): string | null => {
      if (removidas.length !== adicionadas.length) {
        return `\`${arquivo}\`: ${removidas.length} linha(s) removida(s) contra ${adicionadas.length} adicionada(s) num mesmo trecho`;
      }
      for (let k = 0; k < removidas.length; k++) {
        const antes = lerPin(removidas[k]!);
        const depois = lerPin(adicionadas[k]!);
        if (antes === null || depois === null) {
          const culpada = antes === null ? removidas[k]! : adicionadas[k]!;
          return `\`${arquivo}\`: linha que não é pin de action — \`${culpada.trim()}\``;
        }
        if (antes.action !== depois.action) {
          return `\`${arquivo}\`: troca de action (\`${antes.action}\` → \`${depois.action}\`), não de pin`;
        }
        if (antes.prefixo !== depois.prefixo) {
          return `\`${arquivo}\`: \`${antes.action}\` muda de indentação — a estrutura do YAML mudou`;
        }
        linhas++;
      }
      removidas = [];
      adicionadas = [];
      return null;
    };

    for (; i < partes.length; i++) {
      const linha = partes[i]!;
      if (linha.startsWith('@@') || linha.startsWith(' ') || linha === '') {
        const erro = fecharBloco();
        if (erro !== null) return { puro: false, motivo: erro };
        continue;
      }
      if (linha.startsWith('\\')) continue; // "\ No newline at end of file"
      if (linha.startsWith('-')) removidas.push(linha.slice(1));
      else if (linha.startsWith('+')) adicionadas.push(linha.slice(1));
      else return { puro: false, motivo: `\`${arquivo}\`: linha de diff irreconhecível` };
    }
    const erro = fecharBloco();
    if (erro !== null) return { puro: false, motivo: erro };

    arquivos.push(arquivo);
  }

  if (linhas === 0) return { puro: false, motivo: 'nenhuma linha alterada' };
  return { puro: true, linhas, arquivos };
}

export interface Entrada {
  head: string;
  autor?: string;
  tipoDoAutor?: string;
  diff: string;
  corpo: string;
}

export type Decisao =
  | { acao: 'escrever'; motivo: string; corpo: string }
  | { acao: 'remover'; motivo: string; corpo: string }
  | { acao: 'manter'; motivo: string };

/** O bloco do bot: a marca e a linha que o drift lê. */
export function blocoDoBot(analise: { linhas: number; arquivos: string[] }): string {
  // O #562 tocou 19 workflows: a lista inteira numa linha não ajuda ninguém.
  const nomes =
    analise.arquivos.length <= 3
      ? analise.arquivos.map((a) => `\`${a}\``).join(', ')
      : `${analise.arquivos.length} arquivos de workflow/action`;
  return (
    `${MARCA}\n` +
    `docs-not-needed: troca de pin de action pelo Dependabot — ${analise.linhas} linha(s) \`uses:\` ` +
    `em ${nomes} mudam só o SHA e o comentário de versão, sem job, gatilho nem \`with:\` novo ` +
    '(conferido por `scripts/ci/dependabot-justifica-pin.ts`).'
  );
}

/** O corpo sem o bloco do bot — a linha de um humano fica intacta. */
export function semBlocoDoBot(corpo: string): string {
  const escapada = MARCA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return corpo.replace(new RegExp(`\\n*${escapada}\\n[^\\n]*\\n?`, 'g'), '\n').replace(/\n+$/, '\n');
}

export function decidir(entrada: Entrada): Decisao {
  const temBloco = entrada.corpo.includes(MARCA);
  const semBloco = semBlocoDoBot(entrada.corpo);

  const doDependabot = ehBranchDoDependabot(entrada.head, entrada.autor, entrada.tipoDoAutor);
  const analise: Analise = doDependabot
    ? analisarDiff(entrada.diff)
    : { puro: false, motivo: 'o autor não é o Dependabot' };

  if (!analise.puro) {
    if (temBloco) {
      return {
        acao: 'remover',
        motivo: `a justificativa do bot deixou de valer: ${analise.motivo}`,
        corpo: semBloco,
      };
    }
    return { acao: 'manter', motivo: analise.motivo };
  }

  // Um humano já justificou: a linha dele manda, e o bot não empilha a sua.
  if (!temBloco && /^docs-not-needed:/m.test(entrada.corpo)) {
    return { acao: 'manter', motivo: 'o corpo já tem uma `docs-not-needed:` escrita por humano' };
  }

  const desejado = `${semBloco.replace(/\n+$/, '')}\n\n${blocoDoBot(analise)}\n`;
  if (desejado === entrada.corpo) {
    return { acao: 'manter', motivo: 'a justificativa do bot já está no corpo' };
  }
  return {
    acao: 'escrever',
    motivo: `só troca de pin (${analise.linhas} linha(s) em ${analise.arquivos.length} arquivo(s))`,
    corpo: desejado,
  };
}

// ------------------------------------------------------------- adaptador CLI
//
// uso: dependabot-justifica-pin.ts <arquivo-do-diff> <arquivo-do-corpo> <arquivo-de-saida>
//
// Lê head, autor e tipo do autor de `PR_HEAD_REF`, `PR_AUTOR` e
// `PR_TIPO_DO_AUTOR` — do payload do evento, nunca do corpo. Imprime UMA linha
// JSON `{acao, motivo}` e, quando a ação muda o corpo, grava o corpo novo em
// <arquivo-de-saida> para o workflow aplicar com `gh pr edit --body-file`.

async function principal(): Promise<void> {
  const [, , arquivoDoDiff = '', arquivoDoCorpo = '', arquivoDeSaida = ''] = process.argv;
  if (!arquivoDoDiff || !arquivoDoCorpo || !arquivoDeSaida) {
    console.error('uso: dependabot-justifica-pin.ts <diff> <corpo> <saida>');
    process.exit(2);
  }
  const { readFileSync, writeFileSync } = await import('node:fs');

  const decisao = decidir({
    head: process.env.PR_HEAD_REF ?? '',
    autor: process.env.PR_AUTOR,
    tipoDoAutor: process.env.PR_TIPO_DO_AUTOR,
    diff: readFileSync(arquivoDoDiff, 'utf8'),
    corpo: readFileSync(arquivoDoCorpo, 'utf8'),
  });

  if (decisao.acao !== 'manter') writeFileSync(arquivoDeSaida, decisao.corpo);
  console.log(JSON.stringify({ acao: decisao.acao, motivo: decisao.motivo }));
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}

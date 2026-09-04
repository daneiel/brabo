/**
 * alarme-de-tag — dá DESTINATÁRIO ao `tag-release` quando ele falha.
 * Fonte da política: docs/explanation/branching-policy.md
 *
 * ## Por que este arquivo existe
 *
 * A verificação que importa já existia e já funcionou. Em 2026-08-25 o
 * `tag-release` gritou, na `qa`, exatamente o que precisava gritar:
 *
 *     [tag-release] o merge em `qa` não é merge commit (1 pai)
 *
 * E de novo em 2026-08-24, na promoção anterior (#367). Duas promoções
 * entraram por squash, o alarme tocou nas duas, e o histórico ficou quebrado
 * do mesmo jeito — até a promoção seguinte aparecer com 11 arquivos em
 * "conflito" que não eram conflito nenhum, só ancestralidade perdida.
 *
 * O que faltou não foi detectar. Foi ter para QUEM tocar: workflow de `push`
 * que falha numa permanente vira um run vermelho na aba Actions e mais nada —
 * nenhuma issue, nenhum comentário, ninguém marcado. Não há PR onde o
 * vermelho apareça, porque o merge já aconteceu. O repositório tinha ZERO
 * issues quando isto foi escrito: o canal não existia.
 *
 * Detecção sem endereço é um alarme tocando em sala vazia.
 *
 * ## Por que uma issue, e não só o run vermelho
 *
 * Issue notifica, tem dono, fica aberta até alguém fechar, e sobrevive à
 * rolagem da aba Actions. O run vermelho não faz nenhuma das quatro.
 *
 * Uma issue POR BRANCH, reaproveitada: falha repetida na mesma permanente
 * vira comentário na issue aberta, nunca uma issue nova. Enxurrada de issues
 * idênticas é a forma mais rápida de ensinar alguém a ignorá-las.
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

/** O que se sabe da falha, para compor o aviso. */
export interface FalhaDeCarimbo {
  /** A permanente onde o merge entrou. */
  branch: string;
  /** O commit que entrou. */
  sha: string;
  /** Link do run que falhou — é o que leva ao log de verdade. */
  urlDoRun: string;
}

export interface Alarme {
  titulo: string;
  corpo: string;
}

/**
 * O título é CHAVE, não prosa: é por ele que a próxima falha na mesma branch
 * acha a issue já aberta em vez de abrir outra. Mudar o formato aqui quebra a
 * deduplicação — quem mudar, muda também a busca no workflow.
 */
export function tituloDoAlarme(branch: string): string {
  return `[tag-release] o carimbo falhou em \`${branch}\``;
}

export function montarAlarme(falha: FalhaDeCarimbo): Alarme {
  const { branch, sha, urlDoRun } = falha;
  const curto = sha.slice(0, 8);

  const corpo = [
    `O \`tag-release\` falhou no commit \`${curto}\` de \`${branch}\`, e **nenhuma tag foi carimbada**.`,
    '',
    `- **Run com o log:** ${urlDoRun}`,
    `- **Commit:** \`${sha}\``,
    '',
    '## A causa mais provável, e a que já aconteceu três vezes',
    '',
    'Merge de esteira (promoção ou retropropagação) entrou por **squash** em vez de',
    '`--no-ff`. O squash cria um commit de **um pai só**, e o segundo pai era a única',
    'coisa que ligava os dois degraus: sem ele, a tag do degrau de baixo aponta para um',
    'commit que não está mais neste histórico, e a **próxima promoção nasce em conflito',
    'que não é conflito** — foi exatamente isso nas #367, #394 e #464.',
    '',
    '### Como confirmar em um comando',
    '',
    '```bash',
    `git log -1 --format='%H%nparents: %P' ${curto}`,
    '```',
    '',
    'Um pai só numa promoção = foi squash.',
    '',
    '### Como consertar',
    '',
    'Refazer o merge com **"Create a merge commit"**. Quando o commit já entrou, o',
    'conserto é um merge `-s ours` da branch de origem sobre esta, que devolve a aresta',
    'do grafo sem mudar uma linha de conteúdo:',
    '',
    '```bash',
    `git checkout -b chore/reconciliar-<algo> origin/${branch}`,
    'git merge -s ours origin/<origem> -m "chore: reconcilia ancestralidade"',
    '```',
    '',
    'E o PR desse conserto **também** precisa entrar por merge commit — squash nele é',
    'garantia matemática de não funcionar, porque a correção *é* o segundo parent.',
    '',
    '## Outras causas possíveis',
    '',
    '- **`BRABO_BOT_TOKEN` inválido ou expirado.** O `checkout` falha com',
    "  `fatal: could not read Username for 'https://github.com'` e nada é carimbado em",
    '  branch nenhuma. Só rotacionar o segredo resolve.',
    '- **Âncora inválida** numa promoção para `main` (a `-qa.N` esperada não bate).',
    '',
    '---',
    '',
    'Aberta automaticamente pelo `tag-release`. Falha repetida nesta mesma branch vira',
    'comentário aqui, nunca uma issue nova. Feche quando o carimbo voltar a passar.',
  ].join('\n');

  return { titulo: tituloDoAlarme(branch), corpo };
}

async function principal(): Promise<void> {
  const { appendFileSync, writeFileSync } = await import('node:fs');

  const alarme = montarAlarme({
    branch: process.env.BRANCH ?? '',
    sha: process.env.SHA ?? '',
    urlDoRun: process.env.URL_DO_RUN ?? '',
  });

  // O CORPO vai para ARQUIVO, nunca para `GITHUB_OUTPUT`. Não é preferência:
  // o texto tem crases, `$` e `<`, e interpolar `${{ steps.x.outputs.corpo }}`
  // dentro de um `run:` é injeção de shell com o conteúdo passando por um
  // `bash -e`. `--body-file` não passa por shell nenhum.
  const arquivo = process.env.ARQUIVO_DO_CORPO ?? 'alarme.md';
  writeFileSync(arquivo, alarme.corpo, 'utf8');

  // O TÍTULO pode ir por output: ele é composto aqui, não vem de fora, e o
  // formato é fechado por teste (`tituloDoAlarme`).
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `titulo<<FIM\n${alarme.titulo}\nFIM\n`);
  }

  console.log(alarme.titulo);
  console.log(`corpo escrito em ${arquivo}`);
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}

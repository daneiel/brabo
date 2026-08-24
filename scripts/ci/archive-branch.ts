/**
 * archive-branch — decide se uma branch mergeada deve ser arquivada, e o
 * ref de destino. Fonte da política: docs/explanation/branching-policy.md
 *
 * "Arquivar" aqui é mecânico, não é o merge em si: mover a branch de
 * `refs/heads/<nome>` para `refs/archive/<nome>` — fora do namespace de
 * branches (some da lista do GitHub), mas o objeto e o histórico continuam
 * no repositório, recuperável por quem souber o ref. As três permanentes
 * (dev/qa/main) NUNCA são arquivadas — elas aparecem como `head` de todo PR
 * de promoção mergeado (dev→qa, qa→main), e são exatamente o caso que este
 * módulo existe para excluir. `gh-pages` também fica de fora: é a branch de
 * deploy do site de docs (GitHub Pages), não uma branch de feature — apagar
 * `refs/heads/gh-pages` derrubaria o site.
 *
 * PR de fork (branch head vive em OUTRO repositório) também não é arquivado:
 * o `GITHUB_TOKEN` deste repositório não tem — e não deveria ter — permissão
 * para mexer em refs de um repositório de terceiros.
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

const NUNCA_ARQUIVAR = new Set(['dev', 'qa', 'main', 'gh-pages']);

/**
 * @param branch - nome da branch (head do PR mergeado)
 * @param headRepo - `owner/repo` de onde a branch head vem
 * @param baseRepo - `owner/repo` do repositório onde o PR foi aberto
 */
export function deveArquivar(branch: string, headRepo: string, baseRepo: string): boolean {
  if (branch.length === 0) return false;
  if (NUNCA_ARQUIVAR.has(branch)) return false;
  if (headRepo !== baseRepo) return false;
  return true;
}

/** `feature/foo` → `refs/archive/feature/foo`. */
export function refDeArquivo(branch: string): string {
  return `refs/archive/${branch}`;
}

// ------------------------------------------------------------- adaptador CLI
//
// Imprime o ref de arquivo em stdout e sai 0 quando deve arquivar; sai 1
// (sem nada em stdout) quando não deve. O workflow decide o resto (criar o
// ref, apagar a branch) via `gh api` — este módulo só carrega a POLÍTICA de
// quem entra e quem fica de fora, que é a parte que erra na prática.

async function principal(): Promise<void> {
  const [, , branch = '', headRepo = '', baseRepo = ''] = process.argv;

  if (!branch) {
    console.error('uso: archive-branch.ts <branch> <headRepo> <baseRepo>');
    process.exit(2);
  }

  if (!deveArquivar(branch, headRepo, baseRepo)) {
    console.error(`archive-branch: não arquiva '${branch}' (permanente, deploy, ou fork)`);
    process.exit(1);
  }

  console.log(refDeArquivo(branch));
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}

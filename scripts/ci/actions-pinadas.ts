/**
 * actions-pinadas — reprova qualquer `uses:` de GitHub Action preso a uma
 * referência MUTÁVEL (tag ou branch) em vez de um commit SHA.
 *
 * Tag é um ponteiro que o dono da action pode remover e recriar apontando
 * para outro commit — `actions/checkout@v4` hoje e amanhã podem ser código
 * diferente, sem nenhum sinal no nosso repositório. Quem move a tag executa
 * código no runner que tem o checkout e, nos workflows de release, as
 * credenciais do GHCR e do npm. SHA não se move: é o próprio conteúdo.
 *
 * O #408 fez isso no `ci.yml` e só nele. Este check existe porque a metade
 * que sobrou (15 workflows, entre eles `release.yml`, `publish-runner.yml`,
 * `tag-release.yml` e `docs-deploy.yml` — justamente os que carregam
 * credencial) provou que disciplina humana não segura pin: workflow novo
 * nasce copiando o vizinho, e o vizinho estava com tag.
 *
 * O comentário `# vN` depois do SHA é OBRIGATÓRIO, e não é decoração: é a
 * única coisa que diz a um humano — e ao Dependabot, que lê exatamente esse
 * comentário para propor a atualização — qual versão aquele hash é. SHA sem
 * versão ao lado é pin que ninguém consegue auditar nem atualizar.
 *
 * Referência LOCAL (`./.github/...`) passa: é código deste repositório, que
 * o próprio PR revisa; não há terceiro para mover nada.
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Um `uses:` que não está preso a um commit imutável. */
export interface Violacao {
  arquivo: string;
  linha: number;
  uses: string;
  motivo: 'referência mutável' | 'SHA sem a versão em comentário';
}

export interface Workflow {
  nome: string;
  conteudo: string;
}

/** `uses: owner/repo@<40 hex>` ou `owner/repo/sub@<40 hex>`, com `# vN` ao fim. */
const USES = /^\s*(?:-\s+)?uses:\s*(\S+)\s*(?:#\s*(\S.*?))?\s*$/;
const SHA = /^[0-9a-f]{40}$/;

/**
 * @param workflows - conteúdo de cada arquivo de `.github/workflows/`
 * @returns toda violação encontrada, na ordem em que aparecem
 */
export function verificarPins(workflows: readonly Workflow[]): Violacao[] {
  const violacoes: Violacao[] = [];

  for (const { nome, conteudo } of workflows) {
    conteudo.split('\n').forEach((linha, indice) => {
      // Linha inteiramente comentada não é um `uses:` — é prosa sobre um.
      if (/^\s*#/.test(linha)) return;

      const achado = USES.exec(linha);
      if (achado === null) return;

      // O grupo 1 é obrigatório no padrão; o 2 (comentário) é o opcional.
      const referencia = achado[1] ?? '';
      const comentario = achado[2];

      // Action deste próprio repositório (composite ou workflow reutilizável):
      // não há terceiro que possa mover a referência.
      if (referencia.startsWith('./')) return;

      const arroba = referencia.lastIndexOf('@');
      const versao = arroba === -1 ? '' : referencia.slice(arroba + 1);

      if (!SHA.test(versao)) {
        violacoes.push({
          arquivo: nome,
          linha: indice + 1,
          uses: referencia,
          motivo: 'referência mutável',
        });
        return;
      }

      if (comentario === undefined || comentario.length === 0) {
        violacoes.push({
          arquivo: nome,
          linha: indice + 1,
          uses: referencia,
          motivo: 'SHA sem a versão em comentário',
        });
      }
    });
  }

  return violacoes;
}

/** A mensagem que ensina o que fazer, não só o que está errado. */
export function mensagemDeViolacao(violacao: Violacao): string {
  const onde = `${violacao.arquivo}:${violacao.linha}`;

  if (violacao.motivo === 'referência mutável') {
    return (
      `${onde}: \`${violacao.uses}\` está preso a uma tag ou branch, que o ` +
      'dono da action pode mover para outro commit sem aviso. Resolva a ' +
      'referência com `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha` e ' +
      'escreva `uses: <owner>/<repo>@<sha>  # <tag>`.'
    );
  }

  return (
    `${onde}: \`${violacao.uses}\` está pinado por SHA, mas sem o comentário ` +
    '`# <versão>` ao lado. Sem ele ninguém sabe que versão é esse hash, e o ' +
    'Dependabot — que lê justamente esse comentário — não consegue propor a ' +
    'atualização.'
  );
}

// --- CLI: `node scripts/ci/actions-pinadas.ts` -----------------------------

function lerWorkflows(diretorio: string): Workflow[] {
  return readdirSync(diretorio)
    .filter((nome) => nome.endsWith('.yml') || nome.endsWith('.yaml'))
    .sort()
    .map((nome) => ({ nome: `.github/workflows/${nome}`, conteudo: readFileSync(`${diretorio}/${nome}`, 'utf8') }));
}

function principal(): void {
  const diretorio = fileURLToPath(new URL('../../.github/workflows', import.meta.url));
  const workflows = lerWorkflows(diretorio);
  const violacoes = verificarPins(workflows);

  const total = workflows.reduce(
    (soma, { conteudo }) => soma + (conteudo.match(/^\s*(?:-\s+)?uses:/gm)?.length ?? 0),
    0,
  );

  console.log(`actions-pinadas: ${total} \`uses:\` em ${workflows.length} workflows.`);

  if (violacoes.length > 0) {
    for (const violacao of violacoes) {
      console.error(`::error file=${violacao.arquivo},line=${violacao.linha}::${mensagemDeViolacao(violacao)}`);
    }
    console.error(
      `::error::actions-pinadas: ${violacoes.length} action(s) sem pin imutável. ` +
        'Ver docs/explanation/cadeia-de-suprimentos-do-ci.md e o comentário no topo de ' +
        'scripts/ci/actions-pinadas.ts.',
    );
    process.exit(1);
  }

  console.log('  ✓ todas presas a commit SHA, com a versão em comentário.');
}

if (process.argv[1]?.endsWith('actions-pinadas.ts')) {
  principal();
}

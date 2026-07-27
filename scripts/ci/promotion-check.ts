/**
 * promotion-check — confere o ESTADO do repositório num PR de promoção.
 * Fonte da política: docs/explanation/branching-policy.md
 *
 * Três perguntas, e nenhuma delas é sobre a forma do PR (isso é o pr-police):
 *
 *   1. o range é limpo — o head é exatamente o tip da branch de origem?
 *   2. o degrau de baixo tem tag — o commit promovido já foi carimbado lá?
 *   3. o merge vai ser `--no-ff` — o repositório permite merge commit?
 *
 * A terceira só pode ser verificada DEPOIS do fato para valer de verdade; aqui
 * se valida a configuração, e o `tag-release` confere os dois pais no push.
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

import { ESCADA, type Permanente } from './pr-police.ts';
import { lerTagDeEstagio, type Estagio } from './version.ts';

export interface Conferencia {
  nome: string;
  ok: boolean;
  detalhe: string;
}

/** O estágio cujo carimbo o commit precisa ter para subir para `destino`. */
export function estagioExigido(destino: Permanente): Estagio | null {
  const i = ESCADA.indexOf(destino);
  if (i <= 0) return null;
  const anterior = ESCADA[i - 1]!;
  return anterior === 'main' ? null : (anterior as Estagio);
}

/** As tags daquele estágio que apontam para o commit. */
export function tagsDoCommit(
  todasAsTags: string[],
  shaPorTag: Record<string, string>,
  sha: string,
  estagio: Estagio,
): string[] {
  return todasAsTags.filter((t) => {
    const lida = lerTagDeEstagio(t);
    return lida !== null && lida.estagio === estagio && shaPorTag[t] === sha;
  });
}

// ------------------------------------------------------------- adaptador CLI

async function principal(): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  const { appendFileSync } = await import('node:fs');

  const head = (process.env.PR_HEAD_REF ?? '').trim();
  const base = (process.env.PR_BASE_REF ?? '').trim();
  const headSha = (process.env.PR_HEAD_SHA ?? '').trim();
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  const mesmoRepo = process.env.PR_MESMO_REPO !== 'false';

  const git = (...args: string[]): string =>
    execFileSync('git', args, { encoding: 'utf8' }).trim();

  const ehPermanente = (n: string): n is Permanente => (ESCADA as readonly string[]).includes(n);

  // --- Isto é uma promoção? Se não for, o check se pronuncia e sai 0.
  const ehPromocao =
    mesmoRepo &&
    ehPermanente(head) &&
    ehPermanente(base) &&
    ESCADA.indexOf(base) - ESCADA.indexOf(head) === 1;

  if (!ehPromocao) {
    console.log(`promotion-check: ${head} → ${base}`);
    console.log('');
    console.log('  ✓ NÃO SE APLICA — este PR não é uma promoção entre degraus adjacentes.');
    console.log('    A forma do PR é conferida pelo pr-police; aqui só entra promoção.');
    return;
  }

  const conferencias: Conferencia[] = [];

  // --- 1. range limpo.
  //
  // O head de uma promoção é a própria branch permanente. Se o sha do PR não
  // for o tip dela, alguém empurrou algo depois de o PR abrir — e o que seria
  // promovido não é o que está em `dev`.
  let tipDaOrigem = '';
  try {
    tipDaOrigem = git('rev-parse', `origin/${head}`);
  } catch {
    tipDaOrigem = '';
  }

  conferencias.push(
    tipDaOrigem === ''
      ? {
          nome: 'range limpo',
          ok: false,
          detalhe: `não consegui resolver \`origin/${head}\` — verificação impossível, e por isso reprovada.`,
        }
      : tipDaOrigem === headSha
        ? {
            nome: 'range limpo',
            ok: true,
            detalhe: `o head do PR é o tip de \`${head}\` (${headSha.slice(0, 8)}).`,
          }
        : {
            nome: 'range limpo',
            ok: false,
            detalhe:
              `o head do PR (${headSha.slice(0, 8)}) NÃO é o tip de \`${head}\` ` +
              `(${tipDaOrigem.slice(0, 8)}).\n` +
              `      Algo entrou em \`${head}\` depois de o PR abrir. Promover assim\n` +
              `      levaria um estado que ninguém revisou — atualize o PR.`,
          },
  );

  // --- 2. degrau de baixo carimbado.
  const estagio = estagioExigido(base);
  const tags = git('tag', '--list', 'v*').split('\n').map((t) => t.trim()).filter(Boolean);
  const shaPorTag: Record<string, string> = {};
  for (const t of tags) {
    try {
      shaPorTag[t] = git('rev-list', '-n1', t);
    } catch {
      // Tag que não resolve fica de fora — a ausência vira reprovação abaixo,
      // nunca aprovação silenciosa.
    }
  }

  if (estagio === null) {
    conferencias.push({
      nome: 'degrau anterior carimbado',
      ok: false,
      detalhe: `não sei qual estágio precede \`${base}\` — a escada é ${ESCADA.join(' → ')}.`,
    });
  } else {
    const encontradas = tagsDoCommit(tags, shaPorTag, headSha, estagio);
    conferencias.push(
      encontradas.length > 0
        ? {
            nome: 'degrau anterior carimbado',
            ok: true,
            detalhe: `o commit tem ${encontradas.map((t) => `\`${t}\``).join(', ')}.`,
          }
        : {
            nome: 'degrau anterior carimbado',
            ok: false,
            detalhe:
              `o commit ${headSha.slice(0, 8)} não tem nenhuma tag \`-${estagio}.N\`.\n` +
              `      Promover sem o carimbo do degrau de baixo é promover algo que\n` +
              `      nunca passou por lá. Espere o \`tag-release\` do merge em\n` +
              `      \`${head}\` terminar, ou confira por que ele não rodou.`,
          },
    );
  }

  // --- 3. merge commit habilitado.
  let permiteMergeCommit: boolean | null = null;
  try {
    permiteMergeCommit =
      execFileSync('gh', ['api', `repos/${repo}`, '--jq', '.allow_merge_commit'], {
        encoding: 'utf8',
      }).trim() === 'true';
  } catch {
    permiteMergeCommit = null;
  }

  conferencias.push(
    permiteMergeCommit === true
      ? {
          nome: 'merge --no-ff possível',
          ok: true,
          detalhe: 'o repositório permite merge commit — use "Create a merge commit", nunca squash.',
        }
      : permiteMergeCommit === false
        ? {
            nome: 'merge --no-ff possível',
            ok: false,
            detalhe:
              'o repositório NÃO permite merge commit.\n' +
              '      Promoção com squash achata os commits do degrau de baixo, e a\n' +
              '      tag do estágio passa a apontar para um commit que não existe\n' +
              '      mais. Habilite em Settings → General → Pull Requests.',
          }
        : {
            nome: 'merge --no-ff possível',
            ok: false,
            detalhe: 'não consegui ler a configuração do repositório — verificação impossível, e por isso reprovada.',
          },
  );

  // --- saída.
  const l: string[] = [];
  l.push(`promotion-check: ${head} → ${base}`);
  l.push('');
  for (const c of conferencias) {
    l.push(`  ${c.ok ? '✓' : '✗'} ${c.nome}`);
    l.push(`      ${c.detalhe}`);
  }
  l.push('');

  const falhas = conferencias.filter((c) => !c.ok);
  l.push(
    falhas.length === 0
      ? '  ✓ APROVADO — a promoção está em condições de ser mergeada.'
      : `  ✗ REPROVADO — ${falhas.length} de ${conferencias.length} conferências falharam.`,
  );
  l.push('');
  l.push('  A esteira inteira: docs/explanation/branching-policy.md');

  const saida = l.join('\n');
  console.log(saida);

  for (const c of falhas) {
    console.log(`::error title=promotion-check: ${c.nome}::${c.detalhe.split('\n')[0]}`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### promotion-check\n\n\`\`\`\n${saida}\n\`\`\`\n`,
    );
  }

  process.exit(falhas.length === 0 ? 0 : 1);
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}

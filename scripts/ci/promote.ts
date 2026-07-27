/**
 * promote — valida o par da esteira, calcula a versão do ciclo e escreve o
 * corpo do PR de promoção.
 * Fonte da política: docs/explanation/branching-policy.md
 *
 * Adaptador: a lógica de versão é pura e vive em `version.ts`. Aqui só se
 * coleta o estado (tags, PRs mergeados) e se renderiza.
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

import {
  CicloVazioError,
  classificar,
  explicarParInvalido,
  extrairNumerosDePr,
  lerPar,
  lerVersaoFinal,
  maiorImpacto,
  parEhAdjacente,
  proximaVersao,
  semTrafegoDaEsteira,
  type PrClassificado,
  type PrDoCiclo,
} from './version.ts';

const ROTULO_DO_IMPACTO = {
  major: 'MAJOR',
  minor: 'MINOR',
  patch: 'patch',
} as const;

/** O corpo do PR: cada PR do ciclo, seu impacto, e a versão proposta. */
export function corpoDaPromocao(
  de: string,
  para: string,
  versao: string,
  ultimaFinal: string | null,
  prs: PrClassificado[],
): string {
  const l: string[] = [];
  const impacto = maiorImpacto(prs)!;

  l.push(`Promoção **\`${de}\` → \`${para}\`**, gerada pelo workflow \`promote\`.`);
  l.push('');
  l.push(`## Versão do ciclo: \`${versao}\``);
  l.push('');
  l.push(
    `Calculada a partir de **${ultimaFinal ?? 'nenhuma tag final anterior'}**, ` +
      `pelo maior impacto do ciclo (**${ROTULO_DO_IMPACTO[impacto]}**).`,
  );
  l.push('');
  l.push(`## O ciclo — ${prs.length} PR${prs.length === 1 ? '' : 's'}`);
  l.push('');
  l.push('| PR | função | impacto | título |');
  l.push('|---|---|---|---|');
  for (const pr of prs) {
    const marca = pr.impacto === 'patch' ? '' : ' ⬅';
    l.push(
      `| #${pr.numero} | \`${pr.funcao}\` | ${ROTULO_DO_IMPACTO[pr.impacto]}${marca} | ${pr.titulo.replace(/\|/g, '\\|')} |`,
    );
  }
  l.push('');
  l.push('## O que acontece no merge');
  l.push('');
  l.push(
    para === 'main'
      ? `A tag final **\`${versao}\`** é criada — e só nasce se o commit for exatamente ` +
          'o da última `-qa.N`. Se não for, o workflow falha ruidosamente em vez de ' +
          'publicar algo que ninguém validou.'
      : `A tag **\`${versao}-qa.N\`** é criada. O \`N\` vem de quantas já existem: ` +
          'promover, reprovar e repromover gera `-qa.2`, e o número passa a dizer ' +
          'quantas voltas o ciclo deu.',
  );
  l.push('');
  l.push('> Merge com **merge commit** (`--no-ff`), nunca squash: a promoção precisa');
  l.push('> preservar os commits do degrau de baixo. O check de promoção confere isso');
  l.push('> depois do fato.');
  l.push('');
  l.push('<sub>A esteira inteira: `docs/explanation/branching-policy.md`</sub>');
  return l.join('\n');
}

// ------------------------------------------------------------- adaptador CLI

async function principal(): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  const { appendFileSync, writeFileSync } = await import('node:fs');

  const entradaDoPar = process.env.PAR ?? '';
  const repo = process.env.GITHUB_REPOSITORY ?? '';

  const falhar = (titulo: string, corpo: string): never => {
    console.error(`[promote] ${titulo}`);
    console.error(corpo);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### promote: ${titulo}\n\n\`\`\`\n${corpo}\n\`\`\`\n`,
      );
    }
    console.log(`::error title=promote::${titulo}`);
    process.exit(1);
  };

  // --- 1. o par.
  const par = lerPar(entradaDoPar);
  if (!par) {
    falhar(
      'par inválido',
      `"${entradaDoPar}" não é um par da esteira.\n` +
        '  O formato é `origem->destino`, e as duas precisam ser permanentes.\n' +
        '  Os pares válidos: `dev->qa` e `qa->main`.',
    );
    return;
  }

  if (!parEhAdjacente(par)) {
    falhar('par não adjacente', explicarParInvalido(par));
    return;
  }

  // --- 2. a última final.
  const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' })
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);

  const finais = tags
    .map((t) => ({ tag: t, v: lerVersaoFinal(t) }))
    .filter((x): x is { tag: string; v: NonNullable<ReturnType<typeof lerVersaoFinal>> } => x.v !== null)
    .sort((a, b) => a.v.major - b.v.major || a.v.minor - b.v.minor || a.v.patch - b.v.patch);

  const ultimaFinal = finais.length > 0 ? finais[finais.length - 1]!.tag : null;

  // --- 3. os PRs do ciclo.
  //
  // O range é `<última final>..origin/dev` e não `..origin/<de>`: a versão do
  // ciclo é decidida pelo que ENTROU no fluxo, e tudo entra por `dev`. Numa
  // promoção `qa->main` o conteúdo já passou por `dev`, então o ciclo é o
  // mesmo — o que muda é só o carimbo.
  const range = ultimaFinal ? `${ultimaFinal}..origin/dev` : 'origin/dev';
  // COM os merges: o número do PR só aparece no assunto do merge commit quando
  // o merge não é squash, e `--no-merges` escondia justamente essa linha.
  // Mesma causa do ciclo vazio no `tag-release`. Ver `extrairNumerosDePr`.
  const assuntos = execFileSync('git', ['log', '--pretty=format:%s', range], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);

  const numeros = extrairNumerosDePr(assuntos);

  const todosOsPrs: PrDoCiclo[] = [];
  for (const numero of numeros) {
    try {
      const json = execFileSync(
        'gh',
        ['api', `repos/${repo}/pulls/${numero}`, '--jq', '{titulo: .title, branch: .head.ref}'],
        { encoding: 'utf8' },
      );
      const { titulo, branch } = JSON.parse(json) as { titulo: string; branch: string };
      todosOsPrs.push({ numero, titulo, branch });
    } catch {
      // PR que não resolve entra como patch, com o assunto do commit. Melhor
      // subestimar o impacto e seguir do que travar a promoção — e o corpo do
      // PR mostra a função vazia, então dá para ver.
      const assunto = assuntos.find((a) => a.includes(`(#${numero})`)) ?? `PR #${numero}`;
      todosOsPrs.push({ numero, titulo: assunto, branch: '' });
      console.log(`::warning::não consegui ler o PR #${numero} pela API; entrou como patch`);
    }
  }

  // Promoção e retropropagação não são trabalho do ciclo — o que carregam já
  // foi contado, ou já foi lançado.
  const prs = semTrafegoDaEsteira(todosOsPrs);
  console.log(
    `[promote] ciclo desde ${ultimaFinal ?? 'o início'}: ` +
      (prs.length > 0 ? prs.map((p) => `#${p.numero} (${p.branch})`).join(', ') : 'vazio'),
  );

  // --- 4. a versão.
  let versao: string;
  try {
    versao = proximaVersao(ultimaFinal, prs);
  } catch (erro) {
    if (erro instanceof CicloVazioError) {
      falhar('ciclo vazio', erro.message);
      return;
    }
    throw erro;
  }

  const classificados = classificar(prs);

  // --- 5. a saída.
  writeFileSync(
    'corpo-da-promocao.md',
    corpoDaPromocao(par.de, par.para, versao, ultimaFinal, classificados),
  );

  const saida: Record<string, string> = {
    de: par.de,
    para: par.para,
    versao,
    ultima_final: ultimaFinal ?? '',
    quantidade: String(prs.length),
  };

  for (const [chave, valor] of Object.entries(saida)) {
    console.log(`${chave}=${valor}`);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${chave}=${valor}\n`);
    }
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### promote: ${par.de} → ${par.para}\n\n` +
        `Versão do ciclo: **${versao}** (a partir de ${ultimaFinal ?? '—'}, ${prs.length} PRs)\n`,
    );
  }
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}

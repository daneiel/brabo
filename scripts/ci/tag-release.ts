/**
 * tag-release — decide qual tag carimbar no commit que acabou de entrar numa
 * permanente.
 * Fonte da política: docs/explanation/branching-policy.md
 *
 * Adaptador do `version.ts`. A regra por branch:
 *
 *   dev  → vX.Y.Z-dev.N   (X.Y.Z é a versão PROJETADA do ciclo em andamento)
 *   qa   → vX.Y.Z-qa.N
 *   main → vX.Y.Z final, e SÓ se o commit for o da última -qa.N
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

import type { Permanente } from './pr-police.ts';
import {
  CicloVazioError,
  lerVersaoFinal,
  montarTag,
  proximaVersao,
  proximoN,
  verificarAncora,
  type Estagio,
  type PrDoCiclo,
} from './version.ts';

async function principal(): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  const { appendFileSync } = await import('node:fs');

  const branch = (process.env.BRANCH ?? '') as Permanente;
  const sha = process.env.SHA ?? '';
  const repo = process.env.GITHUB_REPOSITORY ?? '';

  const emitir = (chave: string, valor: string): void => {
    console.log(`${chave}=${valor}`);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${chave}<<FIM\n${valor}\nFIM\n`);
    }
  };

  const git = (...args: string[]): string =>
    execFileSync('git', args, { encoding: 'utf8' }).trim();

  const tags = git('tag', '--list', 'v*').split('\n').map((t) => t.trim()).filter(Boolean);

  const finais = tags
    .map((t) => ({ tag: t, v: lerVersaoFinal(t) }))
    .filter((x): x is { tag: string; v: NonNullable<ReturnType<typeof lerVersaoFinal>> } => x.v !== null)
    .sort((a, b) => a.v.major - b.v.major || a.v.minor - b.v.minor || a.v.patch - b.v.patch);

  const ultimaFinal = finais.length > 0 ? finais[finais.length - 1]!.tag : null;

  // Os PRs do ciclo: tudo que entrou desde a última final. O range é sempre
  // contra `dev`, porque é por lá que o trabalho entra — `qa` e `main` só
  // recebem o mesmo conteúdo carimbado de novo.
  const range = ultimaFinal ? `${ultimaFinal}..origin/dev` : 'origin/dev';
  let assuntos: string[] = [];
  try {
    assuntos = git('log', '--no-merges', '--pretty=format:%s', range).split('\n').filter(Boolean);
  } catch {
    assuntos = [];
  }

  const numeros = [
    ...new Set(assuntos.flatMap((a) => [...a.matchAll(/\(#(\d+)\)\s*$/g)].map((m) => Number(m[1])))),
  ];

  const prs: PrDoCiclo[] = numeros.map((numero) => {
    try {
      const json = execFileSync(
        'gh',
        ['api', `repos/${repo}/pulls/${numero}`, '--jq', '{titulo: .title, branch: .head.ref}'],
        { encoding: 'utf8' },
      );
      const { titulo, branch: b } = JSON.parse(json) as { titulo: string; branch: string };
      return { numero, titulo, branch: b };
    } catch {
      return { numero, titulo: `PR #${numero}`, branch: '' };
    }
  });

  let versao: string;
  try {
    versao = proximaVersao(ultimaFinal, prs);
  } catch (erro) {
    if (erro instanceof CicloVazioError) {
      // Merge sem PR novo desde a última final — acontece num backmerge ou
      // numa promoção que não trouxe nada. Não é erro: é ausência de ciclo, e
      // carimbar aqui produziria uma tag mentirosa.
      console.log(`::notice::${erro.message.split('\n')[0]} — nenhuma tag criada.`);
      emitir('tag', '');
      return;
    }
    throw erro;
  }

  // --- main: a final, e só se a âncora bater.
  if (branch === 'main') {
    const shaPorTag: Record<string, string> = {};
    for (const t of tags) {
      try {
        shaPorTag[t] = git('rev-list', '-n1', t);
      } catch {
        // Tag que não resolve fica de fora; `verificarAncora` trata a ausência
        // como verificação impossível — e reprova.
      }
    }

    const ancora = verificarAncora(versao, tags, shaPorTag, sha);
    if (!ancora.ok) {
      const titulo = `a tag final ${versao} NÃO pode ser criada`;
      console.error(`[tag-release] ${titulo}`);
      console.error(`  ${ancora.motivo}`);
      console.log(`::error title=tag-release::${titulo}`);
      if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          `### tag-release: âncora inválida\n\n\`\`\`\n${titulo}\n\n${ancora.motivo}\n\`\`\`\n`,
        );
      }
      process.exit(1);
    }

    emitir('tag', versao);
    emitir(
      'mensagem',
      `${versao} — final do ciclo, ancorada em ${ancora.tagEsperada} (${prs.length} PRs).`,
    );
    return;
  }

  // --- qa e main só recebem PROMOÇÃO, e promoção é `--no-ff`.
  //
  // Esta é a verificação que VALE: o `promotion-check` só consegue olhar a
  // configuração do repositório, e nem sempre tem permissão para isso. Aqui se
  // olha o fato consumado — um commit de promoção tem DOIS pais. Se tiver um
  // só, alguém usou squash e os commits do degrau de baixo foram achatados:
  // a tag apontaria para um commit que não existe mais lá embaixo.
  if (branch === 'qa') {
    const pais = git('rev-list', '--parents', '-n1', sha).split(/\s+/).length - 1;
    if (pais < 2) {
      const titulo = `o merge em \`qa\` não é merge commit (${pais} pai)`;
      console.error(`[tag-release] ${titulo}`);
      console.error(
        '  Promoção precisa de `--no-ff`. Com squash, os commits que vieram de\n' +
          '  `dev` são achatados num só, e a tag `-dev.N` passa a apontar para um\n' +
          '  commit que não está mais no histórico de `qa`.\n' +
          '  Desfaça o merge e refaça com "Create a merge commit".',
      );
      console.log(`::error title=tag-release::${titulo}`);
      process.exit(1);
    }
  }

  // --- dev e qa: o carimbo do estágio.
  const estagio = branch as Estagio;
  const n = proximoN(tags, versao, estagio);
  const tag = montarTag(versao, estagio, n);

  emitir('tag', tag);
  emitir(
    'mensagem',
    n === 1
      ? `${tag} — primeiro carimbo de ${versao} em ${estagio} (${prs.length} PRs no ciclo).`
      : `${tag} — volta ${n} de ${versao} em ${estagio}: o ciclo foi reprovado ${n - 1} vez(es) antes.`,
  );
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}

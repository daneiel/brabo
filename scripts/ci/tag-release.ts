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
 *        → ou vX.Y.(Z+1) quando o merge for HOTFIX: ele nasce de `main`, nunca
 *          passa por `qa`, e exigir âncora dele seria exigir o impossível.
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

import type { Permanente } from './pr-police.ts';
import {
  CicloVazioError,
  conferirMergeDeEsteira,
  extrairNumerosDePr,
  identificarCaminho,
  lerVersaoFinal,
  montarTag,
  proximaVersao,
  proximoN,
  semTrafegoDaEsteira,
  SemFinalError,
  verificarAncora,
  versaoDeHotfix,
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

  const paisDoCommit = git('rev-list', '--parents', '-n1', sha).split(/\s+/).slice(1);

  // --- o commit do gate não é release nenhum.
  //
  // `.release/gate.json` é a ÚNICA escrita direta em permanente além das tags,
  // e ela é do bot. Um commit desses tem um pai só; sem esta saída, o caminho
  // do hotfix o veria como "merge sem segundo pai" e reprovaria. A checagem é
  // pelo CONTEÚDO do commit, não pelo autor nem pela mensagem: quem escreve é
  // verificável, quem diz que escreveu não é.
  const alterados = git('show', '--name-only', '--pretty=format:', sha)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (alterados.length > 0 && alterados.every((a) => a.startsWith('.release/'))) {
    console.log('::notice::commit do gate (só `.release/`) — nada a carimbar.');
    emitir('tag', '');
    return;
  }

  // --- esteira sem segundo pai: o alarme que só pode tocar DEPOIS do merge.
  //
  // O método de merge é escolhido no clique, então nenhum check de PR alcança
  // isto — o `promotion-check` no máximo lê a configuração do repositório, e
  // nem sempre tem permissão. Aqui se olha o fato consumado, e por isso este
  // é o lugar da verdade.
  //
  // Vem ANTES de tudo (só depois da isenção do commit do gate, que é o único
  // commit de um pai legítimo numa permanente): falhar cedo dá a mensagem
  // certa em vez de um sintoma três etapas adiante — foi assim que um squash
  // em `main` aparecia como "âncora inválida", que não ensina nada a quem lê.
  //
  // A regra difere por branch e quem decide é `conferirMergeDeEsteira`: em
  // `qa`/`main` só entra esteira, então um pai é sempre defeito; em `dev`
  // entra trabalho por squash o tempo todo, então só é defeito quando o PR
  // veio de uma permanente.
  // `trazAresta` só importa em `dev`, e responder exige três passos — por isso
  // fica atrás do `branch === 'dev'`: em `qa`/`main` a regra não depende disto
  // e gastar três chamadas de rede seria pagar por uma resposta ignorada.
  const trazAresta = ((): boolean | null => {
    if (branch !== 'dev' || !repo || paisDoCommit.length >= 2) return null;

    try {
      // 1. QUAL PR produziu este commit. Filtrar por `merge_commit_sha` é
      //    obrigatório, não estilo: `commits/{sha}/pulls` devolve TODO PR
      //    associado ao commit, e como `dev` é o head do PR de promoção
      //    aberto, todo commit de `dev` vem associado a ELE. Ler `.[0]`
      //    devolveria "dev" para qualquer squash de PR de trabalho — e a
      //    regra reprovaria o repositório inteiro.
      const headSha = execFileSync(
        'gh',
        [
          'api',
          `repos/${repo}/commits/${sha}/pulls`,
          '--jq',
          `.[] | select(.merge_commit_sha == "${sha}") | .head.sha`,
        ],
        { encoding: 'utf8' },
      )
        .trim()
        .split('\n')[0];

      if (!headSha) return null;

      // 2. O head do PR era um merge? Se não, não havia aresta a perder.
      const paisDoHead = execFileSync(
        'gh',
        ['api', `repos/${repo}/commits/${headSha}`, '--jq', '.parents[].sha'],
        { encoding: 'utf8' },
      )
        .trim()
        .split('\n')
        .filter(Boolean);

      if (paisDoHead.length < 2) return false;

      // 3. A aresta era NOVA? O segundo pai do head já estava na base antes
      //    deste merge (primeiro pai do commit que entrou)? Se já estava, o
      //    PR só puxou `dev` para dentro de si — caso comum e benigno, e o
      //    squash não perde nada. Se não estava, o PR carregava ancestralidade
      //    que só existia nele.
      const base = paisDoCommit[0];
      if (!base) return null;

      try {
        execFileSync('git', ['merge-base', '--is-ancestor', paisDoHead[1]!, base], {
          stdio: 'ignore',
        });
        return false;
      } catch (erro) {
        // 1 = não é ancestral, e aí a aresta era nova mesmo. Qualquer outro
        // código é ERRO de execução (objeto ausente no clone, por exemplo), e
        // erro não é resposta.
        return (erro as { status?: number }).status === 1 ? true : null;
      }
    } catch {
      return null;
    }
  })();

  const esteira = conferirMergeDeEsteira({
    branch,
    pais: paisDoCommit.length,
    trazAresta,
  });

  if (!esteira.ok) {
    console.error(`[tag-release] ${esteira.motivo}`);
    console.log(`::error title=tag-release::${esteira.motivo.split('\n')[0]}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### tag-release: merge de esteira sem segundo pai\n\n\`\`\`\n${esteira.motivo}\n\`\`\`\n`,
      );
    }
    process.exit(1);
  }
  console.log(`[tag-release] esteira: ${esteira.motivo.split('\n')[0]}`);

  // --- retropropagação não carimba.
  //
  // Um backmerge `main` → `qa` traz conteúdo que já está em `main`. Sem esta
  // saída, o cálculo do ciclo veria os PRs que `dev` acumulou desde a última
  // final e carimbaria uma `-qa.N` num commit que nunca foi promovido de
  // `dev` — uma tag dizendo "isto passou por qa" sobre algo que não passou.
  if (branch === 'qa' || branch === 'dev') {
    const segundoPai = paisDoCommit[1];
    if (segundoPai) {
      const contido = ((): boolean | null => {
        try {
          execFileSync('git', ['merge-base', '--is-ancestor', segundoPai, 'origin/main'], {
            stdio: 'ignore',
          });
          return true;
        } catch (erro) {
          // 1 = não é ancestral. Qualquer outro código é ERRO de execução, e
          // erro não é resposta: não dá para dizer "não é backmerge" só porque
          // o comando falhou.
          const status = (erro as { status?: number }).status;
          return status === 1 ? false : null;
        }
      })();

      if (contido === null) {
        console.error(
          '[tag-release] não consegui verificar se o merge veio de `main`.\n' +
            '  Sem essa resposta, carimbar arriscaria uma tag mentirosa e não\n' +
            '  carimbar arriscaria pular um estágio. Falha ruidosa de propósito.',
        );
        console.log('::error title=tag-release::verificação de retropropagação impossível');
        process.exit(1);
      }

      if (contido) {
        console.log(
          `::notice::retropropagação de \`main\` para \`${branch}\` — nada a carimbar.`,
        );
        emitir('tag', '');
        emitir('retropropagacao', 'sim');
        return;
      }
    }
  }

  // --- main tem DOIS caminhos, e eles pedem versões diferentes. Descobrir
  // qual é ANTES de calcular a versão do ciclo: um hotfix costuma entrar com
  // `dev` parada, e o cálculo do ciclo diria "nada a promover" — matando
  // justamente a tag PATCH que o gate de retropropagação usa de referência.
  if (branch === 'main') {
    const shaPorTag: Record<string, string> = {};
    for (const t of tags) {
      try {
        shaPorTag[t] = git('rev-list', '-n1', t);
      } catch {
        // Tag que não resolve fica de fora; a ausência nunca vira aprovação.
      }
    }

    const caminho = identificarCaminho(paisDoCommit, tags, shaPorTag);
    console.log(`[tag-release] caminho: ${caminho.caminho} — ${caminho.motivo}`);

    if (caminho.caminho === 'hotfix') {
      if (paisDoCommit.length < 2) {
        // Sem segundo pai não dá para dizer o que entrou. Chutar aqui
        // carimbaria uma versão em produção por adivinhação.
        const titulo = `merge em \`main\` sem segundo pai (${paisDoCommit.length}) — caminho indeterminável`;
        console.error(`[tag-release] ${titulo}`);
        console.log(`::error title=tag-release::${titulo}`);
        process.exit(1);
      }

      let versaoDoHotfix: string;
      try {
        versaoDoHotfix = versaoDeHotfix(ultimaFinal);
      } catch (erro) {
        if (erro instanceof SemFinalError) {
          console.error(`[tag-release] ${erro.message}`);
          console.log(`::error title=tag-release::${erro.message.split('\n')[0]}`);
          process.exit(1);
        }
        throw erro;
      }

      emitir('tag', versaoDoHotfix!);
      emitir(
        'mensagem',
        `${versaoDoHotfix!} — hotfix direto em \`main\`, sobre ${ultimaFinal}.\n` +
          'A correção ainda NÃO está em `qa` nem em `dev`: o gate trava os dois\n' +
          'até as retropropagações entrarem.',
      );
      emitir('hotfix', 'sim');
      return;
    }
  }

  // Os PRs do ciclo: tudo que entrou desde a última final. O range é sempre
  // contra `dev`, porque é por lá que o trabalho entra — `qa` e `main` só
  // recebem o mesmo conteúdo carimbado de novo.
  const range = ultimaFinal ? `${ultimaFinal}..origin/dev` : 'origin/dev';
  let assuntos: string[] = [];
  try {
    // COM os merges. O `--no-merges` que estava aqui escondia exatamente a
    // linha que cita o número num PR mergeado por merge commit — e aí o ciclo
    // inteiro parecia vazio. Ver `extrairNumerosDePr`.
    assuntos = git('log', '--pretty=format:%s', range).split('\n').filter(Boolean);
  } catch {
    assuntos = [];
  }

  const numeros = extrairNumerosDePr(assuntos);

  const todosOsPrs: PrDoCiclo[] = numeros.map((numero) => {
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

  // Promoção e retropropagação não são trabalho do ciclo: o que elas carregam
  // já foi contado, ou já foi lançado.
  const prs = semTrafegoDaEsteira(todosOsPrs);
  const descartados = todosOsPrs.length - prs.length;
  if (descartados > 0) {
    console.log(`[tag-release] ${descartados} PR(s) de esteira fora do ciclo.`);
  }
  console.log(
    `[tag-release] ciclo desde ${ultimaFinal ?? 'o início'}: ` +
      (prs.length > 0 ? prs.map((p) => `#${p.numero} (${p.branch})`).join(', ') : 'vazio'),
  );

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

  // --- main pelo caminho da PROMOÇÃO: a final, e só se a âncora bater.
  // (o caminho do hotfix já saiu lá em cima, com a tag PATCH.)
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

    // Árvore e pais: sem eles a âncora não consegue validar uma promoção por
    // merge commit, que é o caso NORMAL — `--no-ff` cria um commit novo, e o
    // sha de `main` nunca vai ser o de `qa`.
    const treePorTag: Record<string, string> = {};
    for (const t of tags) {
      try {
        treePorTag[t] = git('rev-parse', `${t}^{tree}`);
      } catch {
        // Tag que não resolve fica de fora; a ausência vira reprovação.
      }
    }

    const ancora = verificarAncora(versao, tags, shaPorTag, sha, {
      treeDoCommit: git('rev-parse', `${sha}^{tree}`),
      treePorTag,
      paisDoCommit: git('rev-list', '--parents', '-n1', sha).split(/\s+/).slice(1),
    });
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

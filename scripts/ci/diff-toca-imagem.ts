/**
 * diff-toca-imagem — decide se o job `images` do `ci.yml` precisa construir,
 * escanear e subir as imagens de produção para ESTE PR (AT-303).
 *
 * O job `images` é o mais lento do CI (bake das cinco imagens, Trivy, broker
 * healthy, smoke do compose de produção e E2E de navegador), e um PR que só
 * mexe em documentação pagava tudo isso para provar de novo que nada mudou.
 *
 * Por que PASSO e não gatilho: o check `Build, scan e smoke das imagens de
 * produção` é o que a proteção de branch exige, e check exigido é indexado
 * pelo SHA. `paths:` no gatilho faria o workflow não rodar — check pendente
 * para sempre, PR travado. `if:` no JOB faria o GitHub registrar `skipped`,
 * e um re-run por outro evento colaria o veredito errado no mesmo SHA. Por
 * isso o job SEMPRE roda e SEMPRE conclui: o primeiro passo chama este
 * script, e os passos pesados levam `if: steps.<id>.outputs.rodar == 'true'`.
 * Pular termina VERDE, dizendo por quê no resumo do job.
 *
 * A regra é uma lista de PERMITIDOS — o que se sabe que NÃO entra em imagem,
 * nem no smoke, nem no E2E. Tudo que não casa com ela roda o job inteiro. E
 * as duas incertezas também rodam tudo: diff vazio (nada a provar, mas nada
 * a afirmar) e diff que não se conseguiu calcular. Na dúvida, roda.
 *
 * As exceções DENTRO das pastas permitidas não são enfeite, e o spec ao lado
 * as prova contra a árvore real:
 *   - `docs/gates.yml` é o ÚNICO arquivo de `docs/` que a imagem da api
 *     carrega (`docker/api/Dockerfile.prod`, e o `!docs/gates.yml` do
 *     `.dockerignore`) — a api o lê em runtime e o smoke o cobra (RN-070);
 *   - `THIRD_PARTY_NOTICES.md` é o único `.md` da raiz copiado para uma
 *     imagem (a do engine);
 *   - `.github/workflows/ci.yml` é onde os PRÓPRIOS passos do job moram.
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

import { appendFileSync, readFileSync } from 'node:fs';

/** Um caminho que se sabe estar fora de toda imagem, do smoke e do E2E. */
export interface RegraSemImagem {
  descricao: string;
  casa: (arquivo: string) => boolean;
}

/** `.md` direto na raiz (sem barra), exceto o que o engine copia. */
function mdDaRaiz(arquivo: string): boolean {
  return !arquivo.includes('/') && arquivo.endsWith('.md') && arquivo !== 'THIRD_PARTY_NOTICES.md';
}

export const REGRAS_SEM_IMAGEM: readonly RegraSemImagem[] = [
  {
    descricao: 'docs/ (exceto docs/gates.yml, que a imagem da api carrega)',
    casa: (a) => a.startsWith('docs/') && a !== 'docs/gates.yml',
  },
  { descricao: 'website/ (o site de documentação)', casa: (a) => a.startsWith('website/') },
  { descricao: 'scripts/docs/ (geradores e checagens da documentação)', casa: (a) => a.startsWith('scripts/docs/') },
  { descricao: 'deploy/k8s/ (manifestos: descrevem como a imagem roda, nunca são lidos por ela)', casa: (a) => a.startsWith('deploy/k8s/') },
  {
    descricao: '.github/ (exceto .github/workflows/ci.yml, onde este job mora)',
    casa: (a) => a.startsWith('.github/') && a !== '.github/workflows/ci.yml',
  },
  { descricao: '*.md da raiz (exceto THIRD_PARTY_NOTICES.md, copiado para a imagem do engine)', casa: mdDaRaiz },
  { descricao: 'design/*.md (o .dockerignore os exclui; design/tokens.css NÃO)', casa: (a) => /^design\/[^/]+\.md$/.test(a) },
];

export interface Classificacao {
  /** `true` = rodar o job inteiro. */
  rodar: boolean;
  /** Frase para o resumo do job — sempre diz POR QUÊ. */
  motivo: string;
  /** Os arquivos do diff que obrigam a rodar (vazio quando pula). */
  tocam: string[];
}

/** O arquivo casa com alguma regra de "fora de imagem"? */
export function foraDeImagem(arquivo: string, regras: readonly RegraSemImagem[] = REGRAS_SEM_IMAGEM): boolean {
  return regras.some((regra) => regra.casa(arquivo));
}

/**
 * @param arquivos - saída de `git diff --name-only --no-renames`, uma linha
 *   por arquivo, ou `null` quando o diff não pôde ser calculado.
 */
export function classificar(
  arquivos: readonly string[] | null,
  regras: readonly RegraSemImagem[] = REGRAS_SEM_IMAGEM,
): Classificacao {
  if (arquivos === null) {
    return { rodar: true, motivo: 'o diff do PR não pôde ser calculado — na dúvida, roda tudo.', tocam: [] };
  }

  const limpos = arquivos.map((a) => a.trim()).filter((a) => a.length > 0);
  if (limpos.length === 0) {
    return { rodar: true, motivo: 'o diff do PR veio vazio — na dúvida, roda tudo.', tocam: [] };
  }

  const tocam = limpos.filter((a) => !foraDeImagem(a, regras));
  if (tocam.length > 0) {
    return {
      rodar: true,
      motivo: `${tocam.length} de ${limpos.length} arquivo(s) do diff podem entrar em imagem, no smoke ou no E2E.`,
      tocam,
    };
  }

  return {
    rodar: false,
    motivo:
      `os ${limpos.length} arquivo(s) do diff estão todos fora de imagem, do smoke e do E2E ` +
      '(docs, site, manifestos, workflows que não são o ci.yml) — build, Trivy, smoke e E2E pulados.',
    tocam: [],
  };
}

// --- CLI -------------------------------------------------------------------
//
// `git diff --name-only --no-renames HEAD^1 HEAD | node scripts/ci/diff-toca-imagem.ts`
// Sem stdin legível (o `git diff` falhou antes), `DIFF_INDISPONIVEL=1` força o
// ramo "não pôde ser calculado".

function principal(): void {
  let arquivos: string[] | null = null;
  if (process.env.DIFF_INDISPONIVEL !== '1') {
    try {
      arquivos = readFileSync(0, 'utf8').split('\n');
    } catch {
      arquivos = null;
    }
  }

  const { rodar, motivo, tocam } = classificar(arquivos);

  console.log(`diff-toca-imagem: rodar=${rodar} — ${motivo}`);
  for (const arquivo of tocam.slice(0, 20)) console.log(`  toca: ${arquivo}`);
  if (tocam.length > 20) console.log(`  … e mais ${tocam.length - 20}.`);

  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `rodar=${rodar}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const titulo = rodar ? '### Imagens: job completo' : '### Imagens: build, scan, smoke e E2E PULADOS';
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${titulo}\n\n${motivo}\n`);
  }
}

if (process.argv[1]?.endsWith('diff-toca-imagem.ts')) {
  principal();
}

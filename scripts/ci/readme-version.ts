/**
 * Põe a versão recém-lançada na prosa do README, no MESMO commit em que o
 * CHANGELOG é cortado.
 *
 * ## Por que existe
 *
 * O README anunciou `v0.1.0` da Fase 5 até a v2.1.0 — sete releases atrás da
 * realidade, na primeira coisa que quem chega lê. A conferência que passou a
 * cobrar isso (`verificarVersaoNoReadme` em `scripts/docs/generate.mjs`) pegaria
 * a mentira, mas cobraria de quem não pode consertar: a PR do CHANGELOG é
 * ABERTA PELO BOT e só toca `CHANGELOG.md`, então todo release nasceria com o
 * drift vermelho esperando mão humana.
 *
 * A saída é a de sempre neste repositório: **gerar > verificar > lembrar**
 * (ADR 0029). Aqui a versão é gerável — o release sabe qual é —, então ela é
 * gerada, e a conferência vira backstop para o caso de alguém mexer na frase.
 *
 * O badge não passa por aqui: ele lê a release do GitHub direto e já se
 * atualiza sozinho.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ARQUIVO = 'README.md';

/**
 * A frase que o README usa para anunciar a versão. Precisa bater com o padrão
 * de `verificarVersaoNoReadme`: são os dois lados do mesmo contrato, e se
 * divergirem um escreve o que o outro não encontra.
 */
const PADRAO = /versão \*\*v(\d+\.\d+\.\d+)\*\*/;

export interface Troca {
  texto: string;
  /** A versão que estava lá. `null` quando a frase não foi encontrada. */
  anterior: string | null;
}

/**
 * Troca a versão anunciada. Não encontrar a frase devolve `anterior: null` em
 * vez de lançar: quem chama decide se isso reprova (o release reprova).
 * Silenciar seria pior — o mesmo modo de falha do check que fica verde para
 * sempre porque a regex parou de casar.
 */
export function trocarVersaoNoReadme(texto: string, tag: string): Troca {
  const versao = tag.replace(/^v/, '');
  const achado = PADRAO.exec(texto);

  if (achado === null) return { texto, anterior: null };

  return {
    texto: texto.replace(PADRAO, `versão **v${versao}**`),
    // O grupo 1 existe sempre que o padrão casa; `?? null` é só para o
    // typecheck estrito do pacote de scripts, não um caso real.
    anterior: achado[1] ?? null,
  };
}

// --- CLI: `node scripts/ci/readme-version.ts v2.2.0` -------------------------

if (process.argv[1]?.endsWith('readme-version.ts')) {
  const tag = process.argv[2];

  if (!tag || !/^v?\d+\.\d+\.\d+$/.test(tag)) {
    console.error('uso: node scripts/ci/readme-version.ts vX.Y.Z');
    process.exit(2);
  }

  const { texto, anterior } = trocarVersaoNoReadme(readFileSync(ARQUIVO, 'utf8'), tag);

  if (anterior === null) {
    console.error(
      `::error::não achei "versão **vX.Y.Z**" em ${ARQUIVO}. A frase mudou — ` +
        'ajuste o padrão aqui E em scripts/docs/generate.mjs, que confere o mesmo texto.',
    );
    process.exit(1);
  }

  const novo = tag.replace(/^v/, '');
  if (anterior === novo) {
    console.log(`[readme-version] já estava em v${novo} — nada a fazer.`);
    process.exit(0);
  }

  writeFileSync(ARQUIVO, texto);
  console.log(`[readme-version] v${anterior} → v${novo}`);
}

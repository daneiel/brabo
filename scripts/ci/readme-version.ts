/**
 * Põe a versão recém-lançada na prosa que a anuncia, no MESMO commit em que o
 * CHANGELOG é cortado.
 *
 * ## Por que existe
 *
 * O README anunciou `v0.1.0` da Fase 5 até a v2.1.0 — sete releases atrás da
 * realidade, na primeira coisa que quem chega lê. A conferência que passou a
 * cobrar isso (`verificarVersaoAnunciada` em `scripts/docs/generate.mjs`)
 * pegaria a mentira, mas cobraria de quem não pode consertar: a PR do CHANGELOG
 * é ABERTA PELO BOT e só toca `CHANGELOG.md`, então todo release nasceria com o
 * drift vermelho esperando mão humana.
 *
 * A saída é a de sempre neste repositório: **gerar > verificar > lembrar**
 * (ADR 0029). Aqui a versão é gerável — o release sabe qual é —, então ela é
 * gerada, e a conferência vira backstop para o caso de alguém mexer na frase.
 *
 * ## São DOIS arquivos
 *
 * O `docs/intro.md` é a primeira página do site publicado, e anunciava a versão
 * pela mesma frase — presa em `v0.1.0` com o produto na Fase 26. Ele entra aqui
 * junto com o README pelo motivo acima e não por simetria: assim que o check
 * passou a conferir os dois, deixar um fora do gerador faria todo release
 * nascer vermelho na PR do bot.
 *
 * O badge não passa por aqui: ele lê a release do GitHub direto e já se
 * atualiza sozinho.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** Os arquivos que anunciam a versão em prosa, na ordem em que o CLI os grava. */
const ARQUIVOS = ['README.md', 'docs/intro.md'];

/**
 * A frase usada para anunciar a versão. Precisa bater com o padrão de
 * `verificarVersaoAnunciada`: são os dois lados do mesmo contrato, e se
 * divergirem um escreve o que o outro não encontra.
 *
 * `docs/intro.md` foi traduzido pra inglês (Onda 6b) e o README não — "versão"
 * virou "version" só num dos dois arquivos. O grupo 1 captura qual PALAVRA
 * casou para a troca devolver a mesma, em vez de fixar "versão" e quebrar
 * silenciosamente o arquivo em inglês (ou vice-versa, se o README também for
 * traduzido depois).
 */
const PADRAO = /(versão|version) \*\*v(\d+\.\d+\.\d+)\*\*/;

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
export function trocarVersaoAnunciada(texto: string, tag: string): Troca {
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

  const novo = tag.replace(/^v/, '');

  // Todos os arquivos são LIDOS e trocados antes de qualquer escrita: a frase
  // ausente num deles reprova o release inteiro sem deixar metade gravada.
  const trocas = ARQUIVOS.map((arquivo) => ({
    arquivo,
    ...trocarVersaoAnunciada(readFileSync(arquivo, 'utf8'), tag),
  }));

  const cegos = trocas.filter((t) => t.anterior === null);
  if (cegos.length > 0) {
    console.error(
      `::error::não achei "versão **vX.Y.Z**" em ${cegos.map((c) => c.arquivo).join(', ')}. ` +
        'A frase mudou — ajuste o padrão aqui E em scripts/docs/generate.mjs, que confere o ' +
        'mesmo texto.',
    );
    process.exit(1);
  }

  for (const { arquivo, texto, anterior } of trocas) {
    if (anterior === novo) {
      console.log(`[readme-version] ${arquivo} já estava em v${novo} — nada a fazer.`);
      continue;
    }
    writeFileSync(arquivo, texto);
    console.log(`[readme-version] ${arquivo}: v${anterior} → v${novo}`);
  }
}

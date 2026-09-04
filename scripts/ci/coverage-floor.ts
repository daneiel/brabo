/**
 * coverage-floor — piso (ratchet) sobre a % de cobertura do engine.
 *
 * ## Por que existe
 *
 * O CI rodava `mix test` sem `--cover` e sem NENHUM piso configurado em
 * lugar nenhum: cobertura podia cair release após release sem ninguém
 * perceber. A instrução do produto foi explícita — nada de `excoveralls`,
 * porque `mix.exs` já suporta `mix test --cover` nativamente via o `:cover`
 * do OTP (uma lib de terceiro a mais custaria manutenção para reimplementar
 * o que a ferramenta padrão já faz).
 *
 * O `:cover` do OTP tem um piso EMBUTIDO de 90% (`test_coverage: [summary:
 * [threshold: X]]`, default 90) que reprovaria `mix test --cover` sozinho,
 * sem relação nenhuma com o piso do produto. `apps/engine/mix.exs` zera esse
 * threshold (`summary: [threshold: 0]`) de propósito: quem decide passa/
 * falha é ESTE script, testável e no valor REAL medido hoje — não uma
 * constante da ferramenta que ninguém escolheu.
 *
 * ## O que é RATCHET, não meta
 *
 * O piso em `coverage-floor.json` é o valor medido HOJE, arredondado para
 * baixo com margem de segurança — não uma aspiração. Ele sobe quando
 * cobertura sobe de verdade (edição manual do JSON, na mesma PR que subiu a
 * cobertura); nunca desce sozinho. O script NUNCA reescreve o arquivo:
 * subir o piso é decisão humana, e reescrever sozinho tornaria a régua
 * decorativa (mesma lição do `permissions.json` — quem baixa a régua sem
 * querer descobre isso lendo o diff, não vendo o CI ficar verde).
 *
 * ## Formato de entrada
 *
 * A saída de `mix test --cover` chega pelo STDIN (`mix test --cover 2>&1 |
 * node scripts/ci/coverage-floor.ts`), e a extração procura a linha final
 * da tabela que o `:cover` imprime (SEM pipe abrindo nem fechando a linha —
 * só o separador entre percentual e nome do módulo/`Total`):
 *
 *         80.94% | Total
 *
 * Linha ausente (formato mudou, ou coverage não rodou) reprova — nunca
 * aprova em silêncio.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * A linha final da tabela do `:cover`: `NN.NN% | Total`. Sem exigir `|` nos
 * dois lados — a versão do OTP que gera essa tabela não emoldura a linha,
 * só separa percentual de nome com um `|` no meio.
 */
const PADRAO_TOTAL = /(\d+(?:\.\d+)?)%\s*\|\s*Total\b/;

/**
 * Extrai a % de cobertura TOTAL da saída de `mix test --cover`.
 * `null` quando a linha não aparece — formato mudou, ou o comando não
 * chegou a rodar `--cover` de verdade.
 */
export function extrairCoberturaTotal(saida: string): number | null {
  const achado = PADRAO_TOTAL.exec(saida);
  return achado ? Number(achado[1]) : null;
}

export interface Veredito {
  ok: boolean;
  atual: number;
  piso: number;
}

/**
 * Compara a cobertura ATUAL contra o piso gravado. `>=` (não `>`): bater
 * exatamente no piso não é regressão.
 */
export function verificarPiso(atual: number, piso: number): Veredito {
  return { ok: atual >= piso, atual, piso };
}

export interface PisoGravado {
  engine: number;
}

/** Lê o piso gravado em `coverage-floor.json`, ao lado deste arquivo. */
export function lerPisoGravado(json: string): PisoGravado {
  return JSON.parse(json) as PisoGravado;
}

// --- CLI: `mix test --cover 2>&1 | node scripts/ci/coverage-floor.ts` ------

async function lerStdin(): Promise<string> {
  const pedacos: Buffer[] = [];
  for await (const pedaco of process.stdin) {
    pedacos.push(pedaco as Buffer);
  }
  return Buffer.concat(pedacos).toString('utf8');
}

async function principal(): Promise<void> {
  const saida = await lerStdin();
  const atual = extrairCoberturaTotal(saida);

  if (atual === null) {
    console.error(
      '::error::coverage-floor: não encontrei a linha "Total" na saída de ' +
        '`mix test --cover` — o formato do `:cover` mudou, ou o comando não ' +
        'rodou com `--cover`.',
    );
    process.exit(1);
  }

  const caminhoPiso = fileURLToPath(new URL('./coverage-floor.json', import.meta.url));
  const { engine: piso } = lerPisoGravado(readFileSync(caminhoPiso, 'utf8'));
  const veredito = verificarPiso(atual, piso);

  console.log(`coverage-floor (engine): ${atual.toFixed(2)}% — piso gravado: ${piso}%`);

  if (!veredito.ok) {
    console.error(
      `::error::coverage-floor: cobertura do engine caiu para ${atual.toFixed(2)}%, ` +
        `abaixo do piso de ${piso}% em scripts/ci/coverage-floor.json. Isto é ` +
        'sinal de regressão, não bloqueio artificial — investigue o que perdeu ' +
        'cobertura antes de mexer no piso.',
    );
    process.exit(1);
  }

  console.log('  ✓ dentro do piso.');
}

if (process.argv[1]?.endsWith('coverage-floor.ts')) {
  await principal();
}

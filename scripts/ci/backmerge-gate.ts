/**
 * backmerge-gate — check required em TODO PR: o destino está travado?
 * Fonte da política: docs/explanation/branching-policy.md
 *
 * Adaptador. A lógica é pura e vive em `gate.ts`; aqui só se lê o
 * `.release/gate.json` da `main` e se renderiza o veredito.
 *
 * O gate é lido SEMPRE da `main`, nunca da branch do PR: é lá que ele é
 * escrito, e ler a cópia que veio junto num backmerge daria um estado velho —
 * justamente durante a cadeia em que o estado muda a cada merge.
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

import {
  avaliarGate,
  CAMINHO_DO_GATE,
  formatarGate,
  higienizar,
  lerGate,
  type Contencao,
} from './gate.ts';

async function principal(): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  const { appendFileSync } = await import('node:fs');

  const head = process.env.PR_HEAD_REF ?? '';
  const base = process.env.PR_BASE_REF ?? '';
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  const mesmoRepositorio = process.env.PR_MESMO_REPO !== 'false';

  let bruto: string | null = null;
  try {
    bruto = execFileSync('git', ['show', `origin/main:${CAMINHO_DO_GATE}`], {
      encoding: 'utf8',
    });
  } catch {
    // Arquivo inexistente é o estado NORMAL: nunca houve hotfix. Diferente de
    // arquivo ilegível, que `lerGate` recusa — ali o estado é desconhecido, e
    // desconhecido não é permissão.
    bruto = null;
  }

  const declarado = lerGate(bruto);

  // O arquivo diz o que se QUIS travar; o git diz o que ainda falta descer.
  const contido: Contencao = (branch, sha) => {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', sha, `origin/${branch}`], {
        stdio: 'ignore',
      });
      return true;
    } catch (erro) {
      // 1 = não é ancestral, resposta legítima. Qualquer outro código é falha
      // de execução, e falha não é "não": vira `null`, que MANTÉM a trava.
      const status = (erro as { status?: number }).status;
      return status === 1 ? false : null;
    }
  };

  const { gate, removidas, naoVerificadas } = higienizar(declarado, contido);

  for (const b of removidas) {
    console.log(
      `::notice::trava de \`${b}\` caiu: o commit do hotfix já está lá. ` +
        'Registro desatualizado, correção presente.',
    );
  }
  for (const b of naoVerificadas) {
    console.log(
      `::warning::não consegui verificar se o hotfix já está em \`${b}\` — ` +
        'a trava foi mantida, porque desconhecido não é permissão.',
    );
  }

  const entrada = { head, base, mesmoRepositorio };
  const veredito = avaliarGate(gate, entrada, repo);
  const saida = formatarGate(entrada, veredito);

  console.log(saida);

  if (!veredito.ok) {
    console.log(
      `::error title=backmerge-gate: ${veredito.motivo}::${veredito.detalhe.split('\n')[0]}`,
    );
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### backmerge-gate\n\n\`\`\`\n${saida}\n\`\`\`\n`,
    );
  }

  process.exit(veredito.ok ? 0 : 1);
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}

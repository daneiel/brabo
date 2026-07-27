/**
 * hotfix-gate — no merge de um hotfix em `main`: trava os degraus de baixo e
 * abre os PRs de retropropagação.
 * Fonte da política: docs/explanation/branching-policy.md
 *
 * Escreve `.release/gate.json` DIRETO na `main`. É a única exceção de escrita
 * direta em branch permanente além das tags, ela é do bot, e está registrada na
 * convenção de porta única da política.
 *
 * A cadeia inteira de um hotfix são TRÊS PRs: o hotfix + dois backmerges. O
 * modelo com um degrau a mais pedia quatro.
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

import {
  CAMINHO_DO_GATE,
  escreverGate,
  lerGate,
  ORDEM_DE_DESTRAVA,
  travar,
  type EntradaDeHistorico,
} from './gate.ts';
import type { Permanente } from './pr-police.ts';

/** O corpo do PR de retropropagação: explica a trava e a ordem. */
export function corpoDaRetropropagacao(
  destino: Permanente,
  tag: string,
  posicao: number,
  total: number,
): string {
  const l: string[] = [];
  l.push(`Retropropagação automática de **\`main\` → \`${destino}\`**, aberta pelo gate.`);
  l.push('');
  l.push(`## Por que este PR existe`);
  l.push('');
  l.push(
    `O hotfix **\`${tag}\`** entrou direto em \`main\`, porque incidente não ` +
      'espera a escada. Isso deixou os degraus de baixo **sem a correção** — e ' +
      'sem este merge, o próximo release a **desfaria em silêncio**.',
  );
  l.push('');
  l.push('## A trava');
  l.push('');
  l.push(
    `Enquanto a cadeia não fechar, \`${ORDEM_DE_DESTRAVA.join('` e `')}\` não ` +
      'aceitam merge nenhum. Todo PR consulta o gate e fica vermelho apontando ' +
      'para cá.',
  );
  l.push('');
  l.push(`**Ordem de destrava — este é o ${posicao}º de ${total}:**`);
  l.push('');
  for (const [i, b] of ORDEM_DE_DESTRAVA.entries()) {
    const marca = b === destino ? ' ← **este PR**' : '';
    l.push(`${i + 1}. \`main\` → \`${b}\`${marca}`);
  }
  l.push('');
  l.push(
    'A ordem não é burocracia: mergear no degrau de baixo antes do de cima ' +
      'deixa o do meio sem a correção, que é exatamente o buraco que o gate fecha.',
  );
  l.push('');
  l.push('## Aprovação');
  l.push('');
  l.push('Segue o `approval-ladder` como qualquer PR — nada de exceção aqui.');
  l.push('');
  l.push('<sub>A política inteira: `docs/explanation/branching-policy.md`</sub>');
  return l.join('\n');
}

// ------------------------------------------------------------- adaptador CLI

async function principal(): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  const { appendFileSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { dirname } = await import('node:path');

  const tag = process.env.HOTFIX_TAG ?? '';
  const sha = process.env.HOTFIX_SHA ?? '';
  // Onde escrever. O workflow manda para um arquivo fora da árvore e só depois
  // faz o commit em `main` — escrever direto aqui sujaria o checkout do merge.
  const destino = process.env.GATE_OUT ?? CAMINHO_DO_GATE;

  if (!tag || !sha) {
    console.error('[hotfix-gate] HOTFIX_TAG e HOTFIX_SHA são obrigatórios.');
    process.exit(2);
  }

  const gh = (...args: string[]): string =>
    execFileSync('gh', args, { encoding: 'utf8' }).trim();

  // --- 1. abrir (ou reaproveitar) os PRs de retropropagação.
  //
  // Reaproveitar é o que faz o ACÚMULO funcionar: um segundo hotfix durante
  // gate ativo não abre PR novo. Os já abertos carregam `main`, e `main` já tem
  // os dois hotfixes.
  const prs: Partial<Record<Permanente, number>> = {};

  for (const [i, destino] of ORDEM_DE_DESTRAVA.entries()) {
    let numero = '';
    try {
      numero = gh(
        'pr', 'list', '--base', destino, '--head', 'main',
        '--state', 'open', '--json', 'number', '--jq', '.[0].number // empty',
      );
    } catch {
      numero = '';
    }

    const corpo = corpoDaRetropropagacao(destino, tag, i + 1, ORDEM_DE_DESTRAVA.length);
    const arquivo = `corpo-backmerge-${destino}.md`;
    writeFileSync(arquivo, corpo);

    if (numero) {
      gh('pr', 'edit', numero, '--body-file', arquivo);
      prs[destino] = Number(numero);
      console.log(`::notice::PR de retropropagação para ${destino} já existia: #${numero}`);
    } else {
      gh(
        'pr', 'create', '--base', destino, '--head', 'main',
        '--title', `retropropagação: main → ${destino} (${tag})`,
        '--body-file', arquivo,
      );
      const novo = gh(
        'pr', 'list', '--base', destino, '--head', 'main',
        '--state', 'open', '--json', 'number', '--jq', '.[0].number // empty',
      );
      prs[destino] = Number(novo);
      console.log(`::notice::PR de retropropagação para ${destino}: #${novo}`);
    }
  }

  // --- 2. travar.
  let bruto: string | null = null;
  try {
    bruto = execFileSync('git', ['show', `origin/main:${CAMINHO_DO_GATE}`], {
      encoding: 'utf8',
    });
  } catch {
    bruto = null;
  }

  const entrada: EntradaDeHistorico = {
    tag,
    sha,
    em: new Date().toISOString(),
    prs,
  };

  const gate = travar(lerGate(bruto), entrada);

  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, escreverGate(gate));

  console.log(`[hotfix-gate] travadas: ${gate.locked.join(', ')} — aguardando ${gate.awaiting}`);
  console.log(`[hotfix-gate] hotfixes acumulados nesta rodada: ${gate.historico.length}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### hotfix-gate\n\n` +
        `Hotfix **${tag}** entrou em \`main\`.\n\n` +
        `- Travadas: ${gate.locked.map((b) => `\`${b}\``).join(', ')}\n` +
        `- Retropropagações: ${ORDEM_DE_DESTRAVA.map((b) => `\`${b}\` → #${prs[b]}`).join(', ')}\n` +
        `- Acumulados nesta rodada: ${gate.historico.length}\n`,
    );
  }
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}

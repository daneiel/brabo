/**
 * gate — o backmerge gate: trava os degraus de baixo até a correção descer.
 * Fonte da política: docs/explanation/branching-policy.md
 *
 * POR QUE ELE EXISTE. `hotfix/` entra direto em `main` porque incidente não
 * espera a escada. Isso deixa `qa` e `dev` sem a correção — e o próximo release
 * a DESFAZ, em silêncio, meses depois. O gate impede que qualquer coisa suba
 * enquanto a correção não descer.
 *
 * O estado vive em `.release/gate.json`, na `main`. É a única exceção de
 * escrita direta em branch permanente além das tags, e é do bot.
 *
 * Sintaxe apagável apenas (o Node executa este `.ts` por type stripping).
 */

import { ESCADA, type Permanente } from './pr-police.ts';

/** A ordem de destrava: do degrau mais alto para o mais baixo. */
export const ORDEM_DE_DESTRAVA: readonly Permanente[] = ['qa', 'dev'];

export const CAMINHO_DO_GATE = '.release/gate.json';

export interface EntradaDeHistorico {
  /** A tag PATCH que o hotfix gerou. */
  tag: string;
  sha: string;
  em: string;
  /** Os PRs de retropropagação abertos, por branch de destino. */
  prs: Partial<Record<Permanente, number>>;
}

export interface Gate {
  versao: number;
  /** Branches que não aceitam merge até a correção descer. */
  locked: Permanente[];
  /** O que se está esperando — a tag do hotfix mais recente. `null` = limpo. */
  awaiting: string | null;
  /** A ordem em que as travas saem. */
  order: Permanente[];
  /** Todos os hotfixes desta rodada de trava. Acumula. */
  historico: EntradaDeHistorico[];
}

export const GATE_LIMPO: Gate = {
  versao: 1,
  locked: [],
  awaiting: null,
  order: [...ORDEM_DE_DESTRAVA],
  historico: [],
};

// ---------------------------------------------------------------- transições

/**
 * Um hotfix entrou em `main`: trava `qa` e `dev`.
 *
 * ACÚMULO SAI DE GRAÇA. Um segundo hotfix durante gate ativo não abre PR novo
 * nem cria fila paralela: os PRs `main→qa` e `main→dev` já estão abertos e
 * carregam o que `main` TIVER — inclusive o hotfix novo. Aqui só se acrescenta
 * a entrada no histórico e se reafirma a trava. Branch que já foi destravada
 * volta a travar, porque agora há conteúdo novo para descer.
 */
export function travar(gate: Gate, entrada: EntradaDeHistorico): Gate {
  return {
    ...gate,
    versao: 1,
    locked: [...ORDEM_DE_DESTRAVA],
    awaiting: entrada.tag,
    order: [...ORDEM_DE_DESTRAVA],
    historico: [...gate.historico, entrada],
  };
}

/**
 * Uma retropropagação foi mergeada: tira a branch da trava.
 *
 * A ÚLTIMA limpa o `awaiting` e zera o histórico — a rodada terminou, e manter
 * o histórico de uma trava resolvida faria a próxima parecer acumulada.
 */
export function destravar(gate: Gate, branch: Permanente): Gate {
  const locked = gate.locked.filter((b) => b !== branch);
  const acabou = locked.length === 0;

  return {
    ...gate,
    locked,
    awaiting: acabou ? null : gate.awaiting,
    historico: acabou ? [] : gate.historico,
  };
}

/**
 * Responde se o commit do hotfix JÁ ESTÁ contido naquela branch.
 * `null` = não deu para verificar — e isso não é um "não".
 */
export type Contencao = (branch: Permanente, sha: string) => boolean | null;

export interface Higiene {
  gate: Gate;
  /** Travas que caíram por já estarem satisfeitas. */
  removidas: Permanente[];
  /** Travas mantidas por não ter sido possível verificar. */
  naoVerificadas: Permanente[];
}

/**
 * Deixa cair as travas que a REALIDADE já satisfez.
 *
 * O `.release/gate.json` mora na `main`, mas os PRs de retropropagação
 * carregam o arquivo junto para `qa` e `dev`. Meses depois, uma promoção
 * `qa → main` sobe aquela cópia de volta — e num merge onde os dois lados
 * mudaram, uma trava velha pode reaparecer na `main` sem nenhum hotfix por
 * trás. Sem esta higiene, o gate ficaria travado para sempre: não há
 * retropropagação pendente que o destrave.
 *
 * A regra: `locked` é o REGISTRO da intenção; a verdade é a contenção. Se o
 * commit do hotfix já está na branch, a correção desceu — a trava cumpriu o
 * papel e cai, tenha o arquivo sido atualizado ou não.
 *
 * Não conseguir verificar MANTÉM a trava. Desconhecido nunca é permissão.
 */
export function higienizar(gate: Gate, contido: Contencao): Higiene {
  const ultima = gate.historico[gate.historico.length - 1];
  if (gate.locked.length === 0 || ultima === undefined) {
    return { gate, removidas: [], naoVerificadas: [] };
  }

  const removidas: Permanente[] = [];
  const naoVerificadas: Permanente[] = [];

  for (const branch of gate.locked) {
    const resposta = contido(branch, ultima.sha);
    if (resposta === true) removidas.push(branch);
    else if (resposta === null) naoVerificadas.push(branch);
  }

  if (removidas.length === 0) return { gate, removidas, naoVerificadas };

  const limpo = removidas.reduce((g, b) => destravar(g, b), gate);
  return { gate: limpo, removidas, naoVerificadas };
}

/** A próxima branch a destravar, respeitando a ordem. `null` = gate limpo. */
export function proximaNaOrdem(gate: Gate): Permanente | null {
  for (const b of gate.order) {
    if (gate.locked.includes(b)) return b;
  }
  return null;
}

// ------------------------------------------------------------------ avaliar

export interface EntradaDoGate {
  head: string;
  base: string;
  /** `false` quando o head vem de fork — aí `main` não é retropropagação. */
  mesmoRepositorio?: boolean;
}

export type MotivoDoGate =
  | 'GATE-LIMPO'
  | 'RETROPROPAGACAO-DA-VEZ'
  | 'DESTINO-NAO-TRAVADO'
  | 'FORA-DE-ORDEM'
  | 'DESTINO-TRAVADO';

export interface VereditoDoGate {
  ok: boolean;
  motivo: MotivoDoGate;
  detalhe: string;
}

function ehPermanente(nome: string): nome is Permanente {
  return (ESCADA as readonly string[]).includes(nome);
}

function linkDoPr(gate: Gate, branch: Permanente, repo?: string): string {
  // O PR que resolve a trava daquela branch é o do hotfix mais recente — os
  // anteriores já estão contemplados nele, porque todos carregam `main`.
  const ultima = gate.historico[gate.historico.length - 1];
  const numero = ultima?.prs?.[branch];
  if (numero === undefined) return '(o PR de retropropagação ainda não foi aberto)';
  return repo ? `https://github.com/${repo}/pull/${numero}` : `#${numero}`;
}

export function avaliarGate(
  gate: Gate,
  entrada: EntradaDoGate,
  repo?: string,
): VereditoDoGate {
  const head = entrada.head.trim();
  const base = entrada.base.trim();

  if (gate.locked.length === 0) {
    return {
      ok: true,
      motivo: 'GATE-LIMPO',
      detalhe: 'nenhuma branch travada — nada aguardando retropropagação.',
    };
  }

  const doMesmoRepo = entrada.mesmoRepositorio !== false;
  const proxima = proximaNaOrdem(gate);

  // Retropropagação: head é `main`, no mesmo repositório.
  const ehRetropropagacao = doMesmoRepo && head === 'main' && ehPermanente(base);

  if (ehRetropropagacao) {
    if (base === proxima) {
      return {
        ok: true,
        motivo: 'RETROPROPAGACAO-DA-VEZ',
        detalhe:
          `\`main\` → \`${base}\` é a retropropagação da vez.\n` +
          `      Ao mergear, \`${base}\` sai da trava` +
          (gate.locked.length === 1
            ? ' e a fila fica limpa.'
            : `; depois vem \`${gate.locked.filter((b) => b !== base).join('`, `')}\`.`),
      };
    }

    if (gate.locked.includes(base)) {
      return {
        ok: false,
        motivo: 'FORA-DE-ORDEM',
        detalhe:
          `destrave \`${proxima}\` antes de \`${base}\`.\n` +
          `      A ordem é \`${gate.order.join('` → `')}\`, e ela não é burocracia:\n` +
          `      mergear \`main\` em \`${base}\` antes de \`${proxima}\` deixa o degrau do\n` +
          `      meio sem a correção — que é exatamente o buraco que o gate fecha.\n` +
          `      Mergeie ${linkDoPr(gate, proxima!, repo)} primeiro.`,
      };
    }

    return {
      ok: true,
      motivo: 'DESTINO-NAO-TRAVADO',
      detalhe: `\`${base}\` não está travada.`,
    };
  }

  // Qualquer outro PR: só passa se o destino estiver livre.
  if (ehPermanente(base) && gate.locked.includes(base)) {
    const pendentes = gate.locked.map((b) => `\`${b}\``).join(', ');
    return {
      ok: false,
      motivo: 'DESTINO-TRAVADO',
      detalhe:
        `\`${base}\` está travada aguardando a retropropagação de ` +
        `${gate.awaiting ?? 'um hotfix'}.\n` +
        `      Um hotfix entrou em \`main\` e ainda não desceu. Deixar trabalho\n` +
        `      novo entrar agora faria o próximo release DESFAZER a correção,\n` +
        `      em silêncio.\n` +
        `      Travadas: ${pendentes}. Resolva ${linkDoPr(gate, base, repo)} e as\n` +
        `      demais da cadeia; este PR libera sozinho depois.`,
    };
  }

  return {
    ok: true,
    motivo: 'DESTINO-NAO-TRAVADO',
    detalhe: `\`${base}\` não está travada.`,
  };
}

// -------------------------------------------------------------- renderização

export function formatarGate(entrada: EntradaDoGate, veredito: VereditoDoGate): string {
  const l: string[] = [];
  l.push(`backmerge-gate: ${entrada.head} → ${entrada.base}`);
  l.push('');
  l.push(`  ${veredito.ok ? '✓' : '✗'} ${veredito.motivo}`);
  l.push(`      ${veredito.detalhe}`);
  l.push('');
  l.push('  O gate inteiro: docs/explanation/branching-policy.md');
  return l.join('\n');
}

export function lerGate(bruto: string | null | undefined): Gate {
  if (!bruto || bruto.trim() === '') return { ...GATE_LIMPO };
  try {
    const lido = JSON.parse(bruto) as Partial<Gate>;
    return {
      versao: lido.versao ?? 1,
      locked: lido.locked ?? [],
      awaiting: lido.awaiting ?? null,
      order: lido.order ?? [...ORDEM_DE_DESTRAVA],
      historico: lido.historico ?? [],
    };
  } catch {
    // Gate ilegível NÃO vira gate limpo: isso transformaria um arquivo
    // corrompido em permissão para tudo. Levanta, e o workflow reprova.
    throw new Error(
      `${CAMINHO_DO_GATE} existe mas não é JSON válido. ` +
        'Um gate ilegível não pode ser tratado como gate limpo — isso liberaria ' +
        'todos os merges justamente quando o estado é desconhecido.',
    );
  }
}

export function escreverGate(gate: Gate): string {
  return `${JSON.stringify(gate, null, 2)}\n`;
}

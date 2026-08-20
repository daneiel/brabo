/**
 * Guarda LÉXICA do `cwd` que o servidor manda num `"exec"` (contrato do
 * runner) — confere que ele está DENTRO da raiz do projeto (`--dir` da CLI),
 * no espírito de `apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`
 * (`caminhoDeRepositorioContido`/`dentroDoEscopo`), reimplementado aqui em TS
 * puro porque este pacote não pode depender do código da api (workspace
 * separado, sem import cross-app).
 *
 * ## Isto é BEST-EFFORT, não é a fronteira de segurança
 *
 * O runner roda NA máquina do usuário, com os privilégios DELE. Não há
 * sandbox, não há container, não há usuário non-root separado — o processo
 * Node desta CLI já pode fazer tudo que o usuário pode fazer no próprio
 * shell, `cwd` correto ou não. A fronteira REAL que protege o produto é:
 *
 *   1. autenticação — só quem tem o token de conta do usuário chega a pedir
 *      um ticket de socket (`auth.ts`);
 *   2. aprovação — o comando que chega por `"exec"` já passou pelo pipeline
 *      de `proposed_action` do lado servidor; este processo não decide
 *      política nenhuma, só executa o que já foi aprovado;
 *   3. consentimento — é o USUÁRIO quem decide rodar este CLI na própria
 *      máquina, sabendo o que ele faz.
 *
 * Esta guarda existe para pegar o caso ÓBVIO — um `cwd` mal formado ou fora
 * da pasta do projeto por erro de programação do lado servidor, ou por um
 * bug de outra frente — e recusar com mensagem clara em vez de `spawn` numa
 * pasta arbitrária sem avisar ninguém. Ela NÃO tenta resistir a um servidor
 * malicioso: quem confia no servidor (passo 1) já perdeu essa disputa antes
 * de chegar aqui. Symlink resolvido por `realpath` reduz, mas não fecha,
 * o vetor de escape por link simbólico — a mesma ressalva que o ADR 0055 já
 * registra para o container.
 */

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export class CwdForaDaRaizError extends Error {
  // Propriedade explícita, não parameter property: `erasableSyntaxOnly`
  // (mesmo tsconfig de scripts/ci) recusa a forma curta, porque o Node não
  // sabe apagá-la ao rodar o `.ts` direto por type stripping.
  readonly cwdRecebido: string;
  readonly raiz: string;

  constructor(cwdRecebido: string, raiz: string) {
    super(
      `cwd fora da raiz do projeto: ${JSON.stringify(cwdRecebido)} não está ` +
        `dentro de ${JSON.stringify(raiz)}. Recusado antes de executar — isto ` +
        `não deveria acontecer com um servidor que respeita o contrato.`,
    );
    this.name = 'CwdForaDaRaizError';
    this.cwdRecebido = cwdRecebido;
    this.raiz = raiz;
  }
}

/**
 * `/a/b//` → `/a/b`, sem barra final — mesma forma sem regex de
 * `project-workspaces-root.ts` (evita a classe de ReDoS que o CodeQL já
 * apontou no produto para `\/+$`).
 */
function semBarraFinal(caminho: string): string {
  const partes = caminho.split('/').filter((p) => p.length > 0);
  return `/${partes.join('/')}`;
}

/** Está `alvo` dentro de `raiz` (ou é a própria raiz)? Comparação por segmento. */
function dentroDoEscopo(alvo: string, raiz: string): boolean {
  if (alvo === raiz) return true;
  return alvo.startsWith(raiz.endsWith('/') ? raiz : raiz + '/');
}

/**
 * Resolve o `realpath` de `caminho`, ou do primeiro ancestral existente
 * quando o próprio caminho ainda não existe no disco (comando que cria a
 * própria pasta de trabalho antes de usá-la, por exemplo). Symlink em
 * qualquer ancestral já resolvido é o que este passo pega.
 */
function realpathMaisProximo(caminho: string): string {
  let atual = caminho;
  // Teto de segurança: número de segmentos do caminho é o máximo de subidas
  // possíveis até a raiz do FS — nunca laço sem fim.
  const tetoDeTentativas = atual.split('/').length + 1;
  for (let tentativa = 0; tentativa < tetoDeTentativas; tentativa++) {
    try {
      return realpathSync(atual);
    } catch {
      const pai = resolve(atual, '..');
      if (pai === atual) return caminho; // chegou na raiz do FS sem achar nada
      atual = pai;
    }
  }
  return caminho;
}

/**
 * Valida e devolve o `cwd` normalizado — ou lança `CwdForaDaRaizError`.
 *
 * `raiz` é a `--dir` absoluta que a CLI recebeu na linha de comando; já
 * assumida absoluta e normalizada por quem chama (`index.ts`).
 */
export function validarCwdDentroDaRaiz(cwdRecebido: string, raiz: string): string {
  if (typeof cwdRecebido !== 'string' || cwdRecebido.length === 0) {
    throw new CwdForaDaRaizError(String(cwdRecebido), raiz);
  }
  if (cwdRecebido.includes('\0')) {
    throw new CwdForaDaRaizError(cwdRecebido, raiz);
  }
  if (!cwdRecebido.startsWith('/')) {
    // Relativo dependeria do cwd do PROCESSO do runner, que não é a raiz do
    // projeto — o servidor sempre manda caminho absoluto por contrato.
    throw new CwdForaDaRaizError(cwdRecebido, raiz);
  }

  const segmentos = cwdRecebido.split('/');
  if (segmentos.some((s) => s === '..')) {
    throw new CwdForaDaRaizError(cwdRecebido, raiz);
  }

  const raizNormalizada = semBarraFinal(resolve(raiz));
  const alvoNormalizado = semBarraFinal(resolve(cwdRecebido));

  if (!dentroDoEscopo(alvoNormalizado, raizNormalizada)) {
    throw new CwdForaDaRaizError(cwdRecebido, raiz);
  }

  // Segunda checagem, por REALPATH — pega o caso de um segmento do meio ser
  // um symlink que aponta para fora, mesmo com a forma lexical já dentro da
  // raiz. Best-effort (ver docblock do módulo): não cobre link criado DEPOIS
  // desta checagem (TOCTOU), nem link cujo alvo ainda não existe.
  const raizReal = semBarraFinal(realpathMaisProximo(raizNormalizada));
  const alvoReal = semBarraFinal(realpathMaisProximo(alvoNormalizado));
  if (!dentroDoEscopo(alvoReal, raizReal)) {
    throw new CwdForaDaRaizError(cwdRecebido, raiz);
  }

  return alvoNormalizado;
}

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
 *
 * ## `validarDirDentroDoHomeNoLinux` — checagem de STARTUP, não de `exec`
 *
 * Segunda checagem deste módulo, sem relação com o `cwd` de um comando: valida
 * o `--dir` que a própria CLI recebeu na linha de comando, uma vez, no início
 * do processo (RN-434, ADR 0104). Reusa `dentroDoEscopo`/`semBarraFinal` pelo
 * mesmo motivo de sempre — não duplicar comparação de caminho —, mas é mais
 * simples que `validarCwdDentroDaRaiz`: sem `realpath`/símlink/TOCTOU, porque
 * não protege contra um SERVIDOR malicioso, só orienta o USUÁRIO local que
 * digitou um caminho errado na hora de subir o próprio CLI.
 *
 * ## `garantirDiretorio` — terceira checagem de STARTUP, DEPOIS da anterior
 *
 * RN-435 (ADR 0104, extensão aditiva): `--dir` que ainda não existe deixou
 * de ser erro fatal — o CLI cria a pasta (`mkdir -p`) em vez de recusar.
 * A ORDEM importa: `lerArgumentos()` chama `validarDirDentroDoHomeNoLinux`
 * ANTES desta função, porque aquela checagem funciona em caminho que ainda
 * não existe (só `resolve()`, sem tocar disco) — criar a pasta antes de
 * validar o `$HOME` abriria a brecha que a RN-434 tinha acabado de fechar
 * (criar fora do home no Linux). `--dir` apontando para um ARQUIVO
 * existente continua erro real — nunca sobrescrito silenciosamente.
 *
 * ## `resolverDir` — resolve `--dir` relativo contra o cwd de VERDADE
 *
 * Achado real, não hipotético: `pnpm --filter runner start -- --dir
 * ../exp001`, rodado de `~/dev/brabo`, criava `~/dev/brabo/apps/exp001` em
 * vez de `~/dev/exp001`. A causa é `pnpm --filter <pkg> run <script>`
 * rebasear `process.cwd()` para a pasta do PACOTE (`apps/runner`) — um
 * `resolve(dirBruto)` simples resolvia contra o lugar errado. `INIT_CWD` é a
 * variável que npm/pnpm sempre define com a pasta de onde o usuário de fato
 * digitou o comando; presente só quando o processo nasce de um script do
 * package.json, ausente (binário standalone, `node dist/index.cjs` direto)
 * cai em `process.cwd()`, que aí já é a pasta correta.
 */

import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
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

/**
 * Traduz um `cwd` de HOST (já validado por `validarCwdDentroDaRaiz`, portanto
 * SEMPRE dentro de `raiz`) para dentro de `PONTO_DE_MONTAGEM` (`/work`,
 * `@brabo/docker-port`) — o caminho que `docker exec` recebe quando este
 * runner tem um container ativo (ADR 0137). Mesmo raciocínio de
 * `cwd_para_container/2` do lado engine (`terminal_executor.ex`): troca de
 * PREFIXO, nunca reconstrução — `raiz` vira `pontoDeMontagem`, o resto do
 * caminho segue igual.
 *
 * `raiz` e `cwd` chegam JÁ normalizados (sem barra final, exceto se `raiz`
 * for `/`) por quem chama — `estado.dir` (resolvido por `resolverDir`) e o
 * retorno de `validarCwdDentroDaRaiz` respectivamente. Sem normalização
 * própria aqui: duplicar `semBarraFinal`/`dentroDoEscopo` criaria uma
 * segunda fonte da mesma comparação de caminho.
 */
export function cwdParaContainer(
  raiz: string,
  cwd: string,
  pontoDeMontagem: string,
): string {
  if (cwd === raiz) return pontoDeMontagem;
  if (cwd.startsWith(raiz.endsWith('/') ? raiz : `${raiz}/`)) {
    return pontoDeMontagem + cwd.slice(raiz.length);
  }
  // Não deveria acontecer — `cwd` já passou por `validarCwdDentroDaRaiz`
  // contra a MESMA `raiz` antes de chegar aqui. Defesa em profundidade, sem
  // adivinhar: devolve como veio, e o container recusa se não fizer sentido
  // (mesma postura de `cwd_para_container/2` do lado engine).
  return cwd;
}

/**
 * Resolve `--dir` para caminho absoluto, contra `initCwd` quando presente
 * (a pasta ORIGINAL de invocação, via `INIT_CWD`) e contra `cwdDoProcesso`
 * quando não — ver o docblock do módulo. Se `dirBruto` já é absoluto,
 * `resolve` o devolve normalizado e ignora a base, como sempre.
 */
export function resolverDir(
  dirBruto: string,
  initCwd: string | undefined,
  cwdDoProcesso: string,
): string {
  return resolve(initCwd ?? cwdDoProcesso, dirBruto);
}

export class DirForaDoHomeError extends Error {
  readonly dirRecebido: string;
  readonly home: string;

  constructor(dirRecebido: string, home: string) {
    super(
      `--dir precisa estar dentro do seu diretório de usuário (${home}) quando o runner roda ` +
        `no Linux. Recebido: ${JSON.stringify(dirRecebido)}. Aponte para uma pasta dentro de ` +
        `${home} (ex.: ${home}/meu-projeto) — fora do Linux esta restrição não se aplica.`,
    );
    this.name = 'DirForaDoHomeError';
    this.dirRecebido = dirRecebido;
    this.home = home;
  }
}

/**
 * Valida que `dir` (já resolvido/absoluto) está dentro de `home` — só quando
 * `platform === 'linux'` (decisão do dono do produto, RN-434/ADR 0104: no
 * Linux, o workspace do modo `runner` só pode viver dentro do `$HOME` do
 * usuário). Fora do Linux, não faz nada — a restrição não vale lá. Lança
 * `DirForaDoHomeError` quando recusa; não devolve nada em caso de sucesso.
 */
export function validarDirDentroDoHomeNoLinux(
  dir: string,
  platform: NodeJS.Platform,
  home: string,
): void {
  if (platform !== 'linux') return;

  const homeNormalizado = semBarraFinal(resolve(home));
  const dirNormalizado = semBarraFinal(resolve(dir));

  if (!dentroDoEscopo(dirNormalizado, homeNormalizado)) {
    throw new DirForaDoHomeError(dir, homeNormalizado);
  }
}

export class DirNaoEUmaPastaError extends Error {
  readonly dirRecebido: string;

  constructor(dirRecebido: string) {
    super(
      `--dir precisa ser uma pasta. Recebido um caminho que já existe e não é ` +
        `pasta: ${JSON.stringify(dirRecebido)}. Este CLI nunca sobrescreve um ` +
        `arquivo existente.`,
    );
    this.name = 'DirNaoEUmaPastaError';
    this.dirRecebido = dirRecebido;
  }
}

export class NaoConsegiuCriarDiretorioError extends Error {
  readonly dirRecebido: string;

  constructor(dirRecebido: string, causa: unknown) {
    const mensagemDaCausa = causa instanceof Error ? causa.message : String(causa);
    super(`Não consegui criar a pasta ${dirRecebido}: ${mensagemDaCausa}`);
    this.name = 'NaoConsegiuCriarDiretorioError';
    this.dirRecebido = dirRecebido;
  }
}

/**
 * Garante que `dir` (já resolvido/absoluto, e já aprovado por
 * `validarDirDentroDoHomeNoLinux` quando aplicável) existe como pasta —
 * criando com `mkdir -p` quando ainda não existe (RN-435, ADR 0104).
 *
 * - já existe e é pasta → não faz nada.
 * - já existe e NÃO é pasta (é um arquivo) → lança `DirNaoEUmaPastaError`,
 *   sem tentar criar nada.
 * - não existe → cria recursivamente; se a criação falhar (permissão, disco
 *   cheio, etc.) → lança `NaoConsegiuCriarDiretorioError`.
 */
export function garantirDiretorio(dir: string): void {
  if (existsSync(dir)) {
    if (!statSync(dir).isDirectory()) {
      throw new DirNaoEUmaPastaError(dir);
    }
    return;
  }

  try {
    mkdirSync(dir, { recursive: true });
  } catch (erro) {
    throw new NaoConsegiuCriarDiretorioError(dir, erro);
  }
  console.log(`pasta criada: ${dir}`);
}

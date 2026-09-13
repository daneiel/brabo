/**
 * `brabo-runner device-key create` / `device-key finish --id <id>` (RN-551) —
 * o par Ed25519 gerado NA MÁQUINA, para o terminal poder fazer o que só o
 * navegador fazia (ADR 0118, RN-464..466, RN-475).
 *
 * O [ADR 0155](../../../docs/adr/0155-a-primeira-conta-nasce-no-terminal.md)
 * ponto 4 é quem pede: *"o par é gerado na máquina; a privada nunca viaja. É o
 * mesmo desenho do navegador, pelo mesmo motivo"*. Até aqui, `device-key.ts` só
 * sabia LER uma chave que alguém tinha posto na pasta, e esse alguém era sempre
 * um navegador. Este módulo é o outro lado.
 *
 * ## O problema de ORDEM, e por que são DOIS passos
 *
 * O `kid` gravado dentro da JWK privada é o **id do registro no servidor**
 * (RN-475) — a cadeia inteira só o REPASSA (o runner lê `jwk.kid`, o JWT o leva
 * no header, o `PatAuthGuard` acha a pública por ele), e ninguém o deriva de
 * outra coisa. Então ele só EXISTE depois de a pública ser registrada, e a
 * privada não pode ser gravada antes disso sob pena de nascer inútil — que é,
 * literalmente, o defeito que a RN-475 custou uma caçada para achar.
 *
 * O navegador resolve isso mantendo o par em MEMÓRIA: gera, registra a pública,
 * recebe o `id` e só então exporta a privada já carimbada
 * (`registrarChaveEExportarPrivada`, `apps/web/src/lib/runner-bootstrap.ts`) —
 * uma função só, justamente para o `id` não ter como se perder.
 *
 * O CLI **não pode** copiar isso numa invocação só, e a razão não é técnica, é
 * de SEGREDO: quem registra a chave de máquina é o instalador, autenticado pelo
 * `BRABO_SERVICE_TOKEN` que ele acabou de gerar (ADR 0155 ponto 1). Fazer o
 * `brabo-runner` chamar a rota exigiria pôr esse token na mão dele — um segredo
 * de INSTALAÇÃO, que abre rotas internas, entregue a um processo que hoje só vê
 * credencial de dispositivo e que fica de pé para sempre na máquina do usuário.
 * O corte é o oposto: **cada lado guarda exatamente um segredo, e nenhum vê o
 * do outro**. O instalador tem o service token e nunca toca a privada; o CLI
 * tem a privada e nunca toca o service token. O que atravessa a fronteira é
 * pública (a JWK) e id (o `kid`) — nada que precise ser protegido.
 *
 * Então são dois passos, e o estado intermediário é desenhado para ser
 * inofensivo: `create` grava a privada num arquivo `PARCIAL`, cujo nome
 * **não é** o que `lerChaveDeDispositivo` procura, e `finish` a carimba com o
 * `kid` e grava o nome de verdade. Em nenhum instante existe um
 * `brabo-runner-device-key.jwk.json` sem `kid` — o arquivo que o runner LÊ ou
 * está completo ou não existe. Uma interrupção entre os dois passos deixa um
 * `.parcial` que o runner IGNORA e que `create` nomeia na próxima vez.
 *
 * ## Onde a chave é gravada, e por que não é uma pasta nova
 *
 * A chave por PROJETO mora na pasta do projeto, porque é lá que
 * `lerChaveDeDispositivo(cwd)` a lê (e a garantia daquele módulo — *"só lê, só
 * do `cwd` que o chamador passar"* — depende disso). A de MÁQUINA não tem pasta
 * de projeto, e o destino padrão dela é a pasta de configuração que
 * `base.ts` já usa: `$XDG_CONFIG_HOME/brabo/` (senão `~/.config/brabo/`), ao
 * lado do `runner.json`. A precedência é REUSADA
 * (`pastaDeConfiguracaoDoBrabo`), nunca reescrita.
 *
 * Isso não reabre a porta que a Onda 2 do ADR 0104 fechou (credencial em
 * caminho global e IMPLÍCITO): `device-key.ts` continua lendo só do `cwd` que o
 * chamador passar, e é o `--dir` da unit de máquina (RN-545) que aponta para
 * esta pasta — explicitamente, escrito no serviço. Ninguém passa a procurar
 * chave em `$HOME` por conta própria.
 *
 * ## O que este módulo NÃO faz
 *
 * Não fala com a api (ver acima), não escolhe o `name` do dispositivo (é o
 * corpo do registro, e quem registra é quem nomeia) e não afirma a ESPÉCIE da
 * chave: em disco, máquina e projeto são o mesmo arquivo, e quem sabe a
 * diferença é o servidor (RN-544). Por isso `--dir` existe — a mesma criação
 * serve para gerar a chave de um projeto, se for isso que se quiser registrar.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportJWK, generateKeyPair } from 'jose';
import { pastaDeConfiguracaoDoBrabo } from './base.ts';
import { NOME_ARQUIVO_CHAVE } from './device-key.ts';
import { DirForaDoHomeError, resolverDir, validarDirDentroDoHomeNoLinux } from './guard.ts';

/**
 * O sufixo do arquivo INCOMPLETO. Ele é o que garante que o nome que
 * `lerChaveDeDispositivo` procura nunca contenha uma chave sem `kid` — ver o
 * docblock do módulo.
 */
export const SUFIXO_PARCIAL = '.parcial';

/** Modo do arquivo da privada. Explícito, e nunca deixado ao `umask`. */
const MODO_DA_CHAVE = 0o600;

/** Modo da pasta, quando é este comando que a cria. */
const MODO_DA_PASTA = 0o700;

export interface ContextoDaChave {
  argv: string[];
  /** A pasta de onde o comando foi digitado — base de um `--dir` relativo. */
  cwd: string;
  home: string;
  xdgConfigHome: string | null;
  plataforma: NodeJS.Platform;
}

/**
 * A resposta de um subcomando, no molde de `RespostaDoServico` — com UMA
 * diferença que é o ponto do comando: o `stdout` é separado das `linhas`.
 *
 * Tudo que é para HUMANO sai no stderr, e o stdout carrega no máximo um valor,
 * numa linha só, sem decoração. É o que faz `PUB=$(brabo-runner device-key
 * create)` funcionar num `install.sh` — misturar as duas coisas obrigaria o
 * script a filtrar a saída, e filtrar saída de humano é como um contrato se
 * quebra sem ninguém perceber.
 */
export interface RespostaDaChave {
  fluxo: 'saida' | 'erro';
  codigo: number;
  /** A ÚNICA linha que vai para o stdout, ou `null`. */
  stdout: string | null;
  /** Tudo para humano — sempre stderr. */
  linhas: string[];
}

const SUBCOMANDOS = ['create', 'finish'] as const;
type Subcomando = (typeof SUBCOMANDOS)[number];

export function ehSubcomandoDeChaveConhecido(sub: string | undefined): sub is Subcomando {
  return typeof sub === 'string' && (SUBCOMANDOS as readonly string[]).includes(sub);
}

export function usoDeChaveDeDispositivo(): RespostaDaChave {
  return {
    fluxo: 'erro',
    codigo: 2,
    stdout: null,
    linhas: [
      'uso: brabo-runner device-key create [--dir <pasta>]',
      '     brabo-runner device-key finish --id <id-do-registro> [--dir <pasta>]',
      '',
      'create  — gera um par Ed25519 NESTA máquina, imprime a JWK PÚBLICA no stdout (uma',
      '          linha, para o script registrar na api) e grava a PRIVADA num arquivo',
      `          ${NOME_ARQUIVO_CHAVE}${SUFIXO_PARCIAL}, em modo 600. A privada NUNCA viaja.`,
      'finish  — carimba o `id` que a api devolveu no registro dentro da JWK privada (o',
      `          campo "kid") e grava ${NOME_ARQUIVO_CHAVE}, que é o nome que o runner lê.`,
      '',
      'São dois passos porque o "kid" É o id do registro no servidor: ele só existe depois',
      'de a pública ser registrada, e uma privada gravada antes disso nasce inútil (RN-475).',
      'Entre um e outro, o arquivo que o runner lê NÃO existe — nunca existe pela metade.',
      '',
      '--dir  — a pasta de destino. Omitida, é a pasta de configuração desta máquina',
      '         ($XDG_CONFIG_HOME/brabo, senão ~/.config/brabo), ao lado do runner.json:',
      '         é o destino da chave de MÁQUINA, que não tem pasta de projeto onde morar.',
      '',
      'Exemplo (o que o instalador faz):',
      '  PUB=$(brabo-runner device-key create)',
      '  ID=$(curl -s ... -d "{\\"name\\":\\"...\\",\\"publicKeyJwk\\":$PUB}" | jq -r .id)',
      '  brabo-runner device-key finish --id "$ID"',
    ],
  };
}

function recusa(linhas: string[]): RespostaDaChave {
  return { fluxo: 'erro', codigo: 2, stdout: null, linhas };
}

function valorDe(argv: string[], flag: string): string | undefined {
  const args = argv.slice(2);
  const indice = args.indexOf(flag);
  if (indice < 0) return undefined;
  const valor = args[indice + 1];
  return valor === undefined || valor.startsWith('--') ? undefined : valor;
}

/**
 * O destino: `--dir` quando informado (resolvido contra o `cwd`, como toda
 * outra pasta deste CLI), a pasta de configuração da máquina quando não.
 *
 * `validarDirDentroDoHomeNoLinux` é REUSADA inteira — a mesma régua da RN-434,
 * e pelo mesmo motivo: o que se grava aqui é um segredo do USUÁRIO, e uma
 * pasta fora do `$HOME` dele não é onde o `systemd --user` dele vai procurar.
 * Fora do Linux a restrição não se aplica, como lá.
 */
function resolverDestino(ctx: ContextoDaChave): { pasta: string } | { recusa: RespostaDaChave } {
  const flag = valorDe(ctx.argv, '--dir');
  const pasta = flag
    ? resolverDir(flag, ctx.cwd, ctx.cwd)
    : pastaDeConfiguracaoDoBrabo(ctx.home, ctx.xdgConfigHome);

  try {
    validarDirDentroDoHomeNoLinux(pasta, ctx.plataforma, ctx.home);
  } catch (erro) {
    if (erro instanceof DirForaDoHomeError) return { recusa: recusa([erro.message]) };
    throw erro;
  }
  return { pasta };
}

function caminhos(pasta: string): { final: string; parcial: string } {
  const final = join(pasta, NOME_ARQUIVO_CHAVE);
  return { final, parcial: `${final}${SUFIXO_PARCIAL}` };
}

/**
 * Gera o par, imprime a PÚBLICA e grava a PRIVADA incompleta. Ver o docblock
 * do módulo para por que a privada ainda não tem `kid` — e por que o arquivo
 * ainda não tem o nome que o runner lê.
 */
export async function criarChaveDeDispositivo(ctx: ContextoDaChave): Promise<RespostaDaChave> {
  const destino = resolverDestino(ctx);
  if ('recusa' in destino) return destino.recusa;
  const { final, parcial } = caminhos(destino.pasta);

  if (existsSync(final)) {
    // Sobrescrever aqui trocaria, em silêncio, a identidade de um agente que
    // pode estar de pé AGORA: a pública correspondente continuaria registrada
    // no servidor e o processo passaria a assinar com uma chave que ninguém
    // conhece. Não há `--force`: uma flag que derruba uma guarda cujo sintoma
    // é silencioso devolve o sintoma silencioso.
    return recusa([
      `Já existe uma chave de dispositivo em ${final} — nada foi alterado.`,
      'Trocar a chave de uma máquina que já está pareada é uma decisão, não um passo de',
      'instalação: revogue a chave atual (a listagem de chaves do projeto/da conta mostra',
      'cada uma, RN-519), apague este arquivo e só então rode `device-key create` de novo.',
    ]);
  }

  let pastaCriada = false;
  try {
    if (!existsSync(destino.pasta)) {
      mkdirSync(destino.pasta, { recursive: true, mode: MODO_DA_PASTA });
      pastaCriada = true;
    }
  } catch (erro) {
    return recusa([
      `Não consegui criar a pasta ${destino.pasta}: ${erro instanceof Error ? erro.message : String(erro)}`,
    ]);
  }
  // Só a pasta que ESTE comando criou tem o modo apertado: uma pasta que já
  // existia é do usuário (pode ser a de um projeto, configurada pelo
  // navegador), e reapertá-la seria mexer em algo que ninguém pediu.
  if (pastaCriada) chmodSync(destino.pasta, MODO_DA_PASTA);

  const par = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  const publica = await exportJWK(par.publicKey);
  const privada = await exportJWK(par.privateKey);

  const jaHaviaParcial = existsSync(parcial);
  gravarComModoRestrito(parcial, JSON.stringify(privada));

  return {
    fluxo: 'saida',
    codigo: 0,
    // Sem espaço nem quebra de linha dentro: uma linha, para `$(...)`.
    stdout: JSON.stringify(publica),
    linhas: [
      `Par Ed25519 gerado NESTA máquina. A privada ficou em ${parcial} (modo 600) e não viajou.`,
      'A linha impressa no stdout é a JWK PÚBLICA — é ela que vai para a api, no campo',
      '`publicKeyJwk` do registro da chave de dispositivo.',
      '',
      'Este arquivo AINDA NÃO é usável: falta o `kid`, que é o id que a api devolve ao',
      'registrar a pública (RN-475). Registre-a e termine com:',
      `  brabo-runner device-key finish --id <id-do-registro>${
        valorDe(ctx.argv, '--dir') ? ` --dir ${destino.pasta}` : ''
      }`,
      ...(jaHaviaParcial
        ? [
            '',
            `Havia um ${parcial} de uma tentativa anterior, e ele foi substituído. Se aquela`,
            'tentativa chegou a registrar a pública na api, o registro ficou ÓRFÃO: ele é inerte',
            '(ninguém tem a privada) e aparece na listagem de chaves, de onde pode ser revogado.',
          ]
        : []),
    ],
  };
}

/**
 * Carimba o `kid` e grava o arquivo que o runner lê. É aqui, e só aqui, que o
 * nome `brabo-runner-device-key.jwk.json` passa a existir.
 */
export function finalizarChaveDeDispositivo(ctx: ContextoDaChave): RespostaDaChave {
  const destino = resolverDestino(ctx);
  if ('recusa' in destino) return destino.recusa;
  const { final, parcial } = caminhos(destino.pasta);

  const id = valorDe(ctx.argv, '--id');
  if (id === undefined || id.trim().length === 0) {
    return recusa([
      '`device-key finish` precisa de --id <id-do-registro>: o id que a api devolveu ao',
      'registrar a chave PÚBLICA. Ele vira o campo `kid` da JWK privada, e é o ÚNICO',
      'vínculo entre este arquivo e a pública que o servidor guarda (RN-475) — não há como',
      'derivá-lo de nada que esteja nesta máquina.',
    ]);
  }
  if (/\s/.test(id) || id.length > 200) {
    return recusa([
      `--id recusado: ${JSON.stringify(id)} tem espaço/quebra de linha ou é longo demais.`,
      'O id do registro é um identificador opaco da api — se o que você tem é a resposta',
      'inteira do POST, extraia o campo `id` dela (por exemplo, com `jq -r .id`).',
    ]);
  }

  if (existsSync(final)) {
    return recusa([
      `Já existe uma chave de dispositivo COMPLETA em ${final} — nada foi alterado.`,
      'Terminar por cima dela trocaria a identidade desta máquina em silêncio. Se a intenção',
      'é repareá-la, revogue a chave atual, apague este arquivo e comece por',
      '`device-key create`.',
    ]);
  }

  if (!existsSync(parcial)) {
    return recusa([
      `Não há ${parcial} para terminar.`,
      'Este passo carimba o `kid` numa privada que `device-key create` gerou nesta máquina —',
      'ele não cria par nenhum, de propósito: uma chave criada aqui teria de ser registrada',
      'de novo, e a que já está registrada ficaria órfã. Rode `brabo-runner device-key create`',
      'primeiro.',
    ]);
  }

  let jwk: Record<string, unknown>;
  try {
    const bruto = JSON.parse(readFileSync(parcial, 'utf-8')) as unknown;
    if (typeof bruto !== 'object' || bruto === null) throw new Error('não é um objeto');
    jwk = bruto as Record<string, unknown>;
  } catch (erro) {
    return recusa([
      `${parcial} existe, mas foi RECUSADO: ${erro instanceof Error ? erro.message : String(erro)}.`,
      'Apague-o e rode `brabo-runner device-key create` de novo — carimbar um `kid` num',
      'arquivo que não é a privada gravaria uma chave que nunca vai assinar nada.',
    ]);
  }
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.d !== 'string') {
    return recusa([
      `${parcial} existe, mas não é a JWK PRIVADA Ed25519 que este comando gravou`,
      '(esperado kty "OKP", crv "Ed25519" e o campo "d").',
      'Apague-o e rode `brabo-runner device-key create` de novo.',
    ]);
  }

  gravarComModoRestrito(final, JSON.stringify({ ...jwk, kid: id.trim() }));
  rmSync(parcial, { force: true });

  return {
    fluxo: 'saida',
    codigo: 0,
    // O stdout do `finish` é o CAMINHO — o valor que o passo seguinte do
    // instalador precisa (`service install --machine --dir <pasta>`).
    stdout: final,
    linhas: [
      `Chave de dispositivo completa: ${final} (modo 600, kid ${id.trim()}).`,
      `O arquivo parcial foi removido. O runner lê esta chave da pasta em que ele RODA —`,
      'para a unit de máquina, aponte `--dir` desta pasta:',
      `  brabo-runner service install --machine --dir ${destino.pasta}`,
    ],
  };
}

/**
 * Grava com 600 sem depender do `umask`: `writeFileSync` com `mode` só vale
 * para arquivo que ele CRIA, e um arquivo pré-existente manteria o modo antigo.
 * O `chmodSync` depois fecha os dois casos.
 */
function gravarComModoRestrito(caminho: string, conteudo: string): void {
  writeFileSync(caminho, conteudo, { mode: MODO_DA_CHAVE });
  chmodSync(caminho, MODO_DA_CHAVE);
}

/** O modo efetivo de um arquivo, para teste e para mensagem. */
export function modoDoArquivo(caminho: string): number {
  return statSync(caminho).mode & 0o777;
}

/**
 * O despacho do `device-key`, no mesmo molde de `rodarSubcomandoDeServico`:
 * nenhum dos dois conecta a nada, e por isso os dois rodam ANTES de
 * `lerArgumentos` — exigir credencial e pasta verificada para CRIAR a
 * credencial seria pedir o que ainda não existe.
 */
export async function rodarSubcomandoDeChave(ctx: ContextoDaChave): Promise<RespostaDaChave> {
  const sub = ctx.argv[3];
  if (!ehSubcomandoDeChaveConhecido(sub)) return usoDeChaveDeDispositivo();
  return sub === 'create' ? criarChaveDeDispositivo(ctx) : finalizarChaveDeDispositivo(ctx);
}

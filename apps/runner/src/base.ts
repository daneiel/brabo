/**
 * ONDE a base de projetos do runner mora no disco do usuário (ADR 0151 ponto
 * 1, RN-529) — a pasta ÚNICA da instalação sob a qual cada projeto é uma
 * SUBPASTA.
 *
 * Este módulo só LÊ e só nomeia o que encontrou. Ele não valida caminho
 * (isso é `base-guard.ts`), não cria pasta nenhuma e não decide política de
 * fallback — quem chama decide, exatamente como `device-key.ts` já faz com a
 * chave local.
 *
 * ## Por que um ARQUIVO de usuário, e não as outras três opções
 *
 * A base é da INSTALAÇÃO (uma base, N projetos), e as três alternativas
 * óbvias erram de escopo ou de nome:
 *
 * - **campo em `brabo-runner.config.json`** (`device-key.ts`): esse arquivo é
 *   por PROJETO, vive DENTRO da pasta do projeto — que é uma subpasta da base
 *   — e é escrito pelo NAVEGADOR (`apps/web/src/lib/runner-bootstrap.ts`).
 *   Guardar a base ali daria N cópias do mesmo valor, uma por projeto, com N
 *   oportunidades de divergir, e mudaria um formato que tem um escritor do
 *   outro lado do produto. Escopo errado.
 * - **variável de ambiente**: `BRABO_PROJECTS_BASE` já existe e é OUTRA coisa
 *   — a base dos projetos `mounted` do lado SERVIDOR (ADR 0141). Numa
 *   instalação local os dois processos leem o mesmo shell, e o ADR 0141
 *   recusou por escrito exatamente esse tipo de colisão de namespace. Um nome
 *   novo resolveria a colisão e continuaria frágil no caso que mais importa:
 *   sob `systemd --user`/LaunchAgent (RN-518) o ambiente é o da unit, não o
 *   do shell de quem instalou.
 * - **só a flag `--base`**: obrigaria a unit de serviço a carregar a base no
 *   `ExecStart` (`servico.ts`), e trocar a base passaria a exigir reescrever
 *   todas as units. A flag EXISTE — ela vence este arquivo, como toda flag
 *   explícita vence configuração local neste CLI —, mas não pode ser o único
 *   caminho.
 *
 * ## Onde: o idioma XDG que `servico.ts` já usa, e NÃO `~/.brabo/`
 *
 * `$XDG_CONFIG_HOME/brabo/runner.json`, com fallback `~/.config/brabo/` — a
 * MESMA precedência de `SYSTEMD.caminhoDaUnidade` (`servico.ts`). `~/.brabo/`
 * é evitado de propósito: é o caminho onde a Onda 2 do ADR 0104 tirou o cache
 * global de CREDENCIAL, e reusar o nome misturaria duas histórias.
 *
 * E isto NÃO reabre aquela porta. O que foi fechado é credencial gravada em
 * caminho global e implícito (ver o docblock de `auth.ts`, e a trava "nenhum
 * I/O de arquivo" de `auth.spec.ts`); o que este módulo lê é um CAMINHO DE
 * PASTA, não um segredo, escrito por um instalador que perguntou (ADR 0150).
 * `device-key.ts` continua com a garantia dele — "só lê, só do `cwd` que o
 * chamador passar" —, e é por isso que a base não entrou lá: a garantia deste
 * módulo é diferente e mais fraca, e juntá-los apagaria a de lá.
 *
 * ## Os quatro desfechos não colapsam (RN-475)
 *
 * "Não há arquivo" é o caso NORMAL de quem nunca rodou o instalador, e é o
 * binário legado da RN-514 continuando a funcionar. "Há arquivo e ele não
 * presta" é outra coisa, com outro conserto. Colapsar os dois num `null` foi
 * o defeito que a RN-475 custou uma caçada para achar.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BaseInvalidaError, validarBaseDeProjetos, type OpcoesDaBase } from './base-guard.ts';

export const NOME_ARQUIVO_BASE = 'runner.json';

/**
 * `$XDG_CONFIG_HOME/brabo/runner.json` quando a variável está posta e não é
 * vazia, `<home>/.config/brabo/runner.json` quando não — a MESMA precedência
 * de `servico.ts`, e não uma segunda régua.
 */
export function caminhoDoArquivoDeBase(home: string, xdgConfigHome: string | null): string {
  return join(pastaDeConfiguracaoDoBrabo(home, xdgConfigHome), NOME_ARQUIVO_BASE);
}

/**
 * A PASTA de configuração desta máquina — a metade de `caminhoDoArquivoDeBase`
 * que não é o nome do arquivo.
 *
 * Extraída (e não copiada) quando ganhou o segundo consumidor: a chave de
 * dispositivo criada no terminal (RN-551) mora ao lado do `runner.json`, pela
 * mesma razão que ele mora aqui — é configuração da MÁQUINA, não de um
 * projeto, e uma chave de máquina não tem pasta de projeto onde morar. Uma
 * segunda cópia da precedência `$XDG_CONFIG_HOME` › `~/.config` é exatamente o
 * que o docblock acima recusa: as duas divergiriam no dia em que uma delas
 * mudasse.
 */
export function pastaDeConfiguracaoDoBrabo(home: string, xdgConfigHome: string | null): string {
  const raiz = xdgConfigHome && xdgConfigHome.length > 0 ? xdgConfigHome : join(home, '.config');
  return join(raiz, 'brabo');
}

export type LeituraDaBase =
  /** Não há arquivo (ou não deu para lê-lo). O caso NORMAL — nunca um erro. */
  | { estado: 'ausente' }
  /** O arquivo existe e o conteúdo não é um objeto JSON válido. */
  | { estado: 'json-invalido' }
  /** O arquivo existe, é JSON válido, e não tem `base` como string não-vazia. */
  | { estado: 'sem-base' }
  /** O arquivo existe e declara uma base — CRUA, ainda não validada. */
  | { estado: 'lida'; base: string };

/**
 * Lê a base consentida do arquivo de usuário. NUNCA lança: os três fracassos
 * viram estado nomeado, e a base devolvida é a string CRUA do arquivo — quem
 * valida é `base-guard.ts`, e separar as duas coisas é o que permite a esta
 * função dizer "o arquivo não presta" sem opinar sobre o caminho.
 */
export function lerBaseConsentida(home: string, xdgConfigHome: string | null): LeituraDaBase {
  let bruto: string;
  try {
    bruto = readFileSync(caminhoDoArquivoDeBase(home, xdgConfigHome), 'utf-8');
  } catch {
    return { estado: 'ausente' }; // ausente, sem permissão, etc. — caso normal
  }

  let json: unknown;
  try {
    json = JSON.parse(bruto);
  } catch {
    return { estado: 'json-invalido' };
  }
  if (typeof json !== 'object' || json === null) {
    // JSON válido que não é objeto (`"texto"`, `42`, `null`) — o arquivo
    // existe e não serve; não é ausência.
    return { estado: 'json-invalido' };
  }

  const base = (json as Record<string, unknown>).base;
  if (typeof base !== 'string' || base.trim().length === 0) return { estado: 'sem-base' };

  return { estado: 'lida', base: base.trim() };
}

/**
 * A frase que EXPLICA a recusa do ARQUIVO, para o CLI imprimir — mora aqui,
 * junto do formato, porque é sobre o arquivo. O que FAZER com a recusa
 * continua sendo do chamador.
 *
 * O tipo do parâmetro exclui `ausente` e `lida` de propósito: não existe
 * explicação para o caso normal nem para o sucesso, e um texto vago cobrindo
 * os quatro estados seria o defeito que esta função existe para corrigir.
 */
export function explicacaoDaBaseRecusada(
  motivo: 'json-invalido' | 'sem-base',
  caminho: string,
): string {
  const detalhe =
    motivo === 'json-invalido'
      ? 'o conteúdo não é um objeto JSON válido (arquivo truncado ou corrompido).'
      : 'não há um campo "base" com um caminho absoluto não-vazio.';
  return (
    `${caminho} existe, mas foi RECUSADO: ${detalhe}\n` +
    'Rode o instalador de novo para reconsentir a base, ou passe --base <caminho> ' +
    'nesta execução.'
  );
}

/** De onde a base veio — a fonte decide o que fazer quando ela é recusada. */
export type OrigemDaBase = 'flag' | 'arquivo';

export type BaseResolvida =
  /** Nenhuma fonte declarou base. O caso NORMAL, e o legado da RN-514. */
  | { estado: 'ausente' }
  | { estado: 'ok'; base: string; origem: OrigemDaBase }
  | { estado: 'recusada'; origem: OrigemDaBase; mensagem: string };

/**
 * A ORDEM das fontes, e a validação — as duas numa função só, porque "de onde
 * veio" e "vale?" só produzem resposta útil juntas: recusar sem dizer a origem
 * impediria o chamador de decidir se a recusa é fatal.
 *
 * A flag EXPLÍCITA vence o arquivo, o mesmo critério que `lerArgumentos` já
 * aplica a `--project`/`--api-url`/`--token`. Sem flag e sem arquivo — ou com
 * um arquivo que existe e não declara `base` (`sem-base`, que é configuração
 * SEM base consentida, não configuração quebrada) — a resposta é `ausente`, e
 * o runner roda exatamente como sempre rodou.
 *
 * NUNCA lança e NUNCA sai do processo: o que fazer com `recusada` é do
 * chamador, e ele decide pela `origem` — uma flag digitada agora é um pedido
 * explícito que não dá para honrar; um arquivo gravado pelo instalador há
 * meses não deveria derrubar um runner que nem usa a base ainda.
 */
export function resolverBaseConsentida(
  baseDaFlag: string | undefined,
  home: string,
  xdgConfigHome: string | null,
  opcoes: OpcoesDaBase,
): BaseResolvida {
  if (baseDaFlag !== undefined) return validar(baseDaFlag, 'flag', opcoes);

  const leitura = lerBaseConsentida(home, xdgConfigHome);
  if (leitura.estado === 'ausente' || leitura.estado === 'sem-base') {
    return { estado: 'ausente' };
  }
  if (leitura.estado === 'json-invalido') {
    return {
      estado: 'recusada',
      origem: 'arquivo',
      mensagem: explicacaoDaBaseRecusada(
        'json-invalido',
        caminhoDoArquivoDeBase(home, xdgConfigHome),
      ),
    };
  }
  return validar(leitura.base, 'arquivo', opcoes);
}

function validar(bruta: string, origem: OrigemDaBase, opcoes: OpcoesDaBase): BaseResolvida {
  try {
    return { estado: 'ok', base: validarBaseDeProjetos(bruta, opcoes), origem };
  } catch (erro) {
    if (erro instanceof BaseInvalidaError) {
      return { estado: 'recusada', origem, mensagem: erro.message };
    }
    throw erro;
  }
}

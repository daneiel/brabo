/**
 * Leitura do fluxo "configurar pasta automaticamente" (feito pelo navegador,
 * do lado web) — a pasta que o usuário escolhe ganha TRÊS arquivos: o
 * binário (`brabo-runner`/`brabo-runner.exe`), `brabo-runner.config.json`
 * (`{ projectId, apiUrl }`) e a chave privada de dispositivo
 * (`brabo-runner-device-key.jwk.json`, uma JWK Ed25519 serializada como
 * JSON, com `kid` = id do registro `runner_device_keys` do lado da api).
 * Com os três presentes no `cwd`, `brabo-runner` roda sem NENHUMA flag.
 *
 * ## Por que este módulo é SEPARADO de `auth.ts`
 *
 * `auth.ts` tem uma trava deliberada (`auth.spec.ts`, "nenhum I/O de
 * arquivo") contra reintroduzir um cache de credencial GLOBAL/IMPLÍCITO em
 * `~/.brabo/...` — o problema que a Onda 2 do ADR 0104 fechou de propósito
 * (ver o docblock de `auth.ts`). Este módulo NÃO reabre aquela porta: ele lê
 * um arquivo LOCAL e EXPLÍCITO, que o próprio usuário colocou ali agora
 * mesmo, com o gesto de baixar a pasta pelo navegador — nunca um caminho
 * global (`$HOME`, `os.homedir()`, um diretório de config do SO). Por isso
 * mora num arquivo à parte: a garantia de `auth.ts` continua sendo "este
 * módulo nunca toca disco", e este módulo novo tem a garantia MAIS FRACA e
 * DIFERENTE de "só lê, só do `cwd` que o chamador passar".
 *
 * NENHUMA função deste módulo lança — arquivo ausente, JSON inválido, ou
 * faltando campo obrigatório devolvem `null`, porque a ausência destes
 * arquivos é o caso NORMAL de quem ainda usa `--project`/`--dir`/`--token`
 * explícitos (o fluxo de sempre, inalterado). Quem chama decide o que fazer
 * com o `null` — este módulo não decide política de fallback.
 *
 * ## `null` não diz POR QUE (RN-475)
 *
 * Justamente por não lançar, `lerChaveDeDispositivo` devolve o MESMO `null`
 * para "não tem arquivo" e para "tem arquivo e ele não presta" — e o CLI
 * imprimia o mesmo bloco de uso nos dois casos, falando de flags, sem
 * mencionar o arquivo que estava ali. `estadoDaChaveDeDispositivo` e
 * `explicacaoDaChaveRecusada` existem para o chamador poder separar os dois
 * SEM que a leitura passe a lançar: a ausência continua sendo caminho
 * normal, e só a recusa vira mensagem própria.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const NOME_ARQUIVO_CONFIG = 'brabo-runner.config.json';
export const NOME_ARQUIVO_CHAVE = 'brabo-runner-device-key.jwk.json';

export interface ConfigLocal {
  projectId: string;
  apiUrl: string;
}

export interface ChaveDeDispositivo {
  jwkPrivada: object;
  deviceKeyId: string;
}

/**
 * Leitura crua, com os dois motivos de fracasso SEPARADOS. `lerConfigLocal`
 * colapsa os dois em `null` (o comportamento de sempre, inalterado); quem
 * precisa distinguir "não tem arquivo" de "tem arquivo e ele não presta" é
 * `estadoDaChaveDeDispositivo` (RN-475).
 */
type LeituraCrua =
  | { estado: 'ausente' }
  | { estado: 'json-invalido' }
  | { estado: 'lido'; json: unknown };

function lerJsonCru(caminho: string): LeituraCrua {
  let bruto: string;
  try {
    bruto = readFileSync(caminho, 'utf-8');
  } catch {
    return { estado: 'ausente' }; // ausente, sem permissão, etc. — caso normal, não é erro
  }
  try {
    return { estado: 'lido', json: JSON.parse(bruto) };
  } catch {
    return { estado: 'json-invalido' }; // corrompido/truncado
  }
}

function lerJsonLocal(caminho: string): unknown | null {
  const leitura = lerJsonCru(caminho);
  return leitura.estado === 'lido' ? leitura.json : null;
}

/**
 * Lê `brabo-runner.config.json` de dentro de `cwd` (SEMPRE o `cwd` que o
 * chamador passa — nunca `$HOME`/global). Devolve `null` (nunca lança)
 * quando o arquivo não existe, o JSON é inválido, ou `projectId`/`apiUrl`
 * não são strings não-vazias.
 */
export function lerConfigLocal(cwd: string): ConfigLocal | null {
  const json = lerJsonLocal(join(cwd, NOME_ARQUIVO_CONFIG));
  if (json === null || typeof json !== 'object') return null;

  const { projectId, apiUrl } = json as Record<string, unknown>;
  if (typeof projectId !== 'string' || projectId.length === 0) return null;
  if (typeof apiUrl !== 'string' || apiUrl.length === 0) return null;

  return { projectId, apiUrl };
}

/**
 * Lê `brabo-runner-device-key.jwk.json` de dentro de `cwd`. O `kid` gravado
 * na própria JWK privada É o id do registro `runner_device_keys` do lado da
 * api — esta função só repassa `jwk.kid` como `deviceKeyId`, nunca inventa
 * ou deriva um id por conta própria. Devolve `null` (nunca lança) quando o
 * arquivo não existe, o JSON é inválido, ou falta `kid`.
 */
export function lerChaveDeDispositivo(cwd: string): ChaveDeDispositivo | null {
  const leitura = examinarChaveDeDispositivo(cwd);
  return leitura.estado === 'valida' ? leitura.chave : null;
}

/**
 * Os QUATRO desfechos possíveis da leitura da chave local, sem colapsar
 * nenhum deles (RN-475). `lerChaveDeDispositivo` continua devolvendo o
 * `null` de sempre — quem precisa saber POR QUE não veio chave usa isto.
 */
export type EstadoDaChaveLocal = 'ausente' | 'json-invalido' | 'sem-kid' | 'valida';

type ExameDaChave =
  | { estado: 'valida'; chave: ChaveDeDispositivo }
  | { estado: Exclude<EstadoDaChaveLocal, 'valida'> };

function examinarChaveDeDispositivo(cwd: string): ExameDaChave {
  const leitura = lerJsonCru(join(cwd, NOME_ARQUIVO_CHAVE));
  if (leitura.estado === 'ausente') return { estado: 'ausente' };
  if (leitura.estado === 'json-invalido') return { estado: 'json-invalido' };
  if (typeof leitura.json !== 'object' || leitura.json === null) {
    // JSON válido que não é objeto (`"texto"`, `42`, `null`) — o arquivo
    // existe e não serve; não é ausência.
    return { estado: 'json-invalido' };
  }

  const kid = (leitura.json as Record<string, unknown>).kid;
  if (typeof kid !== 'string' || kid.length === 0) return { estado: 'sem-kid' };

  return {
    estado: 'valida',
    chave: { jwkPrivada: leitura.json as object, deviceKeyId: kid },
  };
}

/**
 * Por que a chave local não foi usada — `ausente` (o caso NORMAL de quem
 * roda com `--project`/`--dir`/`--token`) ou um dos dois motivos de RECUSA.
 *
 * Existe porque os três produziam a MESMA saída no CLI: o bloco de `uso()`,
 * que fala de flags e não menciona o arquivo. Um arquivo presente e recusado
 * lido como "você não configurou nada" mandava a pessoa investigar o
 * `brabo-runner.config.json`, que estava certo (RN-475). Continua sem lançar
 * e sem decidir política nenhuma: só nomeia o que encontrou.
 *
 * Relê o arquivo, de propósito — só é chamada no caminho de FALHA, um
 * instante antes de o processo sair, e o preço de um `readFileSync` ali é
 * menor que o de deixar o caminho feliz carregar um estado que ele não usa.
 */
export function estadoDaChaveDeDispositivo(cwd: string): EstadoDaChaveLocal {
  return examinarChaveDeDispositivo(cwd).estado;
}

/**
 * A frase que EXPLICA a recusa, para o CLI imprimir. Mora aqui, junto do
 * formato do arquivo, porque é sobre o ARQUIVO — o que FAZER com a recusa
 * (sair, com qual código, com ou sem o bloco de uso) continua sendo do
 * chamador, como diz o docblock do módulo.
 *
 * O tipo do parâmetro exclui `ausente` e `valida` de propósito: não existe
 * "explicação" para o caso normal nem para o sucesso, e um texto vago
 * cobrindo os quatro estados seria exatamente o defeito que esta função
 * existe para corrigir.
 */
export function explicacaoDaChaveRecusada(motivo: 'json-invalido' | 'sem-kid'): string {
  const cabeca = `${NOME_ARQUIVO_CHAVE} existe nesta pasta, mas foi RECUSADO:`;
  const detalhe =
    motivo === 'json-invalido'
      ? 'o conteúdo não é um objeto JSON válido (arquivo truncado ou corrompido).'
      : 'a JWK não tem o campo "kid" — o id do registro da chave no servidor, ' +
        'sem o qual a api não tem como achar a chave pública correspondente.';
  return (
    `${cabeca} ${detalhe}\n` +
    'Refaça "Configurar pasta automaticamente" na tela do projeto para regravar a pasta, ' +
    'ou rode com --token <brb_...> enquanto isso.'
  );
}

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
 * Nenhuma das duas funções abaixo lança — arquivo ausente, JSON inválido,
 * ou faltando campo obrigatório devolvem `null`, porque a ausência destes
 * arquivos é o caso NORMAL de quem ainda usa `--project`/`--dir`/`--token`
 * explícitos (o fluxo de sempre, inalterado). Quem chama decide o que fazer
 * com o `null` — este módulo não decide política de fallback.
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

function lerJsonLocal(caminho: string): unknown | null {
  let bruto: string;
  try {
    bruto = readFileSync(caminho, 'utf-8');
  } catch {
    return null; // ausente, sem permissão, etc. — caso normal, não é erro
  }
  try {
    return JSON.parse(bruto);
  } catch {
    return null; // JSON corrompido/truncado — trata como ausente
  }
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
  const json = lerJsonLocal(join(cwd, NOME_ARQUIVO_CHAVE));
  if (json === null || typeof json !== 'object') return null;

  const kid = (json as Record<string, unknown>).kid;
  if (typeof kid !== 'string' || kid.length === 0) return null;

  return { jwkPrivada: json as object, deviceKeyId: kid };
}

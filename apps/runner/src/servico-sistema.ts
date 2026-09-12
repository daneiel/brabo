/**
 * O adaptador REAL da fronteira de `servico.ts` (ADR 0147 ponto 5, RN-518):
 * disco de verdade e `systemctl`/`launchctl` de verdade.
 *
 * Mora num arquivo à parte para que a garantia do docblock de `servico.ts`
 * continue verdadeira e verificável — *"nenhuma função daquele módulo chama
 * `node:fs` ou `node:child_process`"*. É a mesma disciplina que separou
 * `device-key.ts` de `auth.ts`: a garantia de um módulo não é enfraquecida
 * pelo módulo que precisa fazer o I/O.
 *
 * Nada aqui decide política. As DUAS coisas que ele faz de propósito:
 *
 * 1. **`spawn` que falhou nunca vira "o comando disse não".** `execFileSync`
 *    lança tanto quando o binário não existe (ENOENT) quanto quando ele rodou e
 *    saiu != 0, e os dois casos são respostas diferentes (RN-088): o primeiro é
 *    `nao-consegui` e o segundo é `executou` com o código. Distinguir pelo
 *    `error.status` — presente só quando houve processo — é o que separa os dois.
 * 2. **Nenhum comando herda `stdin`, e a saída nunca vaza para o terminal.**
 *    `stdio: 'pipe'` em tudo: `systemctl --user` num terminal sem tty poderia
 *    abrir um pager e travar o CLI esperando entrada.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { ResultadoDeComando, SistemaDeServico } from './servico.ts';

/** `systemctl`/`launchctl` respondem em milissegundos; um que não responde é problema. */
const TIMEOUT_DO_GERENCIADOR_MS = 20_000;

export const sistemaDeServicoReal: SistemaDeServico = {
  lerArquivo(caminho) {
    try {
      return readFileSync(caminho, 'utf-8');
    } catch {
      // Ausente, sem permissão, é um diretório — para este módulo os três são
      // "não há registro aqui". Quem chama trata como não instalado.
      return null;
    }
  },

  criarPasta(caminho) {
    mkdirSync(caminho, { recursive: true });
  },

  escreverArquivo(caminho, conteudo) {
    // `0o644`: a unit não guarda segredo nenhum (a credencial é a chave de
    // dispositivo, que fica na pasta do projeto e não aqui) e o gerenciador
    // precisa lê-la.
    writeFileSync(caminho, conteudo, { encoding: 'utf-8', mode: 0o644 });
  },

  apagarArquivo(caminho) {
    if (!existsSync(caminho)) return false;
    rmSync(caminho, { force: true });
    return true;
  },

  existeArquivo(caminho) {
    return existsSync(caminho);
  },

  listarPasta(caminho) {
    try {
      return readdirSync(caminho);
    } catch {
      // Pasta ausente é o caso normal de quem nunca instalou serviço nenhum;
      // sem permissão e "é um arquivo" levam ao mesmo lugar. Ver o docblock de
      // `listarPasta` em `servico.ts` para por que os três colapsam aqui.
      return [];
    }
  },

  rodar(comando, args): ResultadoDeComando {
    try {
      const saida = execFileSync(comando, args, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: TIMEOUT_DO_GERENCIADOR_MS,
      });
      return { estado: 'executou', codigo: 0, saida: saida ?? '' };
    } catch (erro) {
      const detalhe = erro as {
        status?: number | null;
        stdout?: string | Buffer;
        stderr?: string | Buffer;
        message?: string;
        code?: string;
      };
      if (typeof detalhe.status === 'number') {
        // Houve processo, e ele respondeu — inclusive quando a resposta é "não".
        const saida = `${detalhe.stdout ?? ''}${detalhe.stderr ?? ''}`.toString();
        return { estado: 'executou', codigo: detalhe.status, saida };
      }
      // Nunca houve processo (binário ausente do PATH, timeout, sinal): não dá
      // para dizer o que o gerenciador acha, e fingir um código seria inventar.
      return {
        estado: 'nao-consegui',
        motivo: detalhe.code ?? detalhe.message ?? 'não foi possível executar o comando',
      };
    }
  },
};

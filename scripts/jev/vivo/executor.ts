/**
 * As ferramentas do dev agent executadas numa pasta-sandbox, para o teste ao
 * vivo da AT-239. NÃO é o engine: é o mínimo que devolve ao modelo o mesmo
 * TIPO de resultado que o engine devolve, com o mesmo texto onde o texto é
 * fixo no código (citado ao lado). O que muda, declarado:
 *
 * - `terminal` e `write_file` rodam DIRETO, como num projeto em modo automático
 *   (RN-153/RN-603): não há fila de aprovação humana num teste sem humano. Os
 *   dois braços são iguais nisso.
 * - `rag_search` não tem índice: devolve "nenhum trecho", nos dois braços.
 * - `listar_contratos_de_modulos` devolve "nenhum contrato declarado" (o texto
 *   do engine para esse caso).
 * - O processo do `terminal` roda com ambiente MÍNIMO (`PATH`, `HOME` na
 *   sandbox): a chave do OpenRouter nunca chega a ele.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { MensagemDoLaco } from './laco.ts';

/** `read_file_max_bytes`/`search_workspace_max_bytes`/saída de terminal do engine: 32 KiB. */
export const TETO_DE_BYTES = 32_768;
export const TIMEOUT_DO_TERMINAL_MS = 60_000;

export interface ResultadoDaFerramenta {
  conteudo: string;
  ok: boolean;
}

/** `apps/engine/lib/engine/harness/tools/listar_contratos_de_modulos.ex` (`renderizar/3` sem contrato + `@sem_contrato`). */
const SEM_CONTRATO =
  'Nenhum contrato entre módulos foi declarado pelo Arquiteto neste projeto.\n\n' +
  'Sem contrato, a interface desse módulo NÃO está fixada. Não a deduza do\n' +
  'worktree de outro dev agent: aquilo é código em andamento, que pode mudar\n' +
  'antes de chegar à `dev`. Implemente pelo que a story e a task dizem; se a\n' +
  'task depende de uma interface que não existe, use `report_blocked` nomeando\n' +
  'o módulo e o que falta, para o Arquiteto declarar o contrato.\n';

const truncar = (texto: string): string => {
  const bytes = Buffer.byteLength(texto);
  return bytes <= TETO_DE_BYTES ? texto : `${Buffer.from(texto).subarray(0, TETO_DE_BYTES).toString()}\n\n[truncado: ${TETO_DE_BYTES} de ${bytes} bytes]`;
};

/** O caminho dentro da raiz, ou `null` (traversal) — `WorkspaceFiles` do engine. */
export function dentroDaRaiz(raiz: string, caminho: string): string | null {
  const abs = resolve(raiz, caminho);
  const rel = relative(raiz, abs);
  return rel === '' || rel.startsWith('..') || rel.startsWith(sep) ? null : abs;
}

function listar(raiz: string, dir = raiz): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome === '.git') continue;
    const abs = join(dir, nome);
    if (statSync(abs).isDirectory()) saida.push(...listar(raiz, abs));
    else saida.push(relative(raiz, abs));
  }
  return saida.sort();
}

const texto = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** O conteúdo da ÚLTIMA mensagem `tool` de `terminal` — `ReportDone.last_terminal_content/1`. */
function ultimoTerminal(historico: readonly MensagemDoLaco[]): string | null {
  const t = historico.filter((m) => m.role === 'tool' && m.name === 'terminal');
  return t.at(-1)?.content ?? null;
}

export function executar(
  raiz: string,
  nome: string,
  args: Record<string, unknown>,
  historico: readonly MensagemDoLaco[],
): ResultadoDaFerramenta {
  switch (nome) {
    case 'read_file': {
      const p = texto(args.path);
      if (p === null) return { conteudo: 'read_file exige o argumento `path`', ok: false };
      const abs = dentroDaRaiz(raiz, p);
      if (!abs) return { conteudo: `caminho fora do workspace: ${p}`, ok: false };
      try {
        return { conteudo: truncar(readFileSync(abs, 'utf8')), ok: true };
      } catch (e) {
        return { conteudo: `falha ao ler ${p}: ${(e as NodeJS.ErrnoException).code ?? 'erro'}`, ok: false };
      }
    }
    case 'write_file': {
      const p = texto(args.path);
      const c = texto(args.content);
      if (p === null || c === null) return { conteudo: 'write_file exige `path` e `content`', ok: false };
      const abs = dentroDaRaiz(raiz, p);
      if (!abs) return { conteudo: `caminho fora do workspace: ${p}`, ok: false };
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, c);
      return { conteudo: `escrito: ${p}`, ok: true };
    }
    case 'search_workspace': {
      const q = texto(args.query);
      if (q === null) return { conteudo: 'search_workspace exige o argumento `query`', ok: false };
      const arquivos = listar(raiz);
      const hits = arquivos.filter((f) => readFileSync(join(raiz, f), 'utf8').includes(q));
      if (hits.length === 0) return { conteudo: `nenhum resultado para "${q}" em ${arquivos.length} arquivo(s) do workspace`, ok: true };
      return { conteudo: truncar(`${hits.length} resultado(s):\n${hits.map((h) => `- ${h}`).join('\n')}`), ok: true };
    }
    case 'terminal': {
      const cmd = texto(args.command);
      if (cmd === null) return { conteudo: 'terminal exige o argumento `command`', ok: false };
      const r = spawnSync('bash', ['-c', cmd], {
        cwd: raiz,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: raiz, LANG: 'C.UTF-8' },
        encoding: 'utf8',
        timeout: TIMEOUT_DO_TERMINAL_MS,
      });
      const codigo = r.status ?? (r.error ? -1 : 124);
      // `Engine.Harness.Hooks.ActionPipeline`: "exit #{exitCode}\n#{stdout}".
      return { conteudo: truncar(`exit ${codigo}\n${r.stdout ?? ''}${r.stderr ?? ''}`), ok: true };
    }
    case 'rag_search':
      return { conteudo: 'nenhum trecho encontrado no RAG do projeto (índice vazio neste ensaio)', ok: true };
    case 'rag_feedback':
      return { conteudo: 'feedback registrado', ok: true };
    case 'listar_contratos_de_modulos':
      return { conteudo: SEM_CONTRATO, ok: true };
    case 'report_done':
      // `Engine.Dev.Tools.ReportDone.run/2`, texto e regra.
      return ultimoTerminal(historico)?.startsWith('exit 0')
        ? { conteudo: 'conclusão registrada — suite verde confirmada', ok: true }
        : { conteudo: 'não é possível concluir: nenhum `terminal` com exit 0 (suite verde) encontrado no histórico', ok: false };
    case 'report_blocked':
      return texto(args.reason) !== null
        ? { conteudo: 'bloqueio registrado', ok: true }
        : { conteudo: 'report_blocked exige `reason` e `diagnosis`', ok: false };
    default:
      return { conteudo: `ferramenta desconhecida: ${nome}`, ok: false };
  }
}

/** Escreve os arquivos de partida na sandbox. */
export function materializar(raiz: string, arquivos: Record<string, string>): void {
  for (const [p, c] of Object.entries(arquivos)) {
    const abs = join(raiz, p);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, c);
  }
}

export interface Verificacao {
  ok: boolean;
  motivo: string;
}

/**
 * Depois da execução, fora do laço: repõe os testes originais, acrescenta os
 * ocultos e roda `node --test`. Exit 0 (e, na renomeação, nenhum resto do nome
 * antigo em `src/`) = a task saiu.
 */
export function verificar(raiz: string, verificacao: Record<string, string>, proibidoEmSrc?: string): Verificacao {
  materializar(raiz, verificacao);
  const r = spawnSync('node', ['--test'], {
    cwd: raiz,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: raiz },
    encoding: 'utf8',
    timeout: TIMEOUT_DO_TERMINAL_MS,
  });
  if (r.status !== 0) return { ok: false, motivo: `suite: exit ${r.status ?? 'timeout'}` };
  if (proibidoEmSrc) {
    const resto = listar(raiz).filter((f) => f.startsWith('src/') && readFileSync(join(raiz, f), 'utf8').includes(proibidoEmSrc));
    if (resto.length > 0) return { ok: false, motivo: `"${proibidoEmSrc}" ainda em ${resto.join(', ')}` };
  }
  return { ok: true, motivo: 'suite verde' };
}

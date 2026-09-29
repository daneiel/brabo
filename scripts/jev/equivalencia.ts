/**
 * Classes de equivalência entre ferramentas (AT-237, segunda rodada).
 *
 * DECIDIDAS ANTES de medir, a partir da semântica das ferramentas do dev agent
 * e NÃO dos resultados: a 1ª rodada contou como erro `terminal`→`search_workspace`
 * quando o comando de terminal do agente era `ls`/`find`/`cat` — o agente leu
 * pelo shell o que o Jev mandou ler pela ferramenta. Este arquivo não pode ser
 * ajustado depois de ver um número; mudou a definição, mudou a régua, e a nota
 * da medição diz por quê.
 *
 * Três camadas, cumulativas nos degraus da cascata:
 *   E1  `terminal` cujo comando é SÓ leitura/listagem/busca  ≡  `read_file` e `search_workspace`
 *   E2  `read_file`  ≡  `search_workspace` (as duas só leem o workspace)
 *   E3  `terminal` cujo comando GRAVA arquivo (redirecionamento, heredoc, `tee`,
 *       `sed -i`, `cp`, `mv`, `touch`)  ≡  `write_file`
 *
 * A equivalência é ASSIMÉTRICA de propósito: o Jev escolher `terminal` só vale
 * para uma chamada de `terminal` (o cardápio de uma ferramenta que executa
 * qualquer coisa não é "o mesmo" que o de uma que só lê), e um comando que
 * EXECUTA (`npm`, `node`, `rm`, `git commit`…) não é equivalente a nada além
 * de `terminal`.
 */

export type ClasseDeComando = 'leitura' | 'gravacao' | 'execucao';
export type Camada = 'E1' | 'E2' | 'E3';
export const TODAS_AS_CAMADAS: readonly Camada[] = ['E1', 'E2', 'E3'];

/** Comandos que só inspecionam (não mudam o workspace nem o sistema). */
const LEITURA = new Set([
  'ls', 'find', 'cat', 'pwd', 'grep', 'egrep', 'fgrep', 'rg', 'head', 'tail', 'wc', 'tree', 'stat', 'file', 'which', 'type',
  'du', 'df', 'sort', 'uniq', 'cut', 'diff', 'realpath', 'basename', 'dirname', 'readlink', 'id', 'whoami', 'env',
  'printenv', 'uname', 'date', 'echo', 'printf', 'cd', 'test', '[', 'true', 'lsattr', 'getfacl', 'umask', 'less', 'more',
  'awk', 'sed', 'nl', 'tac', 'od', 'xxd', 'hexdump', 'md5sum', 'sha256sum', 'ps', 'hostname', 'locale', 'ulimit', 'mount', 'set',
]);
const GIT_DE_LEITURA = new Set(['status', 'log', 'diff', 'show', 'branch', 'ls-files', 'rev-parse', 'remote', 'ls-tree', 'blame', 'describe', 'tag']);
const GRAVACAO = new Set(['cp', 'mv', 'touch', 'tee', 'install']);

/** Tira `2>&1`, `>/dev/null`, `&>/dev/null`… — redirecionamentos que não gravam em arquivo. */
function semRedirecionamentosInertes(s: string): string {
  return s
    .replace(/\d*>&\d+/g, ' ')
    .replace(/&?>>?\s*\/dev\/(null|stderr|stdout)/g, ' ')
    .replace(/\d+>>?\s*\/dev\/(null|stderr|stdout)/g, ' ');
}

/** Troca o conteúdo entre aspas por um marcador (`;`/`>` dentro de texto não é sintaxe). */
function semAspas(s: string): string {
  return s.replace(/"(?:\\.|[^"\\])*"/g, '"_"').replace(/'[^']*'/g, "'_'");
}

function classeDoSegmento(seg: string): ClasseDeComando | 'neutro' {
  const t = seg.trim();
  if (t === '') return 'neutro';
  // `VAR=x cmd`
  const palavras = t.split(/\s+/).filter((p) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(p));
  const verbo = (palavras[0] ?? '').replace(/^\\/, '');
  if (verbo === '') return 'neutro';
  const resto = palavras.slice(1);
  if (verbo === 'cd' || verbo === 'true' || verbo === 'set') return 'neutro';
  if (verbo === 'sed') return resto.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place')) ? 'gravacao' : 'leitura';
  if (verbo === 'find') return resto.some((a) => ['-exec', '-execdir', '-delete', '-fprint', '-ok'].includes(a)) ? 'execucao' : 'leitura';
  if (verbo === 'git') {
    const sub = resto.find((a) => !a.startsWith('-'));
    return sub && GIT_DE_LEITURA.has(sub) && !(sub === 'branch' && resto.some((a) => /^-[dDmMcC]$/.test(a))) ? 'leitura' : 'execucao';
  }
  if (GRAVACAO.has(verbo)) return 'gravacao';
  if (LEITURA.has(verbo)) return 'leitura';
  return 'execucao';
}

/**
 * Classifica um comando de `terminal`. Composto (`;`, `&&`, `||`, `|`, quebra de
 * linha) vale pelo segmento MAIS forte: execução > gravação > leitura.
 */
export function classeDoComando(comando: string): ClasseDeComando {
  let c = comando;
  // Heredoc: o corpo é texto, não comando. O que vem antes de `<<` decide.
  const doc = /<<-?\s*['"]?\w+['"]?/.exec(c);
  let heredoc = false;
  if (doc) {
    heredoc = true;
    c = c.slice(0, doc.index);
  }
  c = semRedirecionamentosInertes(semAspas(c));
  const segmentos = c.split(/&&|\|\||;|\||\n|\$\(|\)|`/);
  const classes = segmentos.map(classeDoSegmento).filter((k): k is ClasseDeComando => k !== 'neutro');
  const grava = /(^|[^-<>\d])>{1,2}\s*[^\s&]/.test(c) || heredoc;
  if (classes.includes('execucao')) return 'execucao';
  if (classes.includes('gravacao')) return 'gravacao';
  if (grava) {
    // `cat > f <<EOF`, `echo x > f`: grava arquivo. Heredoc em programa (`node - <<EOF`) já caiu em execução acima.
    return 'gravacao';
  }
  return 'leitura';
}

export interface ChamadaClassificada {
  ferramenta: string;
  /** Só para `terminal`; `null` nas demais. */
  classe: ClasseDeComando | null;
}

export function classificarChamada(ferramenta: string, argumentos: unknown): ChamadaClassificada {
  if (ferramenta !== 'terminal') return { ferramenta, classe: null };
  const cmd = (argumentos as { command?: unknown } | null)?.command;
  return { ferramenta, classe: typeof cmd === 'string' ? classeDoComando(cmd) : 'execucao' };
}

/** A escolha do Jev serve a ESTA chamada, sob as camadas ligadas? Sem camadas = régua estrita. */
export function serve(escolha: string, c: ChamadaClassificada, camadas: readonly Camada[] = []): boolean {
  if (escolha === c.ferramenta) return true;
  const lerNoJev = escolha === 'read_file' || escolha === 'search_workspace';
  if (camadas.includes('E1') && lerNoJev && c.ferramenta === 'terminal' && c.classe === 'leitura') return true;
  if (camadas.includes('E2') && lerNoJev && (c.ferramenta === 'read_file' || c.ferramenta === 'search_workspace')) return true;
  if (camadas.includes('E3') && escolha === 'write_file' && c.ferramenta === 'terminal' && c.classe === 'gravacao') return true;
  return false;
}

/** Acerto do passo: sem ferramenta → `responder_sem_ferramenta`; senão, a escolha serve a alguma chamada. */
export function acertoDoPasso(
  escolha: string | null,
  chamadas: readonly ChamadaClassificada[],
  camadas: readonly Camada[] = [],
  semFerramenta = 'responder_sem_ferramenta',
): boolean {
  if (escolha === null) return false;
  if (chamadas.length === 0) return escolha === semFerramenta;
  return chamadas.some((c) => serve(escolha, c, camadas));
}

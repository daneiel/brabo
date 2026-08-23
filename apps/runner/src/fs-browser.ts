/**
 * Navegação de pasta local — listagem de diretório sob demanda para a UI de
 * criação/adoção de projeto (`FolderBrowserModal`, `apps/web`). Ver o
 * protocolo (`fs_list_dir`/`fs_list_dir_reply`/`fs_home_dir`/
 * `fs_home_dir_reply`) no docblock de `channel.ts` e na ADR sobre navegação
 * de pasta via o Runner, que revisa a ADR 0072.
 *
 * ## Por que isto NÃO passa pelo `guard.ts`
 *
 * `guard.ts` restringe o `cwd` de um comando de agente JÁ APROVADO à raiz
 * do projeto (`--dir`). Esta função é outra coisa: o propósito dela é
 * justamente deixar o usuário navegar LIVRE pela própria máquina, com os
 * privilégios que ele já tem no SO — a fronteira de segurança continua
 * sendo autenticação + consentimento de rodar o binário (mesmo argumento do
 * ADR 0103), não uma allowlist de caminho. Ver a ADR desta entrega para o
 * argumento completo.
 *
 * ## Erro por ENTRADA, não por listagem inteira
 *
 * Uma pasta com centenas de itens pode ter um ou dois sem permissão de
 * leitura (montagem estranha, socket, ACL restritiva). Abortar a listagem
 * inteira por causa de UM item seria pior que omiti-lo — o usuário nem
 * saberia por que a pasta "não abre". `listarDiretorio` pula a entrada
 * problemática e segue com o resto.
 */

import { readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export interface EntradaDeDiretorio {
  nome: string;
  isDir: boolean;
}

export interface ResultadoListagem {
  path: string;
  entradas: EntradaDeDiretorio[];
  erro?: string;
}

function mensagemDeErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/**
 * Lista o conteúdo de `pathBruto` (resolvido/normalizado antes de ler).
 * Nunca lança — falha vira `{ entradas: [], erro }`. Diretórios primeiro,
 * depois ordem alfabética — mesmo critério que qualquer navegador de
 * arquivo usa, e o que a UI espera renderizar sem reordenar de novo.
 */
export async function listarDiretorio(pathBruto: string): Promise<ResultadoListagem> {
  const caminho = resolve(pathBruto);

  let itens: Dirent[];
  try {
    itens = await readdir(caminho, { withFileTypes: true, encoding: 'utf8' });
  } catch (erro) {
    return { path: caminho, entradas: [], erro: mensagemDeErro(erro) };
  }

  const entradas: EntradaDeDiretorio[] = [];
  for (const item of itens) {
    try {
      entradas.push({ nome: item.name, isDir: item.isDirectory() });
    } catch {
      // Entrada individual sem permissão pra determinar o tipo (symlink
      // quebrado, ACL restritiva) — pula, não aborta a listagem inteira.
      continue;
    }
  }

  entradas.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.nome.localeCompare(b.nome);
  });

  return { path: caminho, entradas };
}

/** `os.homedir()` do processo do runner — ponto de partida da navegação. */
export function diretorioInicial(): string {
  return homedir();
}

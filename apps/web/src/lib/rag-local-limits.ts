/**
 * Tetos do upload de "pasta local anexada" (RN-454, ADR 0113), espelhando
 * `apps/api/src/domain/rag/rag-search-limits.ts` — os dois arquivos
 * PRECISAM ficar em sincronia manualmente (não há import cruzado entre
 * `apps/web` e `apps/api`, e `packages/shared` é só tipo por invariante
 * travado). O cliente pré-filtra com estes números para dar feedback ANTES
 * do upload, mas quem garante de verdade é o servidor — este arquivo é
 * conveniência de UX, nunca a fonte da verdade do teto.
 */

export const RAG_LOCAL_FILE_COUNT_LIMIT = 500;
export const RAG_LOCAL_FILE_BYTES_LIMIT = 512 * 1024;
export const RAG_LOCAL_TOTAL_BYTES_LIMIT = 8 * 1024 * 1024;

export const RAG_LOCAL_ALLOWED_EXTENSIONS = [
  '.md',
  '.mdx',
  '.txt',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.ex',
  '.exs',
  '.sql',
  '.sh',
  '.css',
  '.html',
  '.xml',
  '.toml',
  '.ini',
  '.env',
] as const;

export function extensaoAceita(path: string): boolean {
  const ponto = path.lastIndexOf('.');
  const barra = path.lastIndexOf('/');
  if (ponto === -1 || ponto < barra) return false;
  const extensao = path.slice(ponto).toLowerCase();
  return (RAG_LOCAL_ALLOWED_EXTENSIONS as readonly string[]).includes(extensao);
}

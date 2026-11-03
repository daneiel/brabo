import { useSyncExternalStore } from 'react';
import { uploadAttachment } from './api-client';

/** Tetos de AT-715; a api é quem decide, isto só poupa a ida (RN-986). */
export const MAX_ANEXOS = 4;
const TETO_IMAGEM = 5 * 1024 * 1024;
const TETO_TEXTO = 512 * 1024;
const IMAGENS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const EXT_TEXTO = /\.(txt|md|json|ya?ml|csv|log|xml|toml|ini|sql|sh|html?|css|[cm]?[jt]sx?|py|rb|go|rs|java|kt|ex|exs|c|h|cpp|hpp|cs|php|swift)$/i;

export type AnexoPendente = {
  chave: string;
  nome: string;
  tamanho: number;
  imagem: boolean;
  /** `data:` completo: serve de miniatura (a CSP não permite `blob:`) e de fonte do base64. */
  dataUrl: string;
};
type Estado = { itens: AnexoPendente[]; erro: string | null };
export type ErroDeAnexo = 'tipo' | 'tamanho' | 'maximo' | 'leitura';

export const formatarTamanho = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

const VAZIO: Estado = { itens: [], erro: null };
const estados = new Map<string, Estado>();
const ouvintes = new Set<() => void>();
const ler = (sessionId: string) => estados.get(sessionId) ?? VAZIO;
function gravar(sessionId: string, e: Estado) {
  estados.set(sessionId, e);
  ouvintes.forEach((o) => o());
}

export function useAnexosPendentes(sessionId: string): Estado {
  return useSyncExternalStore(
    (o) => {
      ouvintes.add(o);
      return () => ouvintes.delete(o);
    },
    () => ler(sessionId),
  );
}

const lerComoDataUrl = (f: File) =>
  new Promise<string>((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => falha(r.error);
    r.readAsDataURL(f);
  });

/** Valida no cliente; devolve o código da recusa ou null. */
export function recusaDoArquivo(f: File, quantosJa: number): ErroDeAnexo | null {
  if (quantosJa >= MAX_ANEXOS) return 'maximo';
  const imagem = IMAGENS.includes(f.type);
  if (!imagem && !(f.type.startsWith('text/') || EXT_TEXTO.test(f.name))) return 'tipo';
  if (f.size > (imagem ? TETO_IMAGEM : TETO_TEXTO)) return 'tamanho';
  return null;
}

/** Adiciona arquivos; a primeira recusa vira `erro` (código, a tela traduz) e os válidos ficam. */
export async function adicionarAnexos(sessionId: string, arquivos: File[]) {
  let itens = ler(sessionId).itens;
  let erro: string | null = null;
  for (const f of arquivos) {
    const r = recusaDoArquivo(f, itens.length);
    if (r) {
      erro ??= r;
      continue;
    }
    try {
      itens = [
        ...itens,
        {
          chave: crypto.randomUUID(),
          nome: f.name || 'imagem',
          tamanho: f.size,
          imagem: IMAGENS.includes(f.type),
          dataUrl: await lerComoDataUrl(f),
        },
      ];
    } catch {
      erro ??= 'leitura';
    }
  }
  gravar(sessionId, { itens, erro });
}

export const removerAnexo = (sessionId: string, chave: string) =>
  gravar(sessionId, { itens: ler(sessionId).itens.filter((i) => i.chave !== chave), erro: null });

/**
 * Sobe os pendentes e devolve os ids (vazio sem anexos). Falha de upload grava
 * `erro` e LANÇA, para a mensagem não sair. Só limpa quando tudo subiu.
 */
export async function subirAnexosPendentes(projectId: string, sessionId: string): Promise<string[]> {
  const { itens } = ler(sessionId);
  if (itens.length === 0) return [];
  try {
    const ids: string[] = [];
    for (const i of itens) {
      const r = await uploadAttachment(projectId, sessionId, i.nome, i.dataUrl.slice(i.dataUrl.indexOf(',') + 1));
      ids.push(r.id);
    }
    gravar(sessionId, VAZIO);
    return ids;
  } catch (e) {
    gravar(sessionId, { itens, erro: 'upload' });
    throw e;
  }
}

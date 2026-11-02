import { useEffect, useSyncExternalStore } from 'react';

/**
 * RN-843 (AT-512): registro leve das ações que o bloco de pendências do chat
 * (`PendenciasDeOutrasSessoes`) está DESENHANDO como `ApprovalCard` agora.
 * O fio da sessão o lê para não desenhar um segundo cartão de decisão para a
 * MESMA ação: enquanto ela estiver pendente e no bloco, o fio mostra só uma
 * linha que aponta para lá. Contagem por id (mais de um bloco montado não
 * apaga o registro do outro ao desmontar).
 */
const contagem = new Map<string, number>();
const ouvintes = new Set<() => void>();
let versao = 0;

function avisar() {
  versao += 1;
  for (const ouvinte of ouvintes) ouvinte();
}

export function registrarAcoesNoBloco(ids: readonly string[]): () => void {
  for (const id of ids) contagem.set(id, (contagem.get(id) ?? 0) + 1);
  if (ids.length > 0) avisar();
  return () => {
    for (const id of ids) {
      const n = (contagem.get(id) ?? 1) - 1;
      if (n <= 0) contagem.delete(id);
      else contagem.set(id, n);
    }
    if (ids.length > 0) avisar();
  };
}

export function acaoEstaNoBloco(id: string): boolean {
  return contagem.has(id);
}

function assinar(ouvinte: () => void) {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

/** Registra, enquanto o componente estiver montado, os ids desenhados. */
export function useRegistrarAcoesNoBloco(ids: readonly string[]): void {
  const chave = [...ids].sort().join('|');
  useEffect(() => registrarAcoesNoBloco(chave ? chave.split('|') : []), [chave]);
}

export function useAcaoEstaNoBloco(id: string): boolean {
  useSyncExternalStore(assinar, () => versao, () => versao);
  return acaoEstaNoBloco(id);
}

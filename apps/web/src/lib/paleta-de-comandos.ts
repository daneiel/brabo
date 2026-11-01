import type { Project, ProjectCardSummary, Session } from './api-types';

export type GrupoDaPaleta = 'projetos' | 'abas' | 'sessoes' | 'acoes';

export type DestinoDaPaleta =
  | { tipo: 'projeto'; projectId: string }
  | { tipo: 'aba'; projectId: string; chave: string }
  | { tipo: 'sessao'; projectId: string; sessionId: string }
  | { tipo: 'rota'; to: '/spend' | '/containers' | '/providers' | '/account' }
  | { tipo: 'novo-projeto' }
  | { tipo: 'tema' }
  | { tipo: 'sair' };

export interface ItemDaPaleta {
  id: string;
  grupo: GrupoDaPaleta;
  rotulo: string;
  destino: DestinoDaPaleta;
}

export interface EntradaDaPaleta {
  projetos: readonly Project[];
  resumo: readonly ProjectCardSummary[];
  /** Sessões do projeto aberto LIDAS do cache (nunca buscadas); `undefined` = sem cache. */
  sessoesEmCache: readonly Session[] | undefined;
  projetoAbertoId: string | undefined;
  abas: readonly { key: string; label: string }[];
  acoes: readonly { destino: DestinoDaPaleta; rotulo: string }[];
  rotuloSessao: (nome: string | null, id: string) => string;
}

/** RN-971: tudo sai de dado que o Shell já tem ou do cache; nada é buscado aqui. */
export function itensDaPaleta(e: EntradaDaPaleta): ItemDaPaleta[] {
  const nomeDe = new Map(e.projetos.map((p) => [p.id, p.name]));
  const itens: ItemDaPaleta[] = e.projetos.map((p) => ({
    id: `p:${p.id}`,
    grupo: 'projetos',
    rotulo: p.name,
    destino: { tipo: 'projeto', projectId: p.id },
  }));
  const aberto = e.projetoAbertoId;
  if (aberto) {
    for (const a of e.abas)
      itens.push({
        id: `a:${a.key}`,
        grupo: 'abas',
        rotulo: a.label,
        destino: { tipo: 'aba', projectId: aberto, chave: a.key },
      });
  }
  const vistas = new Set<string>();
  const sessao = (projectId: string, sessionId: string, nome: string | null) => {
    if (vistas.has(sessionId)) return;
    vistas.add(sessionId);
    itens.push({
      id: `s:${sessionId}`,
      grupo: 'sessoes',
      rotulo: `${nomeDe.get(projectId) ?? ''} · ${e.rotuloSessao(nome, sessionId)}`,
      destino: { tipo: 'sessao', projectId, sessionId },
    });
  };
  for (const s of e.sessoesEmCache ?? []) sessao(s.projectId, s.id, s.name);
  for (const c of e.resumo) if (c.latestSessionId) sessao(c.projectId, c.latestSessionId, null);
  for (const a of e.acoes)
    itens.push({ id: `x:${a.destino.tipo}`, grupo: 'acoes', rotulo: a.rotulo, destino: a.destino });
  return itens;
}

/** Ctrl+K / ⌘K, fora do xterm, sem IME e sem handler anterior (RN-971, RN-830). */
export function deveAbrirPaleta(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing) return false;
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return false;
  const alvo = e.target as Element | null;
  return !(alvo && typeof alvo.closest === 'function' && alvo.closest('.xterm'));
}

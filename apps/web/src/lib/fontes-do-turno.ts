/* AT-716: lê `fontes` do payload de `agent.response`. Antigo/malformado => []. */
export const TIPOS_DE_FONTE = ['rag', 'arquivo', 'historia', 'regra', 'adr', 'backlog', 'metricas', 'contratos'] as const;
export type FonteDoTurno = {
  tipo: (typeof TIPOS_DE_FONTE)[number];
  rotulo: string;
  ref?: string;
  searchId?: string;
  chunkId?: string;
};

export function fontesDoTurno(payload: unknown): { fontes: FonteDoTurno[]; total: number } {
  const p = (payload ?? {}) as { fontes?: unknown; fontesTotal?: unknown };
  if (!Array.isArray(p.fontes)) return { fontes: [], total: 0 };
  const fontes = p.fontes.filter(
    (f): f is FonteDoTurno =>
      !!f &&
      typeof f === 'object' &&
      (TIPOS_DE_FONTE as readonly unknown[]).includes((f as FonteDoTurno).tipo) &&
      typeof (f as FonteDoTurno).rotulo === 'string' &&
      (f as FonteDoTurno).rotulo !== '',
  );
  const total =
    typeof p.fontesTotal === 'number' && p.fontesTotal > fontes.length ? p.fontesTotal : fontes.length;
  return { fontes, total };
}

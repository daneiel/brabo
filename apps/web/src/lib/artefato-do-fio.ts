/**
 * O que o cartão de artefato do fio mostra (RN-977), por tipo, lendo os campos
 * REAIS do payload: `decision_record` (`choice`, `context`), `module_map`
 * (`modules[].name`), `c4_diagram` (`systemName`, `systemDescription`),
 * `project_image` (`image`, `rationale`) e os pareceres (`veredito`,
 * `resumo`). Campo ausente vira `undefined`: o cartão cai no rótulo do tipo.
 */
const txt = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
const corta = (s?: string) => (s && s.length > 200 ? `${s.slice(0, 200)}…` : s);

export function camposDoArtefato(
  tipo: string,
  payload: unknown,
): { titulo?: string; descricao?: string; veredito?: string } {
  const p = (payload ?? {}) as Record<string, unknown>;
  switch (tipo) {
    case 'artifact.decision_record':
      return { titulo: txt(p.choice), descricao: corta(txt(p.context)) };
    case 'artifact.module_map': {
      const nomes = Array.isArray(p.modules)
        ? p.modules.map((m) => txt((m as { name?: unknown } | null)?.name)).filter(Boolean)
        : [];
      return { descricao: corta(nomes.join(', ') || undefined) };
    }
    case 'artifact.c4_diagram':
      return { titulo: txt(p.systemName), descricao: corta(txt(p.systemDescription)) };
    case 'artifact.project_image':
      return { titulo: txt(p.image), descricao: corta(txt(p.rationale)) };
    default:
      return { veredito: txt(p.veredito), descricao: corta(txt(p.resumo)) };
  }
}

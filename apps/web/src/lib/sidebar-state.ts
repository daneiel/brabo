/**
 * Persistência da sidebar (PROGRAMA 28, Onda 2 — RN-195..201).
 *
 * As SEIS chaves do `localStorage` do shell de navegação, no formato exato do
 * handoff (`design_handoff_brabo/README.md`, seção "Navigation shell", e
 * `CHECKLIST-CONFRONTO.md`, seção 1). Centralizadas aqui em vez de espalhadas
 * pelo componente — o mesmo motivo de `read-state.ts` e `tema.ts` existirem:
 * cada `localStorage.getItem` solto é um contrato implícito que ninguém revê.
 *
 * `brabo:last-seen-seq:*` (`read-state.ts`) é OUTRO domínio — não confundir:
 * aquelas chaves marcam até onde o usuário já VIU o event log; estas marcam a
 * FORMA da sidebar (colapsada, quem está aberto, qual projeto/aba é a
 * corrente). Nenhuma lança: preferência de UI não deve derrubar a tela por
 * causa de um `localStorage` bloqueado (modo privado, storage de iframe).
 */

export const CHAVE_COLAPSADO = 'brabo.sidebar.collapsed';
export const CHAVE_PROJETOS_ABERTOS = 'brabo.sidebar.open';
export const CHAVE_AGENTES_ABERTOS = 'brabo.sidebar.agents';
export const CHAVE_PROJETO_ATIVO = 'brabo.project';
export const CHAVE_ABA_ATIVA = 'brabo.tab';

function lerString(chave: string): string | null {
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravarString(chave: string, valor: string): void {
  try {
    window.localStorage.setItem(chave, valor);
  } catch {
    // Sem persistência: a escolha vale para esta aba e se perde no reload —
    // mesmo trade-off documentado em `tema.ts`.
  }
}

function lerConjunto(chave: string): Set<string> {
  const bruto = lerString(chave);
  if (!bruto) return new Set();
  try {
    const valor: unknown = JSON.parse(bruto);
    if (!Array.isArray(valor)) return new Set();
    return new Set(valor.filter((v): v is string => typeof v === 'string'));
  } catch {
    // JSON corrompido (edição manual, versão antiga do formato) — degrada
    // para "nada aberto" em vez de derrubar a sidebar.
    return new Set();
  }
}

function gravarConjunto(chave: string, ids: Set<string>): void {
  gravarString(chave, JSON.stringify([...ids]));
}

/** `brabo.sidebar.collapsed` — preferência de colapso do usuário (RN-195). */
export function lerColapsado(): boolean {
  return lerString(CHAVE_COLAPSADO) === '1';
}

export function gravarColapsado(colapsado: boolean): void {
  gravarString(CHAVE_COLAPSADO, colapsado ? '1' : '0');
}

/** `brabo.sidebar.open` — ids dos projetos expandidos (RN-196). */
export function lerProjetosAbertos(): Set<string> {
  return lerConjunto(CHAVE_PROJETOS_ABERTOS);
}

export function gravarProjetosAbertos(ids: Set<string>): void {
  gravarConjunto(CHAVE_PROJETOS_ABERTOS, ids);
}

/**
 * `brabo.sidebar.agents` — ids de agentes/instâncias expandidos (RN-198).
 *
 * O handoff ilustra o formato com `'dev'`/`'dev/dev-01'`; os ids reais do
 * produto são `dev-backend`/`dev-backend-2` (ver `agruparPorInstancia` em
 * `timeline-tree.ts`), então uma entrada é `agenteBase` (grupo aberto) ou
 * `${agenteBase}/${instancia}` (uma instância específica aberta dentro do
 * grupo) — mesma barra, ids adaptados.
 */
export function lerAgentesAbertos(): Set<string> {
  return lerConjunto(CHAVE_AGENTES_ABERTOS);
}

export function gravarAgentesAbertos(ids: Set<string>): void {
  gravarConjunto(CHAVE_AGENTES_ABERTOS, ids);
}

/** `brabo.project` — o projeto ativo (RN-201). */
export function lerProjetoAtivo(): string | null {
  return lerString(CHAVE_PROJETO_ATIVO);
}

export function gravarProjetoAtivo(projectId: string): void {
  gravarString(CHAVE_PROJETO_ATIVO, projectId);
}

/**
 * `brabo.tab` — a aba de projeto ativa, persistindo entre páginas (RN-201).
 *
 * `?tab=` na URL só vale como deep-link INICIAL (`project-tabs.ts`, FASE 24)
 * — trocar de aba depois não escreve na URL, então esta chave é o único
 * jeito de "lembrar" a aba entre uma sessão de navegação e outra. Gravada só
 * quando o usuário clica um link de aba NA SIDEBAR (`Shell.tsx`); a troca de
 * aba dentro de `ProjectPage.tsx` (estado local, `Tabs`) não escreve aqui —
 * esse arquivo é da FRENTE C e não é tocado por esta onda.
 */
export function lerAbaAtiva(): string | null {
  return lerString(CHAVE_ABA_ATIVA);
}

export function gravarAbaAtiva(chave: string): void {
  gravarString(CHAVE_ABA_ATIVA, chave);
}

/**
 * Cor de IDENTIDADE do projeto — estável por id, usada na trilha recolhida
 * (borda do quadrado de iniciais, handoff seção "Navigation shell").
 *
 * `Project` não tem campo `color` no domínio (`api-types.ts`): hash
 * determinístico do id sobre uma paleta fixa de tokens, mesma ideia de
 * `AGENTS[key].color` só que sem tabela. NÃO é o dot de status
 * (`NavStatusDot`/`project-status.ts`, que muda com orçamento/atividade) —
 * é identidade, e por isso nunca muda para o mesmo projeto.
 */
const PALETA_IDENTIDADE_PROJETO = [
  'var(--accent)',
  'var(--success)',
  'var(--warning)',
  'var(--violet)',
  'var(--danger)',
  'var(--text-secondary)',
] as const;

export function corDoProjeto(projectId: string): string {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash * 31 + projectId.charCodeAt(i)) | 0;
  }
  const indice = Math.abs(hash) % PALETA_IDENTIDADE_PROJETO.length;
  return PALETA_IDENTIDADE_PROJETO[indice];
}

/*
 * O auto-colapso da aba de Código SAIU daqui (ADR 0126).
 *
 * `AutoCollapseContext`/`useAutoCollapseSidebar` existiam para a aba de
 * Código montar a sidebar recolhida sem gravar preferência. Com o trilho
 * vertical do projeto (`routes/ProjectRail.tsx`) sempre presente, manter isso
 * poria a trilha de ícones do Shell (62px) encostada no trilho do projeto —
 * dois trilhos verticais adjacentes, permanentes, na aba mais pesada. O
 * colapso passa a ser só o MANUAL, do usuário, e esse continua persistido em
 * `brabo.sidebar.collapsed`: o que se removeu foi a decisão do SISTEMA, não a
 * do usuário. A RN-201 registra o custo aceito.
 */

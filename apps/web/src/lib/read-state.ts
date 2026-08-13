const KEY_PREFIX = 'brabo:last-seen-seq:';

// Marca até qual seq o usuário já viu em cada projeto — puramente local
// (sem endpoint de "marcar como lido" no backend). Usado pra derivar
// badges de não-lidos e o sino de notificações a partir do polling do
// event log (nextSeq da sessão - 1 = seq mais recente).
export function getLastSeenSeq(projectId: string): number {
  const raw = localStorage.getItem(KEY_PREFIX + projectId);
  return raw ? Number(raw) : 0;
}

export function setLastSeenSeq(projectId: string, seq: number): void {
  localStorage.setItem(KEY_PREFIX + projectId, String(seq));
}

const AGENT_KEY_PREFIX = 'brabo:last-seen-seq:agent:';

// Mesma mecânica acima, granular por AGENTE dentro do projeto — usado pelo
// contador de novidade de cada ramo da árvore do time (AgentTimelineTree).
// O "visto" do projeto inteiro (acima) não serve aqui: um ramo colapsado
// pode ter marcos novos mesmo com a sessão inteira já vista pelo sino.
export function getAgentLastSeenSeq(projectId: string, agentId: string): number {
  const raw = localStorage.getItem(AGENT_KEY_PREFIX + projectId + ':' + agentId);
  return raw ? Number(raw) : 0;
}

export function setAgentLastSeenSeq(projectId: string, agentId: string, seq: number): void {
  localStorage.setItem(AGENT_KEY_PREFIX + projectId + ':' + agentId, String(seq));
}

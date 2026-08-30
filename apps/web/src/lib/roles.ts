import type { Role } from './api-types';

// Hierarquia linear: viewer < developer < maintainer < owner. Papel efetivo
// nunca é rebaixado — ver RN da cascata de papéis no backend.
export const ROLE_ORDER: Role[] = ['viewer', 'developer', 'maintainer', 'owner'];

// Sem tradução pt-BR de propósito: são os nomes reais do RBAC, e traduzir
// desalinharia rótulo exibido de valor que a api de fato aceita/devolve.
export const ROLE_LABEL: Record<Role, string> = {
  viewer: 'viewer',
  developer: 'developer',
  maintainer: 'maintainer',
  owner: 'owner',
};

/**
 * O papel alcança o mínimo que uma ação exige? — a comparação que faltava
 * neste módulo e que cada tela vinha refazendo à mão como `role === 'owner' ||
 * role === 'maintainer'`.
 *
 * Escrever a hierarquia à mão em cada chamador funciona por acidente enquanto
 * o mínimo é `maintainer` (dois papéis acima, dois abaixo) e passa a errar
 * silenciosamente em qualquer outro: o mínimo `developer` escrito assim tem
 * TRÊS papéis para lembrar, e esquecer um tranca alguém fora de uma ação que a
 * api aceita. `ROLE_ORDER` já é a hierarquia; faltava usá-la.
 *
 * MESMO nome da função do backend (`roleAtLeast`, em
 * `apps/api/src/domain/iam/role.ts`) de propósito, e não uma tradução: as duas
 * são a mesma regra nos dois lados do fio, e um `grep roleAtLeast` no monorepo
 * tem de encontrar as duas de uma vez. Como o `ROLE_LABEL` acima, o vocabulário
 * do RBAC não se traduz.
 *
 * Isto NÃO é fronteira de segurança — quem recusa é o `RolesGuard`, e continua
 * recusando. É a tela parando de oferecer o que a api vai negar.
 *
 * Papel AUSENTE (`undefined`: consulta ainda em voo, ou que falhou) nunca
 * alcança nada. Errar para o lado de desabilitar é reparável por quem recarrega;
 * errar para o lado de habilitar faz a tela prometer uma ação que termina em
 * 403 — o defeito que este helper existe para fechar.
 */
export function roleAtLeast(
  papel: Role | null | undefined,
  minimo: Role,
): boolean {
  if (!papel) return false;
  return ROLE_ORDER.indexOf(papel) >= ROLE_ORDER.indexOf(minimo);
}

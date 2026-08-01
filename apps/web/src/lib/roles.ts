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

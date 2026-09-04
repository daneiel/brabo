import { createContext, useContext } from 'react';
import type { ChaveDeSecao } from './sumario';

/**
 * A seção que o deep-link `?section=` pediu, de `router.tsx` até dentro da aba
 * Configurações.
 *
 * Por que CONTEXTO e não um prop: o registro de abas
 * (`routes/project-tabs.ts`) declara `component: ComponentType<{ projectId:
 * string }>` — "toda aba recebe o mesmo e único prop" —, e essa uniformidade é
 * o que tirou de `ProjectPage.tsx` a cadeia de `&&` que sabia de cada aba em
 * particular. Alargar o prop para carregar um parâmetro que SÓ Configurações
 * lê faria a moldura voltar a passar dado específico de uma aba para as doze.
 *
 * O default é `undefined`, e é ele que os testes que montam
 * `ProjectSettingsTab` sem router usam — sem provedor, a aba abre no topo.
 */
export const ContextoDeSecaoInicial = createContext<ChaveDeSecao | undefined>(undefined);

export function useSecaoInicial(): ChaveDeSecao | undefined {
  return useContext(ContextoDeSecaoInicial);
}

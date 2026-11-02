import { createContext, useContext } from 'react';

/**
 * RN-884 (AT-538): a história a que o deep-link `?historia=` aponta — o
 * "Corrigir a história" do cartão da pergunta respondida leva à aba Histórias
 * com ela aberta. Chega por CONTEXTO, como a seção inicial de Configurações
 * (`settings/secao-inicial.ts`), e não por prop do painel.
 */
export const ContextoDeHistoriaInicial = createContext<string | undefined>(undefined);

export function useHistoriaInicial(): string | undefined {
  return useContext(ContextoDeHistoriaInicial);
}

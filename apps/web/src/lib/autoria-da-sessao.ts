import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listProjectMembers } from './api-client';
import { emailDaSessao, userIdDaSessao } from './auth';
import { FRESCOR_DA_CONFIGURACAO_MS } from './query-policy';
import type { ContextoDeAutoria } from './autor-da-mensagem';

/**
 * O contexto de autoria do fio da sessão (RN-652): quem vê (id e e-mail do
 * access token) e os membros do projeto.
 *
 * Os membros vêm da rota que JÁ existe, `GET projects/:id/members` (mínimo
 * `viewer`, o mesmo de abrir a sessão), sob a MESMA `queryKey` da aba de
 * Configurações (`['members', projectId]`) — o react-query reaproveita a
 * leitura. Falhar ou ainda não ter chegado não quebra o fio: a pessoa que a
 * tela não sabe nomear vira "outro membro", nunca "você".
 */
export function useAutoriaDaSessao(projectId: string): ContextoDeAutoria {
  const { data: membros } = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => listProjectMembers(projectId),
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });
  const meuId = userIdDaSessao();
  const meuEmail = emailDaSessao();
  return useMemo(() => ({ meuId, meuEmail, membros }), [meuId, meuEmail, membros]);
}

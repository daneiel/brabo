import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProject, listProjectMembers, listWorkspaceMembers } from './api-client';
import { emailDaSessao, userIdDaSessao } from './auth';
import { FRESCOR_DA_CONFIGURACAO_MS } from './query-policy';
import type { ContextoDeAutoria, MembroNomeavel } from './autor-da-mensagem';

/**
 * As duas listas de membros numa só, a de PROJETO antes da de WORKSPACE
 * (AT-335, RN-652). A ordem é a regra: quem tem as duas linhas aparece uma
 * vez, pela de projeto — a mesma que a sobreposição de papel usa (RN-471). O
 * nome e o e-mail são da CONTA, então as duas linhas dizem o mesmo; o que a
 * ordem decide é só qual das duas se lê.
 *
 * `undefined` só quando NENHUMA chegou: uma leitura que falha não apaga a
 * outra, e a pessoa que só a que falhou saberia nomear vira "outro membro".
 */
export function comporMembros(
  doProjeto: readonly MembroNomeavel[] | undefined,
  doWorkspace: readonly MembroNomeavel[] | undefined,
): MembroNomeavel[] | undefined {
  if (doProjeto === undefined && doWorkspace === undefined) return undefined;
  const vistos = new Set<string>();
  const composta: MembroNomeavel[] = [];
  for (const membro of [...(doProjeto ?? []), ...(doWorkspace ?? [])]) {
    if (vistos.has(membro.userId)) continue;
    vistos.add(membro.userId);
    composta.push(membro);
  }
  return composta;
}

/**
 * O contexto de autoria do fio da sessão (RN-652): quem vê (id e e-mail do
 * access token) e os membros que a tela sabe nomear.
 *
 * Duas leituras, as duas `viewer`, o mesmo mínimo de abrir a sessão:
 * `GET projects/:id/members`, sob a MESMA `queryKey` da aba de Configurações
 * (`['members', projectId]`), e desde a AT-335 `GET workspaces/:id/members`,
 * do workspace DO PROJETO (lido da mesma `['project', projectId]` que a página
 * já carrega) — quem entra no projeto só pelo papel de workspace não tem
 * linha na primeira. Falhar ou ainda não ter chegado não quebra o fio: a
 * pessoa que a tela não sabe nomear vira "outro membro", nunca "você".
 */
export function useAutoriaDaSessao(projectId: string): ContextoDeAutoria {
  const { data: doProjeto } = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => listProjectMembers(projectId),
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });
  const { data: projeto } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  const workspaceId = projeto?.workspaceId;
  const { data: doWorkspace } = useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: () => listWorkspaceMembers(workspaceId!),
    enabled: !!workspaceId,
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });
  const meuId = userIdDaSessao();
  const meuEmail = emailDaSessao();
  const membros = useMemo(() => comporMembros(doProjeto, doWorkspace), [doProjeto, doWorkspace]);
  return useMemo(() => ({ meuId, meuEmail, membros }), [meuId, meuEmail, membros]);
}

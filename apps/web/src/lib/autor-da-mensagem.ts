import type { Actor, ProjectMemberWithUser, WorkspaceMemberWithUser } from './api-types';

/**
 * Uma linha que a tela sabe nomear — de projeto ou de workspace: as duas têm
 * id, nome, e-mail e papel (AT-335).
 */
export type MembroNomeavel = ProjectMemberWithUser | WorkspaceMemberWithUser;

/**
 * Quem ESCREVEU uma mensagem do fio da sessão (RN-652, AT-329).
 *
 * Até aqui todo `chat.message` era desenhado com o nome e o avatar de quem VÊ
 * a tela: numa sessão compartilhada, a fala de outra pessoa aparecia com o
 * SEU nome, e a de um agente com o seu e-mail. O autor sai do `actor` do
 * EVENTO — a única fonte que diz quem falou —, nunca de quem está logado.
 *
 * Os cinco desfechos não se colapsam (a régua da RN-470):
 * - `voce` — o ator é quem vê; o nome vem da linha de membro, senão do e-mail
 *   da sessão, e só na falta dos dois cai no rótulo "Você";
 * - `membro` — outra pessoa que a tela sabe nomear (nome, senão e-mail);
 * - `outroMembro` — outra pessoa que a tela NÃO sabe nomear: nem linha de
 *   projeto nem de workspace (`GET projects/:id/members` e, desde a AT-335,
 *   `GET workspaces/:id/members`, as duas `viewer`), ou as duas leituras ainda
 *   não chegaram ou falharam;
 * - `agente` — o id é o do agente, e o nome sai de `nomeDoAgente`;
 * - `desconhecido` — ator ausente, sem id, ou de espécie que não é pessoa nem
 *   agente. Tem texto PRÓPRIO e NUNCA vira "você".
 */
export type AutorDaMensagem =
  | { tipo: 'voce'; nome: string | null }
  | { tipo: 'membro'; nome: string }
  | { tipo: 'outroMembro' }
  | { tipo: 'agente'; id: string }
  | { tipo: 'desconhecido' };

export interface ContextoDeAutoria {
  /** `sub` do access token — `null` quando não decodifica. */
  meuId: string | null;
  /** E-mail do access token — `null` quando não decodifica. */
  meuEmail: string | null;
  /**
   * Os membros que a tela sabe nomear — os do projeto antes dos do workspace
   * (`comporMembros`, AT-335); `undefined` enquanto nenhuma leitura chegou.
   */
  membros: readonly MembroNomeavel[] | undefined;
}

function nomeDoMembro(m: MembroNomeavel): string {
  return m.name && m.name.trim() !== '' ? m.name : m.email;
}

export function autorDaMensagem(
  actor: Actor | null | undefined,
  ctx: ContextoDeAutoria,
): AutorDaMensagem {
  const id = typeof actor?.id === 'string' ? actor.id : '';
  if (!actor || id === '') return { tipo: 'desconhecido' };

  if (actor.kind === 'agent') return { tipo: 'agente', id };
  if (actor.kind !== 'user') return { tipo: 'desconhecido' };

  const membro = ctx.membros?.find((m) => m.userId === id);
  // "Sou eu" pelo id do token; sem ele, pelo e-mail da linha de membro — o
  // e-mail é único por usuário, então casar os dois não confunde ninguém.
  const souEu =
    (ctx.meuId !== null && id === ctx.meuId) ||
    (ctx.meuId === null && !!membro && !!ctx.meuEmail && membro.email === ctx.meuEmail);
  if (souEu) return { tipo: 'voce', nome: membro ? nomeDoMembro(membro) : ctx.meuEmail };

  if (membro) return { tipo: 'membro', nome: nomeDoMembro(membro) };
  return { tipo: 'outroMembro' };
}

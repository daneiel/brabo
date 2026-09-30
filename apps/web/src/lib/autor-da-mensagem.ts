import type { Actor, ProjectMemberWithUser } from './api-types';

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
 * - `outroMembro` — outra pessoa que a tela NÃO sabe nomear. É LACUNA
 *   declarada: a tela só alcança `project_members` (`GET
 *   projects/:id/members`, mínimo `viewer`), e quem entra no projeto só pelo
 *   papel de WORKSPACE não tem linha ali — não há rota de leitura de membros
 *   de workspace, e nenhuma foi inventada para isto;
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
  /** `project_members` do projeto; `undefined` enquanto não chegou (ou falhou). */
  membros: ProjectMemberWithUser[] | undefined;
}

function nomeDoMembro(m: ProjectMemberWithUser): string {
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

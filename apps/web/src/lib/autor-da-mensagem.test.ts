import { describe, expect, it } from 'vitest';
import { autorDaMensagem, type ContextoDeAutoria } from './autor-da-mensagem';
import type { ProjectMemberWithUser } from './api-types';

// RN-652 (AT-329): o autor sai do ATOR do evento, nunca de quem vê.
const membros: ProjectMemberWithUser[] = [
  { userId: 'eu', role: 'owner', name: null, email: 'eu@brabo.dev' },
  { userId: 'ana', role: 'developer', name: 'Ana Souza', email: 'ana@brabo.dev' },
  { userId: 'beto', role: 'viewer', name: null, email: 'beto@brabo.dev' },
];
const ctx: ContextoDeAutoria = { meuId: 'eu', meuEmail: 'eu@brabo.dev', membros };

describe('autorDaMensagem', () => {
  it('quem vê é "voce", com o e-mail da linha de membro', () => {
    expect(autorDaMensagem({ kind: 'user', id: 'eu' }, ctx)).toEqual({
      tipo: 'voce',
      nome: 'eu@brabo.dev',
    });
  });

  it('outra pessoa é nomeada pelo NOME, e sem nome pelo e-mail', () => {
    expect(autorDaMensagem({ kind: 'user', id: 'ana' }, ctx)).toEqual({
      tipo: 'membro',
      nome: 'Ana Souza',
    });
    expect(autorDaMensagem({ kind: 'user', id: 'beto' }, ctx)).toEqual({
      tipo: 'membro',
      nome: 'beto@brabo.dev',
    });
  });

  it('agente é agente, pelo id', () => {
    expect(autorDaMensagem({ kind: 'agent', id: 'po' }, ctx)).toEqual({
      tipo: 'agente',
      id: 'po',
    });
  });

  it('pessoa fora de project_members (só papel de workspace) é "outroMembro", nunca "voce"', () => {
    expect(autorDaMensagem({ kind: 'user', id: 'carla' }, ctx)).toEqual({
      tipo: 'outroMembro',
    });
    // Membros ainda não chegaram (ou a leitura falhou): o mesmo desfecho.
    expect(
      autorDaMensagem({ kind: 'user', id: 'ana' }, { ...ctx, membros: undefined }),
    ).toEqual({ tipo: 'outroMembro' });
  });

  it('sem id no token, reconhece quem vê pelo e-mail da linha de membro', () => {
    expect(
      autorDaMensagem({ kind: 'user', id: 'eu' }, { ...ctx, meuId: null }),
    ).toEqual({ tipo: 'voce', nome: 'eu@brabo.dev' });
    expect(
      autorDaMensagem({ kind: 'user', id: 'ana' }, { ...ctx, meuId: null }),
    ).toEqual({ tipo: 'membro', nome: 'Ana Souza' });
  });

  it('falha: ator ausente, sem id ou de espécie desconhecida é "desconhecido", nunca "voce"', () => {
    expect(autorDaMensagem(undefined, ctx)).toEqual({ tipo: 'desconhecido' });
    expect(autorDaMensagem({ kind: 'user', id: '' }, ctx)).toEqual({ tipo: 'desconhecido' });
    expect(autorDaMensagem({ kind: 'system', id: 'system' }, ctx)).toEqual({
      tipo: 'desconhecido',
    });
    expect(
      autorDaMensagem({ kind: 'robo' as never, id: 'eu' }, ctx),
    ).toEqual({ tipo: 'desconhecido' });
  });
});

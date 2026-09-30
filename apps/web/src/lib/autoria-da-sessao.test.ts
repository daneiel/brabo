import { describe, expect, it } from 'vitest';
import { comporMembros } from './autoria-da-sessao';
import type { ProjectMemberWithUser, WorkspaceMemberWithUser } from './api-types';

// AT-335 (RN-652): as duas listas numa só, a de PROJETO antes da de WORKSPACE.
const doProjeto: ProjectMemberWithUser[] = [
  { userId: 'ana', role: 'viewer', name: 'Ana Souza', email: 'ana@brabo.dev' },
];
const doWorkspace: WorkspaceMemberWithUser[] = [
  { userId: 'ana', role: 'owner', name: 'Ana Souza', email: 'ana@brabo.dev' },
  { userId: 'carla', role: 'developer', name: 'Carla Lima', email: 'carla@brabo.dev' },
];

describe('comporMembros', () => {
  it('a linha de projeto vem antes e ganha de a de workspace; quem só tem a de workspace entra', () => {
    expect(comporMembros(doProjeto, doWorkspace)).toEqual([
      { userId: 'ana', role: 'viewer', name: 'Ana Souza', email: 'ana@brabo.dev' },
      { userId: 'carla', role: 'developer', name: 'Carla Lima', email: 'carla@brabo.dev' },
    ]);
  });

  it('falha de UMA leitura não apaga a outra; só as duas ausentes dão `undefined`', () => {
    expect(comporMembros(undefined, doWorkspace)?.map((m) => m.userId)).toEqual(['ana', 'carla']);
    expect(comporMembros(doProjeto, undefined)?.map((m) => m.userId)).toEqual(['ana']);
    expect(comporMembros(undefined, undefined)).toBeUndefined();
  });
});

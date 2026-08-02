import { describe, it, expect } from 'vitest';
import { agruparPlano, divergencias, planoVazio } from './adoption';
import type { BootstrapPlan } from './api-types';

function plano(over: Partial<BootstrapPlan> = {}): BootstrapPlan {
  return { generatedAt: '2026-08-01T23:45:00.000Z', steps: [], diagnostics: [], ...over };
}

describe('agruparPlano', () => {
  it('reagrupa a ordem de execução em branches / proteções / arquivos', () => {
    // O backend manda na ordem em que ACONTECE (commits primeiro, porque
    // createRepo não faz commit inicial); a tela lê por assunto.
    const grupos = agruparPlano(
      plano({
        steps: [
          {
            step: 'commit_pr_template',
            actionType: 'git_commit',
            payload: { path: '.github/pull_request_template.md' },
          },
          {
            step: 'create_dev_branch',
            actionType: 'git_branch_create',
            payload: { branchName: 'dev', fromRef: 'main' },
          },
          {
            step: 'protect_branches',
            actionType: 'git_branch_protect',
            payload: { branchName: 'qa' },
          },
        ],
      }),
    );

    expect(grupos.map((g) => g.secao)).toEqual([
      'branches',
      'protecoes',
      'arquivos',
    ]);
    expect(grupos[0].itens).toEqual(['criar `dev` a partir de `main`']);
    expect(grupos[1].itens).toEqual(['proteger `qa`']);
    expect(grupos[2].itens).toEqual([
      'criar `.github/pull_request_template.md`',
    ]);
  });

  it('seção sem item não aparece — "Proteções (nenhuma)" seria ruído', () => {
    const grupos = agruparPlano(
      plano({
        steps: [
          {
            step: 'create_rc_branch',
            actionType: 'git_branch_create',
            payload: { branchName: 'rc', fromRef: 'qa' },
          },
        ],
      }),
    );

    expect(grupos).toHaveLength(1);
    expect(grupos[0].titulo).toBe('Branches');
  });

  it('plano vazio: nenhum grupo, e planoVazio diz que não há o que aprovar', () => {
    expect(agruparPlano(plano())).toEqual([]);
    expect(planoVazio(plano())).toBe(true);
  });
});

describe('divergencias', () => {
  it('branch fora do template é informativa e diz que não será tocada', () => {
    const linhas = divergencias(
      plano({
        diagnostics: [
          { kind: 'extra_branch', detail: { branchName: 'develop' } },
          { kind: 'missing_branch', detail: { branchName: 'dev' } },
        ],
      }),
    );

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain('develop');
    expect(linhas[0]).toContain('não a toca');
  });

  it('capability ausente vira aviso, não erro', () => {
    const linhas = divergencias(
      plano({
        diagnostics: [
          {
            kind: 'capability_unsupported',
            detail: { step: 'protect_branches', provider: 'local' },
          },
        ],
      }),
    );

    expect(linhas[0]).toContain('protect_branches');
    expect(linhas[0]).toContain('pulado');
  });

  it('o que já virou passo NÃO se repete como divergência', () => {
    // missing_branch/unprotected_branch/missing_file já aparecem nas
    // seções do plano — repeti-los aqui seria dizer duas vezes a mesma
    // coisa com nomes diferentes.
    expect(
      divergencias(
        plano({
          diagnostics: [
            { kind: 'missing_branch', detail: { branchName: 'qa' } },
            { kind: 'unprotected_branch', detail: { branchName: 'main' } },
            { kind: 'missing_file', detail: { path: 'docs/x.md' } },
          ],
        }),
      ),
    ).toEqual([]);
  });
});

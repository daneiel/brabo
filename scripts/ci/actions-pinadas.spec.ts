import { describe, expect, it } from 'vitest';
import { mensagemDeViolacao, verificarPins, type Workflow } from './actions-pinadas.ts';

/**
 * A regra: todo `uses:` de terceiro preso a commit SHA, com a versão num
 * comentário ao lado. Tag é ponteiro mutável; SHA é conteúdo. Referência
 * local (`./`) é código deste repositório e passa.
 */

const wf = (conteudo: string): Workflow[] => [{ nome: 'x.yml', conteudo }];

describe('verificarPins', () => {
  it('aceita action presa a SHA com a versão em comentário', () => {
    const linha = '      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262  # v4';
    expect(verificarPins(wf(linha))).toEqual([]);
  });

  it('aceita SHA em action com subcaminho (`cache/restore`)', () => {
    const linha = '      - uses: actions/cache/restore@0057852bfaa89a56745cba8c7296529d2fc39830  # v4';
    expect(verificarPins(wf(linha))).toEqual([]);
  });

  it('reprova tag — o caso que o #408 deixou em 15 workflows', () => {
    const violacoes = verificarPins(wf('      - uses: actions/checkout@v4'));
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]).toMatchObject({ linha: 1, uses: 'actions/checkout@v4', motivo: 'referência mutável' });
  });

  it('reprova branch, que é ainda mais móvel que tag', () => {
    const violacoes = verificarPins(wf('      - uses: alguem/acao@main'));
    expect(violacoes[0]?.motivo).toBe('referência mutável');
  });

  it('reprova SHA sem comentário: pin que ninguém audita nem o Dependabot atualiza', () => {
    const linha = '      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262';
    const violacoes = verificarPins(wf(linha));
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0]?.motivo).toBe('SHA sem a versão em comentário');
  });

  it('aceita referência local — não há terceiro que possa movê-la', () => {
    expect(verificarPins(wf('      - uses: ./.github/actions/setup'))).toEqual([]);
  });

  it('ignora linha comentada: é prosa SOBRE um uses, não um uses', () => {
    expect(verificarPins(wf('      # antes disto era uses: actions/checkout@v4'))).toEqual([]);
  });

  it('reporta arquivo e linha de cada violação, em ordem', () => {
    const workflows: Workflow[] = [
      { nome: 'a.yml', conteudo: 'jobs:\n      - uses: um/dois@v1\n' },
      { nome: 'b.yml', conteudo: '      - uses: tres/quatro@v2\n' },
    ];
    expect(verificarPins(workflows)).toEqual([
      { arquivo: 'a.yml', linha: 2, uses: 'um/dois@v1', motivo: 'referência mutável' },
      { arquivo: 'b.yml', linha: 1, uses: 'tres/quatro@v2', motivo: 'referência mutável' },
    ]);
  });
});

describe('mensagemDeViolacao', () => {
  it('ensina a resolver a tag em SHA, não só acusa', () => {
    const mensagem = mensagemDeViolacao({
      arquivo: 'release.yml',
      linha: 122,
      uses: 'actions/checkout@v4',
      motivo: 'referência mutável',
    });
    expect(mensagem).toContain('release.yml:122');
    expect(mensagem).toContain('gh api repos/<owner>/<repo>/commits/<tag>');
  });

  it('explica para que serve o comentário de versão', () => {
    const mensagem = mensagemDeViolacao({
      arquivo: 'ci.yml',
      linha: 77,
      uses: 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
      motivo: 'SHA sem a versão em comentário',
    });
    expect(mensagem).toContain('Dependabot');
  });
});

import { describe, expect, it } from 'vitest';
// @ts-expect-error — `changelog.mjs` é JS puro, sem tipos; o que se testa aqui
// é a decisão, e ela é a mesma dos dois lados.
import { blocosDe, fundirComUnreleased } from '../changelog.mjs';

// O defeito que este arquivo existe para não deixar voltar: o corte de versão
// fazia `prepend` da seção gerada e deixava o `## Unreleased` intacto embaixo.
// Como a prosa de cada PR é escrita ali, ela NUNCA chegava à versão publicada
// — cinco seções `## Unreleased` fósseis estavam no arquivo quando isto foi
// medido, cada uma com texto que ninguém mais leria.

const GERADA = `## v9.9.9 — 2026-01-01

### Novidades

- **api**: coisa nova (abc1234)

### Correções

- **web**: conserto (def5678)
`;

const REDIGIDA = `

### Novidades

- **api**: coisa nova, explicada em prosa, com o porquê e o custo declarado.

### Manutenção

- **deps**: bump que só interessa a quem mantém.
`;

describe('changelog — a fusão do Unreleased com a seção gerada', () => {
  it('não perde a prosa redigida', () => {
    const fundida = fundirComUnreleased(GERADA, REDIGIDA);
    expect(fundida).toContain('explicada em prosa');
  });

  it('não perde o inventário gerado dos commits', () => {
    const fundida = fundirComUnreleased(GERADA, REDIGIDA);
    expect(fundida).toContain('(abc1234)');
    expect(fundida).toContain('(def5678)');
  });

  // A ordem é a decisão: quem explica vem antes de quem prova.
  it('põe o redigido antes do gerado, dentro da mesma subseção', () => {
    const fundida = fundirComUnreleased(GERADA, REDIGIDA);
    const novidades = fundida.slice(fundida.indexOf('### Novidades'));
    expect(novidades.indexOf('explicada em prosa')).toBeLessThan(
      novidades.indexOf('(abc1234)'),
    );
  });

  it('mantém uma única subseção por título', () => {
    const fundida = fundirComUnreleased(GERADA, REDIGIDA);
    expect(fundida.match(/^### Novidades$/gm)).toHaveLength(1);
  });

  it('traz subseção que só existe num dos lados', () => {
    const fundida = fundirComUnreleased(GERADA, REDIGIDA);
    expect(fundida).toContain('### Manutenção'); // só no redigido
    expect(fundida).toContain('### Correções'); // só no gerado
  });

  // Unreleased vazio é o caso NORMAL de um release logo depois de outro: a
  // seção gerada tem de sair intacta, e não com um cabeçalho a mais.
  it('devolve a seção gerada intacta quando não há nada redigido', () => {
    expect(fundirComUnreleased(GERADA, '\n\n')).toBe(GERADA);
  });

  it('o cabeçalho da versão é preservado', () => {
    expect(fundirComUnreleased(GERADA, REDIGIDA).split('\n')[0]).toBe(
      '## v9.9.9 — 2026-01-01',
    );
  });

  it('blocosDe separa por título e tira o branco das pontas', () => {
    const blocos = blocosDe(REDIGIDA);
    expect(blocos.map((b: { titulo: string }) => b.titulo)).toEqual([
      'Novidades',
      'Manutenção',
    ]);
    expect(blocos[0].linhas[0].startsWith('- **api**')).toBe(true);
  });
});

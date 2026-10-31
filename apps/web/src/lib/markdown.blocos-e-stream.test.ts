import { describe, expect, it } from 'vitest';
import { fecharMarcadoresAbertos, parseMarkdown } from './markdown';

describe('RN-837 — blocos novos', () => {
  it('`---` vira régua, e `####` é cabeçalho de nível 4', () => {
    expect(parseMarkdown('#### Quatro\n\n---\n\nfim').map((b) => b.type)).toEqual([
      'heading',
      'hr',
      'paragraph',
    ]);
    expect(parseMarkdown('#### Quatro')[0]).toMatchObject({ level: 4 });
  });

  it('`---` logo depois de texto continua texto (não vira régua)', () => {
    expect(parseMarkdown('linha\n---').map((b) => b.type)).toEqual(['paragraph']);
  });

  it('citação agrupa as linhas `>` e reprocessa o miolo', () => {
    const [b] = parseMarkdown('> **nota**\n> - item');
    expect(b.type).toBe('blockquote');
    if (b.type !== 'blockquote') return;
    expect(b.blocks.map((x) => x.type)).toEqual(['paragraph', 'list']);
  });

  it('checklist marca cada item e tira a caixa do texto', () => {
    const [b] = parseMarkdown('- [ ] fazer\n- [x] feito\n- livre');
    expect(b).toMatchObject({
      type: 'list',
      tarefas: [false, true, null],
      items: [[{ kind: 'text', text: 'fazer' }], [{ kind: 'text', text: 'feito' }], [{ kind: 'text', text: 'livre' }]],
    });
  });

  it('item recuado vira sublista do anterior, um nível', () => {
    const [b] = parseMarkdown('- a\n  - a1\n    - a2\n- b');
    expect(b).toMatchObject({ type: 'list', items: [[{ text: 'a' }], [{ text: 'b' }]] });
    if (b.type !== 'list') return;
    expect(b.filhos?.[0]?.items).toHaveLength(2);
    expect(b.filhos?.[1]).toBeNull();
  });

  it('lista sem caixa nem recuo não ganha campos novos', () => {
    expect(parseMarkdown('- a\n- b')[0]).toEqual({
      type: 'list',
      ordered: false,
      items: [[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]],
    });
  });
});

describe('RN-837 — fecharMarcadoresAbertos', () => {
  it('fecha fence, crase e negrito pendentes', () => {
    expect(fecharMarcadoresAbertos('```ts\nconst a')).toBe('```ts\nconst a\n```');
    expect(fecharMarcadoresAbertos('use `npm')).toBe('use `npm`');
    expect(fecharMarcadoresAbertos('isto é **impor')).toBe('isto é **impor**');
    expect(fecharMarcadoresAbertos('isto é **impor*')).toBe('isto é **impor**');
  });

  it('texto completo passa intacto', () => {
    const t = '# T\n\n**a** `b`\n\n```sh\nls\n```';
    expect(fecharMarcadoresAbertos(t)).toBe(t);
  });
});

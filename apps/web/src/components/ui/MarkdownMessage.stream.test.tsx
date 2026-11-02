import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../../lib/i18n';
import { MarkdownMessage } from './MarkdownMessage';

// Respostas no formato do que os agentes produzem (Arquiteto, Dev Lead, PO).
const RESPOSTAS = [
  `## Plano de execução

O módulo **api** depende de \`shared\`. Ordem:

1. Criar o schema em \`db/schema/\`
2. Rodar a **migration**
   - conferir o _barrel_
3. Abrir a PR

> **Atenção:** a PR mira \`dev\`.

---

| Módulo | Recurso |
|---|:-:|
| api | 512 MB |
| web | 256 MB |

Fim.`,
  `### Checklist

- [x] Imagem decidida
- [ ] Container **running**
- [ ] Testes verdes

\`\`\`bash
pnpm install
pnpm test
\`\`\`

#### Observação

Rode \`pnpm dev\` e veja o [guia](https://example.com/guia).`,
  `# Decisão

Escolhi **Postgres** porque:

* suporta \`pgvector\`
* já está no *compose*

\`\`\`ts
export function soma(a: number, b: number) {
  return a + b;
}
\`\`\`

> Revisar na próxima rodada.`,
];

describe('RN-837 — prefixos de stream', () => {
  for (const [n, resposta] of RESPOSTAS.entries()) {
    it(`resposta ${n + 1}: nenhum prefixo lança nem mostra marcador cru`, () => {
      for (let corte = 1; corte <= resposta.length; corte += 3) {
        const prefixo = resposta.slice(0, corte);
        const { container, unmount } = render(<MarkdownMessage text={prefixo} emCurso />);
        const texto = container.textContent ?? '';
        expect(texto, `corte ${corte}`).not.toContain('**');
        expect(texto, `corte ${corte}`).not.toContain('```');
        expect(texto, `corte ${corte}`).not.toContain('`');
        unmount();
      }
    });
  }

  it('o texto final (sem emCurso) não é alterado: negrito aberto fica cru', () => {
    const { container } = render(<MarkdownMessage text="fim **aberto" />);
    expect(container.textContent).toBe('fim **aberto');
  });

  it('desenha régua, citação, h4 e checklist só visual', () => {
    const { container } = render(
      <MarkdownMessage text={'#### T\n\n---\n\n> c\n\n- [x] ok\n- [ ] não'} />,
    );
    expect(container.querySelector('h4')).not.toBeNull();
    expect(container.querySelector('hr')).not.toBeNull();
    expect(container.querySelector('blockquote')?.textContent).toBe('c');
    const caixas = container.querySelectorAll('input[type="checkbox"]');
    expect(caixas).toHaveLength(2);
    expect((caixas[0] as HTMLInputElement).checked).toBe(true);
    expect((caixas[1] as HTMLInputElement).disabled).toBe(true);
  });
});

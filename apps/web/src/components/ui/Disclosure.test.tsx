import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import { Disclosure } from './Disclosure';

// `process.cwd()` e não `import.meta.url`: sob o ambiente jsdom o
// `import.meta.url` não é `file:` e o `fileURLToPath` levanta. Mesmo caminho
// que `lib/contraste.test.ts` já usa para ler `design/tokens.css`.
const FOLHA = readFileSync(
  resolve(process.cwd(), 'src/components/ui/Disclosure.module.css'),
  'utf8',
);

/**
 * O defeito real que este componente fecha: existiam SEIS colapsos ad-hoc na
 * app e nenhum componente. Cada um implementava um pedaço da semântica — uns
 * com `aria-expanded`, outros com `<div onClick>` sem papel nenhum, nenhum com
 * `aria-controls`. Para quem usa leitor de tela, um colapso sem
 * `aria-expanded` é um botão que não diz se abriu, e um `div` clicável não é
 * nem alcançável por teclado.
 *
 * O que se protege aqui é a semântica, não a aparência:
 *
 * 1. o cabeçalho é `button` — foco e Enter/Espaço saem de graça;
 * 2. `aria-expanded` acompanha o estado, nos dois modos (controlado e não);
 * 3. `aria-controls` aponta para um elemento que EXISTE, mesmo fechado;
 * 4. o alvo tem 24px, mínimo do WCAG 2.2 AA (2.5.8).
 */
describe('Disclosure', () => {
  it('nasce fechado: botão com aria-expanded=false e conteúdo invisível', () => {
    render(<Disclosure titulo="Hubs">338 modelos</Disclosure>);

    const botao = screen.getByRole('button', { name: 'Hubs' });
    expect(botao).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('338 modelos')).toBeNull();
  });

  it('clicar abre, e o aria-expanded acompanha', () => {
    render(<Disclosure titulo="Hubs">338 modelos</Disclosure>);

    fireEvent.click(screen.getByRole('button', { name: 'Hubs' }));

    expect(screen.getByRole('button', { name: 'Hubs' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('338 modelos')).toBeVisible();
  });

  it('padraoAberto abre sem clique', () => {
    render(
      <Disclosure titulo="Hubs" padraoAberto>
        338 modelos
      </Disclosure>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('338 modelos')).toBeVisible();
  });

  it('aria-controls aponta para uma região que existe MESMO fechada', () => {
    // O ponto mais fácil de errar: desmontar a região junto com o conteúdo faz
    // `aria-controls` referenciar um id morto, e o leitor de tela anuncia um
    // botão que controla o nada.
    const { container } = render(<Disclosure titulo="Hubs">conteúdo</Disclosure>);

    const alvo = screen.getByRole('button').getAttribute('aria-controls');
    expect(alvo).toBeTruthy();
    // `getElementById` e não seletor: o id do `useId` tem `:` no meio, que num
    // seletor CSS precisaria de escape (e o jsdom não traz `CSS.escape`).
    const regiao = container.ownerDocument.getElementById(alvo!);
    expect(regiao).not.toBeNull();
    expect(regiao).not.toBeVisible();
    // E a região é rotulada pelo próprio cabeçalho: sem isso ela seria "região"
    // sem nome na lista de marcos.
    expect(regiao).toHaveAttribute('aria-labelledby', screen.getByRole('button').id);
  });

  it('dois no mesmo documento não colidem de id', () => {
    // Caso de falha: id fixo faria `aria-controls` do segundo apontar para a
    // região do primeiro — e o leitor de tela leria o conteúdo errado.
    render(
      <>
        <Disclosure titulo="Um">a</Disclosure>
        <Disclosure titulo="Dois">b</Disclosure>
      </>,
    );

    const [um, dois] = screen.getAllByRole('button');
    expect(um.getAttribute('aria-controls')).not.toBe(
      dois.getAttribute('aria-controls'),
    );
    expect(um.id).not.toBe(dois.id);
  });

  describe('modo controlado', () => {
    it('o estado vem de fora e NÃO se alterna sozinho', () => {
      // É assim que `ModelCatalogSection` usa: um `Set` de grupos abertos vive
      // no pai. Se o componente guardasse estado próprio aqui, o pai e a tela
      // divergiriam no primeiro clique.
      const onAlternar = vi.fn();
      render(
        <Disclosure titulo="Hubs" aberto={false} onAlternar={onAlternar}>
          conteúdo
        </Disclosure>,
      );

      fireEvent.click(screen.getByRole('button'));

      expect(onAlternar).toHaveBeenCalledWith(true);
      expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('conteúdo')).toBeNull();
    });

    it('aberto=true renderiza o conteúdo e pede o fechamento', () => {
      const onAlternar = vi.fn();
      render(
        <Disclosure titulo="Hubs" aberto onAlternar={onAlternar}>
          conteúdo
        </Disclosure>,
      );

      expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
      fireEvent.click(screen.getByRole('button'));
      expect(onAlternar).toHaveBeenCalledWith(false);
    });
  });

  it('o chevron é decorativo — não entra no nome acessível', () => {
    // O estado já é dito pelo `aria-expanded`. Um chevron anunciado seria a
    // mesma informação duas vezes.
    render(<Disclosure titulo="Hubs">x</Disclosure>);
    const botao = screen.getByRole('button', { name: 'Hubs' });
    expect(botao.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('testId vira data-testid do cabeçalho, quando passado', () => {
    // `AgentTimelineTree` precisa achar UM ramo entre vários agentes com
    // testes que não dão pra distinguir só por nome acessível parcial.
    render(
      <Disclosure titulo="Hubs" testId="ramo-cabecalho-x">
        conteúdo
      </Disclosure>,
    );
    expect(screen.getByTestId('ramo-cabecalho-x')).toBe(screen.getByRole('button'));
  });

  it('sem testId, nenhum data-testid aparece', () => {
    render(<Disclosure titulo="Hubs">conteúdo</Disclosure>);
    expect(screen.getByRole('button')).not.toHaveAttribute('data-testid');
  });

  it('o trailing fica DENTRO do alvo de clique', () => {
    // A linha inteira alterna, não só o chevron — é o que a implementação de
    // `ModelCatalogSection` já fazia e o que a régua de 24px pressupõe.
    render(
      <Disclosure titulo="Hubs" trailing={<span>338</span>}>
        x
      </Disclosure>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('338');
  });

  it('o cabeçalho declara alvo de no mínimo 24px (WCAG 2.2 AA 2.5.8)', () => {
    // jsdom não resolve CSS Module nem faz layout — a folha crua é a única
    // evidência que um teste em Node consegue olhar. Sem esta asserção, o
    // requisito de alvo viveria só num comentário.
    const regra = FOLHA.match(/\.cabecalho\s*\{([^}]*)\}/);
    expect(regra).not.toBeNull();
    const minHeight = regra![1].match(/min-height:\s*(\d+)px/);
    expect(minHeight).not.toBeNull();
    expect(Number(minHeight![1])).toBeGreaterThanOrEqual(24);
  });

  it('o chevron tira a cor de token, nunca de hex', () => {
    // Hex solto no componente é a dívida que o design system existe para não
    // ter: ele não acompanha o tema.
    const regra = FOLHA.match(/\.chevron\s*\{([^}]*)\}/);
    expect(regra).not.toBeNull();
    expect(regra![1]).toMatch(/color:\s*var\(--/);
    expect(FOLHA).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import uiPtBR from '../../locales/pt-BR/ui.json';
import { MarkdownMessage } from './MarkdownMessage';

/**
 * Instância própria de i18next (mesmo padrão de `AccountPage.test.tsx`), só
 * com o namespace `ui` e `lng: 'pt-BR'` — mantém as asserções em português
 * que este teste já fazia antes da extração.
 */
function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: { 'pt-BR': { ui: uiPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'ui',
    ns: ['ui'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

function renderComI18n(node: ReactElement) {
  return render(<I18nextProvider i18n={novaInstanciaI18n()}>{node}</I18nextProvider>);
}

/**
 * O realce de sintaxe quebra a linha em vários `<span>` (um por token), então
 * o texto não é filho DIRETO de nenhum nó — mesmo matcher que
 * `routes/code/CodeEditor.test.tsx` já usa pelo mesmo motivo.
 */
function porTextoDaLinha(texto: string) {
  return (_content: string, element: Element | null) => {
    if (!element) return false;
    const igual = (el: Element) => el.textContent === texto;
    return igual(element) && Array.from(element.children).every((filho) => !igual(filho));
  };
}

/**
 * RN-158 — `agent.response` renderizava texto PURO no fio (`#`/`**`/fence
 * apareciam literais). Este componente monta elementos React DIRETAMENTE, a
 * partir da árvore de dados de `lib/markdown.ts` — nunca `innerHTML`, então
 * o teste de segurança confere que o texto do modelo nunca vira marcação
 * interpretada nem link executável.
 */
describe('MarkdownMessage', () => {
  it('negrito, cabeçalho e lista renderizam como elementos de verdade', () => {
    renderComI18n(<MarkdownMessage text={'# Título\n\nUm **destaque** no meio.\n\n- item 1\n- item 2'} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Título' })).toBeInTheDocument();
    const negrito = screen.getByText('destaque');
    expect(negrito.tagName).toBe('STRONG');
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getByText('item 1')).toBeInTheDocument();
    expect(screen.getByText('item 2')).toBeInTheDocument();
  });

  it('fence sem linguagem degrada bem: o código aparece, sem quebrar a tela', () => {
    renderComI18n(<MarkdownMessage text={'```\nplain text\n```'} />);
    expect(screen.getByText(porTextoDaLinha('plain text'))).toBeInTheDocument();
    expect(screen.getByText('texto')).toBeInTheDocument();
  });

  it('código dentro do fence tem realce por token (reusa highlight.ts)', () => {
    renderComI18n(<MarkdownMessage text={'```ts\nconst a = 1;\n```'} />);
    // O token `const` vira `<span>` próprio, colorido como keyword — não
    // texto cru dentro de um único nó.
    const keyword = screen.getByText('const');
    expect(keyword.tagName).toBe('SPAN');
  });

  it('fence ```bash ganha o vocabulário de shell (RN-158) e o prompt de terminal', () => {
    renderComI18n(<MarkdownMessage text={'```bash\nif [ -f x ]; then echo ok; fi\n```'} />);
    // `if`/`then`/`echo`/`fi` são palavras REAIS de shell (não JS) — sem o
    // vocabulário próprio, caíam no fallback de JS sem keyword nenhuma.
    expect(screen.getByText('if')).toBeInTheDocument();
    expect(screen.getByText('then')).toBeInTheDocument();
    expect(screen.getByText('fi')).toBeInTheDocument();
    expect(screen.getByText('$')).toBeInTheDocument();
  });

  it('link com esquema seguro (https) vira <a> clicável', () => {
    renderComI18n(<MarkdownMessage text="veja [a doc](https://brabo.dev/docs)" />);
    const link = screen.getByRole('link', { name: 'a doc' });
    expect(link).toHaveAttribute('href', 'https://brabo.dev/docs');
  });

  it('XSS: link javascript: nunca vira href — degrada pro texto', () => {
    renderComI18n(<MarkdownMessage text="[clique](javascript:alert(1))" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('clique')).toBeInTheDocument();
  });

  /**
   * RN-176 — o Mapa de Módulos do Arquiteto vem como tabela Markdown na
   * `agent.response`, e saía como parágrafo com pipes literais. A tabela é
   * renderizada pelo `Table` do DESIGN SYSTEM (o mesmo de Configurações e
   * Gastos), não por uma `<table>` própria.
   */
  it('tabela Markdown vira o Table do design system, com cabeçalho e células', () => {
    const { container } = renderComI18n(
      <MarkdownMessage
        text={'| Módulo | Stack |\n| --- | --- |\n| api | NestJS |\n| web | React |'}
      />,
    );

    // Nenhum pipe literal sobrou na tela — era exatamente o defeito relatado.
    expect(container.textContent).not.toContain('|');

    expect(screen.getByText('Módulo')).toBeInTheDocument();
    expect(screen.getByText('Stack')).toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();
    expect(screen.getByText('NestJS')).toBeInTheDocument();
    expect(screen.getByText('web')).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();

    // O `Table` monta CSS Grid, não `<table>` — a prova de que o componente
    // compartilhado foi reusado em vez de duplicado aqui.
    expect(container.querySelector('table')).toBeNull();
  });

  it('formatação dentro da célula sobrevive (código, negrito)', () => {
    renderComI18n(<MarkdownMessage text={'| Módulo | Depende |\n| --- | --- |\n| `api` | **web** |'} />);
    expect(screen.getByText('api').tagName).toBe('CODE');
    expect(screen.getByText('web').tagName).toBe('STRONG');
  });

  it('prosa com `|` e sem separador continua parágrafo — nada vira tabela por engano', () => {
    const { container } = renderComI18n(<MarkdownMessage text="escolha entre a | b | c" />);
    expect(container.textContent).toBe('escolha entre a | b | c');
  });

  it('nunca usa innerHTML: uma tag literal no texto do modelo aparece como TEXTO, não como elemento', () => {
    const { container } = renderComI18n(<MarkdownMessage text={'texto com <img src=x onerror=alert(1)> no meio'} />);
    // Nenhum <img> real foi criado — a string sobrevive como texto.
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/texto com <img src=x onerror=alert\(1\)> no meio/)).toBeInTheDocument();
  });
});

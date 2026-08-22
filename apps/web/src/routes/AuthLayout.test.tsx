import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import authEn from '../locales/en/auth.json';
import authPtBR from '../locales/pt-BR/auth.json';
import { AuthLayout } from './AuthLayout';

/**
 * A moldura das telas de auth (ADR 0036).
 *
 * O que se guarda aqui é a estrutura que as quatro telas herdam, e três coisas
 * que dão errado em silêncio se alguém mexer:
 *
 * 1. **um `<h1>` só.** O título do card é o `<h1>`; "Brabo" é identidade visual,
 *    não cabeçalho. Promover a marca a heading daria dois `<h1>` na página e
 *    faria a lista de cabeçalhos do leitor de tela começar pela marca em toda
 *    tela, em vez de dizer o que se faz ali.
 * 2. **o fundo decorativo não é anunciado.** Grade e brilho são `<div>` vazios;
 *    sem `aria-hidden` viram dois nós sem nome na árvore de acessibilidade.
 * 3. **a versão é o valor cru do artefato.** Fora de um release é `dev`, e o
 *    rodapé diz `dev` — não "desenvolvimento", não nada. Se um dia isso virar
 *    texto enfeitado, a informação de qual build está no ar se perde.
 */
// Instância REAL de i18next, com os recursos do namespace "auth" — mesmo
// padrão de AccountPage.test.tsx: o que se prova aqui é o texto que a tela
// mostra, não a mecânica de i18next em si.
function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: {
      en: { auth: authEn },
      'pt-BR': { auth: authPtBR },
    },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'auth',
    ns: ['auth'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

function montar(props: Partial<Parameters<typeof AuthLayout>[0]> = {}) {
  const irPara = vi.fn();
  render(
    <I18nextProvider i18n={novaInstanciaI18n()}>
      <AuthLayout
        titulo="Entrar"
        subtitulo="Acesse seu workspace."
        irPara={irPara}
        {...props}
      >
        <form>
          <button type="submit">Entrar</button>
        </form>
      </AuthLayout>
    </I18nextProvider>,
  );
  return { irPara };
}

describe('AuthLayout', () => {
  it('o título do card é o único h1 — a marca não é cabeçalho', () => {
    montar();

    const cabecalhos = screen.getAllByRole('heading');
    expect(cabecalhos).toHaveLength(1);
    expect(cabecalhos[0]).toHaveTextContent('Entrar');
    expect(cabecalhos[0].tagName).toBe('H1');
  });

  it('mostra marca, tagline e subtítulo', () => {
    montar();

    expect(screen.getByText('Brabo')).toBeInTheDocument();
    expect(screen.getByText('Orquestração de agentes')).toBeInTheDocument();
    expect(screen.getByText('Acesse seu workspace.')).toBeInTheDocument();
  });

  it('o rodapé leva a /status por navegação interna', () => {
    // `/status` é rota da própria app, então é botão com `irPara` — não um
    // `<a href>`, que recarregaria a página inteira.
    const { irPara } = montar();

    fireEvent.click(screen.getByRole('button', { name: 'Status' }));
    expect(irPara).toHaveBeenCalledWith('/status');
  });

  it('a documentação é link externo, e abre fora com rel seguro', () => {
    montar();

    const link = screen.getByRole('link', { name: 'Documentação' });
    expect(link).toHaveAttribute('target', '_blank');
    // Sem `noreferrer` a página aberta recebe o `Referer` da tela de login.
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('mostra a versão do artefato crua', () => {
    // Nos testes não há `VITE_BRABO_VERSION`, então o valor é o fallback.
    montar();
    expect(screen.getByText('dev')).toBeInTheDocument();
  });

  it('as duas camadas decorativas são invisíveis para o leitor de tela', () => {
    const { container } = render(
      <I18nextProvider i18n={novaInstanciaI18n()}>
        <AuthLayout titulo="t" subtitulo="s" irPara={vi.fn()}>
          <div />
        </AuthLayout>
      </I18nextProvider>,
    );

    // Grade, brilho e o selo do logo — três nós puramente visuais.
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(3);
  });

  it('rodapé do card e bloco de baixo só aparecem quando entregues', () => {
    const { container } = render(
      <I18nextProvider i18n={novaInstanciaI18n()}>
        <AuthLayout titulo="t" subtitulo="s" irPara={vi.fn()}>
          <div />
        </AuthLayout>
      </I18nextProvider>,
    );
    expect(screen.queryByText('Criar uma conta')).toBeNull();

    // O bloco de baixo é um wrapper da moldura: sem conteúdo, não sobra uma div
    // vazia entre o card e o rodapé (que somaria 18px de espaço fantasma).
    const rodape = container.querySelector('footer');
    expect(rodape?.previousElementSibling?.tagName).toBe('SECTION');
  });

  it('renderiza rodapé do card e bloco de baixo quando entregues', () => {
    montar({
      rodapeDoCartao: <span>Não tem acesso?</span>,
      abaixoDoCartao: <p>Aviso de migração</p>,
    });

    expect(screen.getByText('Não tem acesso?')).toBeInTheDocument();
    expect(screen.getByText('Aviso de migração')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import authPtBR from '../locales/pt-BR/auth.json';
import authEn from '../locales/en/auth.json';
import { API_URL, ENGINE_URL } from '../lib/health';
import { SinaisDoAmbiente } from './SinaisDoAmbiente';

/**
 * Os sinais de ambiente da tela de login.
 *
 * O que se guarda aqui é o que a tela AFIRMA em cada um dos três estados —
 * porque o defeito que este bloco pode introduzir não é visual, é uma
 * afirmação falsa sobre a plataforma na primeira tela do produto. "Ainda não
 * sei" tem de continuar distinguível de "está no ar" e de "caiu" (a régua de
 * três estados da RN-088), e a sonda tem de ter fim: uma api que aceita a
 * conexão e nunca responde não pode deixar a linha em "verificando…" para
 * sempre.
 *
 * E uma coisa estrutural: nada aqui pode ser focável. Este bloco vem ANTES do
 * card no DOM do login, e um botão aqui roubaria a primeira parada de `Tab`
 * do campo de e-mail — ordem que `auth-teclado.test.tsx` fixa e que quebraria
 * a três arquivos de distância.
 */
function novaInstanciaI18n(lng = 'pt-BR') {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: { en: { auth: authEn }, 'pt-BR': { auth: authPtBR } },
    lng,
    fallbackLng: 'pt-BR',
    defaultNS: 'auth',
    ns: ['auth'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

function montar(lng?: string) {
  return render(
    <I18nextProvider i18n={novaInstanciaI18n(lng)}>
      <SinaisDoAmbiente />
    </I18nextProvider>,
  );
}

/** Um `fetch` que responde por URL — a api e o engine são sondados separado. */
function fetchPorServico(porUrl: (url: string) => Promise<Response>) {
  return vi.fn((entrada: RequestInfo | URL) => porUrl(String(entrada)));
}

function respostaOk(service: string) {
  return Promise.resolve(
    new Response(
      JSON.stringify({
        service,
        status: 'ok',
        timestamp: '2026-08-30T12:00:00.000Z',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('SinaisDoAmbiente', () => {
  it('os dois serviços de pé aparecem como respondendo', async () => {
    vi.stubGlobal(
      'fetch',
      fetchPorServico((url) =>
        respostaOk(url.startsWith(API_URL) ? 'api' : 'engine'),
      ),
    );

    montar();

    await waitFor(() => {
      expect(screen.getAllByText('respondendo')).toHaveLength(2);
    });
  });

  it('o serviço que recusa a conexão vira "sem resposta", não silêncio', async () => {
    // Rejeição da conexão é o caso que `fetchHealth` NÃO cobre sozinho (ele só
    // sintetiza erro para resposta não-OK) — se o `.catch` do hook sumir, a
    // linha fica presa em "verificando…" e a tela nunca diz que a api caiu.
    vi.stubGlobal(
      'fetch',
      fetchPorServico((url) =>
        url.startsWith(ENGINE_URL)
          ? Promise.reject(new Error('ECONNREFUSED'))
          : respostaOk('api'),
      ),
    );

    montar();

    await waitFor(() => {
      expect(screen.getByText('respondendo')).toBeInTheDocument();
      expect(screen.getByText('sem resposta')).toBeInTheDocument();
    });
  });

  it('resposta HTTP não-OK também é "sem resposta"', async () => {
    vi.stubGlobal(
      'fetch',
      fetchPorServico(() => Promise.resolve(new Response('', { status: 503 }))),
    );

    montar();

    await waitFor(() => {
      expect(screen.getAllByText('sem resposta')).toHaveLength(2);
    });
  });

  it('antes de a sonda voltar, diz que está verificando — nunca "de pé"', () => {
    vi.stubGlobal(
      'fetch',
      fetchPorServico(() => new Promise<Response>(() => {})),
    );

    montar();

    expect(screen.getAllByText('verificando…')).toHaveLength(2);
    expect(screen.queryByText('respondendo')).toBeNull();
  });

  it('a sonda tem teto: pendurada, vira "sem resposta" em vez de verificar para sempre', () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      fetchPorServico(() => new Promise<Response>(() => {})),
    );

    montar();
    expect(screen.getAllByText('verificando…')).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(screen.getAllByText('sem resposta')).toHaveLength(2);
  });

  it('não introduz nada focável — a primeira parada de Tab continua sendo do formulário', async () => {
    vi.stubGlobal(
      'fetch',
      fetchPorServico(() => respostaOk('api')),
    );

    const { container } = montar();
    await waitFor(() => {
      expect(screen.getAllByText('respondendo')).toHaveLength(2);
    });

    const focaveis = container.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]',
    );
    expect(focaveis).toHaveLength(0);
  });

  it('diz que runner e modelos locais não cabem aqui, em vez de omiti-los', async () => {
    // A ausência declarada é o ponto: os dois sinais são escopados a usuário e
    // projeto, e uma tela pré-identidade que simplesmente não os mostrasse
    // deixaria o usuário achando que a plataforma não os tem.
    vi.stubGlobal(
      'fetch',
      fetchPorServico(() => respostaOk('api')),
    );

    montar();

    expect(
      screen.getByText(/Runner e modelos locais dependem da sua conta/i),
    ).toBeInTheDocument();
  });

  it('os estados também existem em inglês', async () => {
    vi.stubGlobal(
      'fetch',
      fetchPorServico(() => respostaOk('api')),
    );

    montar('en');

    await waitFor(() => {
      expect(screen.getAllByText('responding')).toHaveLength(2);
    });
    expect(screen.getByText('Environment')).toBeInTheDocument();
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import sessionsPtBR from '../../locales/pt-BR/sessions.json';
import { RagCitationCard } from './RagCitationCard';
import type { RagSearchHit } from '../../lib/api-types';

const navigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}));

// Instância isolada de i18next, mesmo padrão de `AccountPage.test.tsx`: o
// componente usa `useTranslation('sessions')` e as asserções abaixo já
// existiam em pt-BR, então a instância de teste fica em pt-BR (o inglês é
// coberto pelos próprios JSON de recurso, não por este teste).
function novaInstanciaI18n() {
  const instancia = i18next.createInstance();
  void instancia.use(initReactI18next).init({
    resources: { 'pt-BR': { sessions: sessionsPtBR } },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    defaultNS: 'sessions',
    ns: ['sessions'],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instancia;
}

function montar(hit: RagSearchHit, projectId = 'p-1') {
  const i18n = novaInstanciaI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <RagCitationCard hit={hit} projectId={projectId} />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  navigate.mockClear();
});

function makeHit(overrides: Partial<RagSearchHit> = {}): RagSearchHit {
  return {
    chunkId: 'chunk-1',
    scope: 'docs',
    content: 'O gate de PR abre quando a área delega e o subagente termina.',
    score: 0.74,
    vectorScore: 0.8,
    lexicalScore: 0.2,
    origin: { kind: 'file', sourcePath: 'docs/gates.md', headingPath: ['Gates', 'PR'] },
    ...overrides,
  };
}

describe('RagCitationCard', () => {
  it('caminho feliz: origem de arquivo mostra caminho e a trilha de heading', () => {
    montar(makeHit());

    expect(screen.getByText(/docs\/gates\.md/)).toBeInTheDocument();
    expect(screen.getByText(/Gates › PR/)).toBeInTheDocument();
    expect(screen.getByText(/74% relevância/)).toBeInTheDocument();
    expect(screen.getByText(/vetor 80% · léxico 20%/)).toBeInTheDocument();
  });

  it('caminho feliz: origem de sessão navega até o evento exato ao clicar', async () => {
    const user = userEvent.setup();
    const hit = makeHit({
      scope: 'session',
      origin: { kind: 'session', sessionId: 'sess-1', eventId: 'evt-9', title: 'user:u-1' },
    });
    montar(hit);

    await user.click(screen.getByRole('button', { name: /user:u-1/ }));

    expect(navigate).toHaveBeenCalledWith({
      to: '/projects/$projectId/sessions/$sessionId',
      params: { projectId: 'p-1', sessionId: 'sess-1' },
      search: { highlightEvent: 'evt-9' },
    });
  });

  it('CASO DE FALHA: sinal ausente (null) aparece como "—", nunca como 0% (RN-234)', () => {
    const hit = makeHit({ vectorScore: null, lexicalScore: null });
    montar(hit);

    expect(screen.getByText(/vetor — · léxico —/)).toBeInTheDocument();
  });

  it('escopo `local` (RN-455, ADR 0113) é `kind: "file"`, mesma renderização de `docs`/`adr`', () => {
    const hit = makeHit({
      scope: 'local',
      origin: { kind: 'file', sourcePath: 'src/index.ts' },
    });
    montar(hit);

    expect(screen.getByText('local')).toBeInTheDocument();
    expect(screen.getByText(/src\/index\.ts/)).toBeInTheDocument();
  });
});

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import sessionsPtBR from '../../locales/pt-BR/sessions.json';
import { RagCoveragePanel } from './RagCoveragePanel';
import type { RagCoverage } from '../../lib/api-types';

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

function makeCoverage(overrides: Partial<RagCoverage> = {}): RagCoverage {
  return {
    docs: { filesInRepo: 12, filesIndexed: 10, truncated: false },
    adr: { filesInRepo: 8, filesIndexed: 8, truncated: false },
    session: { sessionsInProject: 5, sessionsIndexed: 3 },
    chunksTotal: 240,
    chunksWithoutVector: 0,
    ...overrides,
  };
}

function montar(coverage: RagCoverage) {
  const i18n = novaInstanciaI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <RagCoveragePanel coverage={coverage} />
    </I18nextProvider>,
  );
}

describe('RagCoveragePanel', () => {
  it('caminho feliz: mostra a contagem real de cada escopo contra o total real', () => {
    montar(makeCoverage());

    expect(screen.getByText('docs')).toBeInTheDocument();
    // O valor e o total nascem em nós de texto DIRETOS separados (o valor no
    // próprio div, o total dentro do span filho) — RTL só casa o texto DIRETO
    // de um elemento, não o `textContent` recursivo, então a asserção mira
    // cada nó como ele realmente é.
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText(/\/\s*12/)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/\/\s*5/)).toBeInTheDocument();
    expect(screen.getByText(/240 chunk\(s\) no índice/)).toBeInTheDocument();
  });

  it('CASO DE FALHA (degradação honesta): nunca escreve "reindexado há Xmin" — não existe esse dado (RN-237)', () => {
    montar(makeCoverage());

    expect(screen.queryByText(/reindexado há/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/min atrás/i)).not.toBeInTheDocument();
  });

  it('avisa quando há chunk sem vetor, sem esconder o número', () => {
    montar(makeCoverage({ chunksWithoutVector: 17 }));

    expect(screen.getByText(/17 sem vetor/)).toBeInTheDocument();
  });
});

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from './lib/i18n';
import { router } from './router';
import { CarregandoRota } from './components/CarregandoRota';
import { ABAS_DO_PROJETO } from './routes/project-tabs';

/**
 * AT-300 — code-splitting por rota.
 *
 * O que se prova aqui é o MECANISMO, não o tamanho do bundle (esse é medido no
 * build e está no CHANGELOG): toda tela é carregada por `import()` com um
 * `.preload` que o router chama antes de trocar de tela, e o fallback de rota
 * existe e diz em texto o que está acontecendo.
 */

// Os layouts (`__root__`, `/app`, `/auth`, `/public`) são moldura, não tela:
// o `Shell` fica estático de propósito, e os outros três são `Outlet` puro.
const LAYOUTS = new Set(['__root__', '/app', '/auth', '/public']);

type ComPreload = { preload?: () => Promise<void> };

function telas() {
  return Object.values(router.routesById).filter((rota) => !LAYOUTS.has(rota.id));
}

describe('rotas carregadas sob demanda (AT-300)', () => {
  it('as catorze telas têm `.preload` — o router espera o chunk em vez de suspender no render', () => {
    const rotas = telas();
    expect(rotas).toHaveLength(14);
    for (const rota of rotas) {
      const componente = rota.options.component as ComPreload | undefined;
      expect(typeof componente?.preload, `rota ${rota.id} sem .preload`).toBe('function');
    }
  });

  it('o `.preload` resolve de verdade (o import() aponta para um módulo que existe)', async () => {
    const sessao = router.routesById['/app/projects/$projectId/sessions/$sessionId'];
    const componente = sessao.options.component as ComPreload;
    await expect(componente.preload!()).resolves.toBeUndefined();
  });

  it('controle negativo: o layout `/app` (o `Shell`) segue estático e SEM `.preload`', () => {
    // Se esta asserção virar, alguém dividiu a moldura — o que só trocaria um
    // request por outro no primeiro paint de toda tela autenticada.
    const app = router.routesById['/app'];
    expect((app.options.component as ComPreload).preload).toBeUndefined();
  });

  it('o fallback de rota é o `CarregandoRota`, e ele diz em TEXTO que está carregando', () => {
    expect(router.options.defaultPendingComponent).toBe(CarregandoRota);
    void i18n.changeLanguage('pt-BR');
    render(
      <I18nextProvider i18n={i18n}>
        <CarregandoRota />
      </I18nextProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Carregando a página…');
  });

  it('os painéis das abas do projeto são lazy — o registro importado pelo Shell não arrasta as doze abas', () => {
    const LAZY = Symbol.for('react.lazy');
    for (const aba of ABAS_DO_PROJETO) {
      expect((aba.component as unknown as { $$typeof?: symbol }).$$typeof, aba.key).toBe(LAZY);
    }
  });
});

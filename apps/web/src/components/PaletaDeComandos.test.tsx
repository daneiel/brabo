import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import shellPtBR from '../locales/pt-BR/shell.json';
import PaletaDeComandos from './PaletaDeComandos';
import type { Project, ProjectCardSummary } from '../lib/api-types';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../lib/auth', () => ({ sair: vi.fn() }));

const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  resources: { 'pt-BR': { shell: shellPtBR } },
  lng: 'pt-BR',
  defaultNS: 'shell',
  ns: ['shell'],
  interpolation: { escapeValue: false },
});

const projetos = [
  { id: 'p1', name: 'Alfa' },
  { id: 'p2', name: 'Beta' },
] as Project[];
const resumo = [{ projectId: 'p2', latestSessionId: 'sess-beta' }] as ProjectCardSummary[];

function montar(onClose = vi.fn()) {
  const qc = new QueryClient();
  qc.setQueryData(['sessions', 'p1'], [
    { id: 's1', projectId: 'p1', name: 'Ideia', status: 'active' },
  ]);
  render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <PaletaDeComandos
          onClose={onClose}
          projetos={projetos}
          resumo={resumo}
          projetoAbertoId="p1"
          irParaAba={vi.fn()}
          abrirNovoProjeto={vi.fn()}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return onClose;
}

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  navigate.mockClear();
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

describe('PaletaDeComandos', () => {
  it('lista projetos, sessões do cache e ações, e abrir/filtrar faz zero fetch', async () => {
    montar();
    expect(await screen.findByText('Alfa · Ideia')).toBeTruthy();
    expect(screen.getByText('Beta · #sess-bet')).toBeTruthy();
    expect(screen.getByText('Gastos')).toBeTruthy();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'ideia' } });
    expect(screen.queryByText('Beta')).toBeNull();
    expect(screen.getByText('Alfa · Ideia')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('clicar num item navega e fecha', async () => {
    const onClose = montar();
    fireEvent.click(await screen.findByText('Beta'));
    expect(navigate).toHaveBeenCalledWith({ to: '/projects/$projectId', params: { projectId: 'p2' } });
    expect(onClose).toHaveBeenCalled();
  });

  it('filtro sem resultado mostra o vazio', async () => {
    montar();
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'zzzzzz' } });
    expect(await screen.findByText('Nada encontrado.')).toBeTruthy();
  });
});

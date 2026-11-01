import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../lib/i18n';
import * as api from '../lib/api-client';
import { RodarNaSuaMaquina, releSeInfraAbriuPr, urlLocalSegura } from './RodarNaSuaMaquina';

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
});
afterAll(() => {
  void i18n.changeLanguage('en');
});

const RUN = {
  command: 'cp .env.example .env && docker compose up --build',
  urls: [
    { label: 'Swagger', url: 'http://localhost:8080/docs', kind: 'api_docs' as const },
    { label: 'Fora', url: 'https://evil.example/docs', kind: 'web' as const },
  ],
  envExample: true,
  prUrl: 'http://localhost:3000/git/acme/pulls/3',
  version: 1,
  eventId: 'e1',
  declaredAt: '2026-10-11T12:00:00.000Z',
};

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RodarNaSuaMaquina projectId="p1" />
    </QueryClientProvider>,
  );
}

describe('RodarNaSuaMaquina (RN-855)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('mostra comando, copiar, link local e a nota de não verificado', async () => {
    vi.spyOn(api, 'getRunInstructions').mockResolvedValue(RUN);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    montar();
    expect(await screen.findByText(RUN.command)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'http://localhost:8080/docs' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.queryByRole('link', { name: /evil/ })).toBeNull();
    expect(screen.getByTestId('rodar-na-sua-maquina').textContent).toMatch(/não verificado na sua máquina/);
    expect(screen.getByText(/cp \.env\.example \.env$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(RUN.command));
  });

  it('sem declaração (null) o cartão não aparece', async () => {
    const spy = vi.spyOn(api, 'getRunInstructions').mockResolvedValue(null);
    montar();
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(screen.queryByTestId('rodar-na-sua-maquina')).toBeNull();
  });

  it('só localhost/127.0.0.1 com porta vira link', () => {
    expect(urlLocalSegura('http://127.0.0.1:8080/')).toBe(true);
    expect(urlLocalSegura('http://localhost.evil.com:80/')).toBe(false);
    expect(urlLocalSegura('https://localhost:8080/')).toBe(false);
  });

  it('infra.pr_opened relê o cartão; outro evento não', () => {
    const qc = new QueryClient();
    const inv = vi.spyOn(qc, 'invalidateQueries');
    expect(releSeInfraAbriuPr(qc, 'p1', 'agent.status')).toBe(false);
    expect(inv).not.toHaveBeenCalled();
    expect(releSeInfraAbriuPr(qc, 'p1', 'infra.pr_opened')).toBe(true);
    expect(inv).toHaveBeenCalledWith({ queryKey: ['run-instructions', 'p1'] });
  });
});

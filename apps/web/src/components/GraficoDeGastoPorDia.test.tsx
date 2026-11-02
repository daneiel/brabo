import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import GraficoDeGastoPorDia from './GraficoDeGastoPorDia';
import i18n from '../lib/i18n';

// O jsdom não tem ResizeObserver; o mock fica aqui, não no setup global.
beforeAll(async () => {
  await i18n.changeLanguage('pt-BR');
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const serie = [
  { dia: '2026-10-30', costMicros: 1_500_000, chamadas: 3 },
  { dia: '2026-10-31', costMicros: 0, chamadas: 0 },
];

describe('GraficoDeGastoPorDia', () => {
  it('desenha a figura com a janela no título e a tabela com os dias', () => {
    render(<GraficoDeGastoPorDia serie={serie} titulo="Gasto por dia" />);
    expect(screen.getByRole('img', { name: 'Gasto por dia — últimos 2 dias' })).toBeTruthy();
    expect(screen.getByText('Ver como tabela')).toBeTruthy();
    expect(screen.getByText('30/10')).toBeTruthy();
    expect(screen.getByText('31/10')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('série vazia não quebra: tabela sem linhas', () => {
    render(<GraficoDeGastoPorDia serie={[]} titulo="Gasto por dia" />);
    expect(screen.getByRole('img', { name: /Gasto por dia/ })).toBeTruthy();
    expect(screen.queryByText('30/10')).toBeNull();
  });
});

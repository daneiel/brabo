import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenMeter, tokenThreshold } from './TokenMeter';

describe('tokenThreshold', () => {
  it('abaixo de 70% é ok', () => {
    expect(tokenThreshold(0)).toBe('ok');
    expect(tokenThreshold(69)).toBe('ok');
  });

  it('entre 70% e 89% é warning', () => {
    expect(tokenThreshold(70)).toBe('warning');
    expect(tokenThreshold(89)).toBe('warning');
  });

  it('90% ou mais é danger', () => {
    expect(tokenThreshold(90)).toBe('danger');
    expect(tokenThreshold(150)).toBe('danger');
  });
});

describe('TokenMeter', () => {
  it('exibe uso e percentual sem alerta abaixo de 70%', () => {
    render(<TokenMeter used={50} limit={100} costBRL={10} costUSD={2} />);

    const meter = screen.getByTestId('token-meter');
    expect(meter).toHaveAttribute('data-threshold', 'ok');
    expect(screen.getByText('50 / 100 tokens')).toBeInTheDocument();
    expect(screen.queryByTestId('token-meter-alert-icon')).not.toBeInTheDocument();
  });

  it('marca threshold de warning entre 70% e 89%', () => {
    render(<TokenMeter used={75} limit={100} costBRL={10} costUSD={2} />);

    const meter = screen.getByTestId('token-meter');
    expect(meter).toHaveAttribute('data-threshold', 'warning');
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.queryByTestId('token-meter-alert-icon')).not.toBeInTheDocument();
  });

  it('marca threshold de danger com ícone de alerta e rótulo de limite mensal a partir de 90%', () => {
    render(<TokenMeter used={95} limit={100} costBRL={10} costUSD={2} />);

    const meter = screen.getByTestId('token-meter');
    expect(meter).toHaveAttribute('data-threshold', 'danger');
    expect(screen.getByTestId('token-meter-alert-icon')).toBeInTheDocument();
    expect(screen.getByText('95% do limite mensal')).toBeInTheDocument();
  });

  it('exibe custo do ciclo e economia no rodapé', () => {
    render(<TokenMeter used={10} limit={100} costBRL={12.5} costUSD={2.5} savingsBRL={3} />);

    expect(screen.getByText(/R\$\s*12,50/)).toBeInTheDocument();
    expect(screen.getByText(/US\$\s*2,50/)).toBeInTheDocument();
    expect(screen.getByText(/−R\$\s*3,00/)).toBeInTheDocument();
  });

  it('variante compacta esconde marcadores e rodapé de economia', () => {
    render(<TokenMeter used={95} limit={100} costBRL={10} costUSD={2} savingsBRL={5} variant="compact" />);

    expect(screen.getByText('95 / 100 tokens')).toBeInTheDocument();
    expect(screen.queryByText('95% do limite mensal')).not.toBeInTheDocument();
    expect(screen.queryByText(/−R\$/)).not.toBeInTheDocument();
  });

  it('variante ao vivo mostra indicador e tokens restantes', () => {
    render(<TokenMeter used={80} limit={100} costBRL={5} costUSD={1} variant="live" />);

    expect(screen.getByText('ao vivo')).toBeInTheDocument();
    expect(screen.getByText('falta 20')).toBeInTheDocument();
  });
});

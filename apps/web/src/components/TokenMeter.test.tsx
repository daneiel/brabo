import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TokenMeter, tokenThreshold } from './TokenMeter';
// A instância REAL do app: o componente usa `useTranslation('shell')` sem
// `I18nextProvider` próprio — mesmo padrão de `ProjectExecutorsTab.test.tsx`.
import i18n from '../lib/i18n';

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
});

afterAll(() => {
  void i18n.changeLanguage('en');
});

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

  it('compact com orçamento mostra gasto e saldo em USD', () => {
    render(
      <TokenMeter used={30} limit={100} costBRL={0} costUSD={30} variant="compact" />,
    );

    expect(screen.getByText(/gasto US\$\s*30,00/)).toBeInTheDocument();
    expect(screen.getByText(/saldo US\$\s*70,00/)).toBeInTheDocument();
  });
});

describe('TokenMeter — sem orçamento (noBudget)', () => {
  it('compact + noBudget: CTA no lugar da barra, nunca "0/0 · 0%"', () => {
    render(
      <TokenMeter used={0} limit={0} costBRL={0} costUSD={0} variant="compact" noBudget />,
    );

    expect(screen.getByTestId('token-meter-no-budget-cta')).toBeInTheDocument();
    expect(screen.getByText('Definir orçamento')).toBeInTheDocument();
    expect(screen.queryByText(/0\s*\/\s*0/)).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('clicar no CTA chama onDefineBudget sem propagar pro clique do card', async () => {
    const user = userEvent.setup();
    const onDefineBudget = vi.fn();
    const onCardClick = vi.fn();

    render(
      <button type="button" onClick={onCardClick}>
        <TokenMeter
          used={0}
          limit={0}
          costBRL={0}
          costUSD={0}
          variant="compact"
          noBudget
          onDefineBudget={onDefineBudget}
        />
      </button>,
    );

    await user.click(screen.getByTestId('token-meter-no-budget-cta'));

    expect(onDefineBudget).toHaveBeenCalledOnce();
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('default e live IGNORAM noBudget — mostram o valor real normalmente', () => {
    render(
      <TokenMeter used={50} limit={100} costBRL={10} costUSD={2} variant="default" noBudget />,
    );
    expect(screen.queryByTestId('token-meter-no-budget-cta')).not.toBeInTheDocument();
    expect(screen.getByText('50 / 100 tokens')).toBeInTheDocument();

    render(
      <TokenMeter used={50} limit={100} costBRL={10} costUSD={2} variant="live" noBudget />,
    );
    expect(screen.queryByTestId('token-meter-no-budget-cta')).not.toBeInTheDocument();
    expect(screen.getByText('50/100')).toBeInTheDocument();
  });
});

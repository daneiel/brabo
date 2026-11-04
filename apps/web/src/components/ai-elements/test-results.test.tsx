import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '@/lib/i18n';
import { TestResults } from './test-results';

describe('TestResults', () => {
  it('mostra o caso com falha e o recorte', () => {
    render(
      <TestResults
        execucao={{
          fonte: 'junit', total: 5, passaram: 3, falharam: 1, pulados: 1, duracaoMs: 120,
          suites: [{ nome: 'suite-a', casos: [{ nome: 'quebra', status: 'falhou', duracaoMs: 3, mensagem: 'boom' }] }],
          casosOmitidos: 4,
        }}
      />,
    );
    expect(screen.getByText('suite-a')).toBeTruthy();
    expect(screen.getByText('quebra')).toBeTruthy();
    expect(screen.getByText(/4 ficaram de fora|4 left out/)).toBeTruthy();
  });
  it('indisponível diz o motivo, nunca 0 testes', () => {
    render(<TestResults execucao={{ indisponivel: 'relatorio_invalido' }} />);
    expect(screen.getByText(/não pôde ser lido|could not be read/)).toBeTruthy();
    expect(screen.queryByText(/Passaram|Passed/)).toBeNull();
  });
  it('status vira rótulo traduzido; desconhecido vira genérico, nunca o valor cru', () => {
    render(
      <TestResults
        execucao={{
          fonte: 'junit', total: 2, passaram: 1, falharam: 0, pulados: 0, duracaoMs: 1, casosOmitidos: 0,
          suites: [{ nome: 's', casos: [
            { nome: 'a', status: 'passou', duracaoMs: 1 },
            { nome: 'b', status: 'xyz' as never, duracaoMs: 1 },
          ] }],
        }}
      />,
    );
    expect(screen.getByText(/^(passou|passed)$/)).toBeTruthy();
    expect(screen.getByText(/^(status desconhecido|unknown status)$/)).toBeTruthy();
    expect(screen.queryByText('xyz')).toBeNull();
  });
});

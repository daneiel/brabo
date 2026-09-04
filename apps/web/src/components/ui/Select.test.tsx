import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from './Select';

/**
 * Foco visível do `Select` (frente H1, PROGRAMA 28).
 *
 * O `<select>` já era nativamente alcançável por Tab — o que faltava era
 * indicação VISUAL própria: `Select.module.css` tinha `:focus` puro (sem
 * `:focus-visible`, sem reserva de `outline` para `forced-colors`). O teste
 * aqui prova alcançabilidade por teclado de verdade (`userEvent.tab()`), não
 * a presença de uma classe CSS — isso não provaria nada, porque o CSS Module
 * não roda em jsdom.
 */
describe('Select', () => {
  it('é alcançável por Tab e o valor muda pelo teclado', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <Select aria-label="Papel" onChange={handleChange} defaultValue="a">
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    );

    await user.tab();
    const select = screen.getByRole('combobox', { name: 'Papel' });
    expect(select).toHaveFocus();

    await user.selectOptions(select, 'b');
    expect(handleChange).toHaveBeenCalled();
    expect(select).toHaveValue('b');
  });

  it('select desabilitado é PULADO pelo Tab — não é foco falso', async () => {
    const user = userEvent.setup();
    render(
      <Select aria-label="Papel" disabled defaultValue="a">
        <option value="a">A</option>
      </Select>,
    );

    await user.tab();
    expect(screen.getByLabelText('Papel')).not.toHaveFocus();
  });
});

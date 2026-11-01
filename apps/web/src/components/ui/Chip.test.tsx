import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Chip } from './Chip';

describe('Chip (AT-646)', () => {
  it('é botão de alternar: aria-pressed, data-tone e onClick', () => {
    const onClick = vi.fn();
    render(
      <Chip pressed tone="violet" onClick={onClick}>
        RAG
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: 'RAG' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip).toHaveAttribute('data-tone', 'violet');
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

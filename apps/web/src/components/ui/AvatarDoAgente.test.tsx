import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AvatarDoAgente } from './AvatarDoAgente';

describe('AvatarDoAgente', () => {
  it('renderiza o ícone do agente do roster', () => {
    const { container } = render(<AvatarDoAgente id="criativo" />);
    const avatar = container.querySelector('[data-slot="avatar-agente"]');
    expect(avatar).toHaveAttribute('data-agente', 'criativo');
    expect(avatar?.querySelector('svg')).not.toBeNull();
  });

  it('sem id ou agente fora do roster degrada para o ícone padrão, nunca caixa vazia', () => {
    const { container } = render(<AvatarDoAgente id={undefined} />);
    expect(container.querySelector('[data-slot="avatar-agente"] svg')).not.toBeNull();
  });
});

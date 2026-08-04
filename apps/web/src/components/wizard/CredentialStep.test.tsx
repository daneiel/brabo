import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CredentialStep } from './CredentialStep';
import type { UserCredentialMetadata } from '../../lib/api-types';

function makeCred(
  overrides: Partial<UserCredentialMetadata> = {},
): UserCredentialMetadata {
  return {
    id: 'cred-1',
    provider: 'github',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('CredentialStep', () => {
  it('sem credenciais: mostra o form de token e chama onRegister com o token digitado', () => {
    const onRegister = vi.fn();
    render(
      <CredentialStep
        provider="github"
        credentials={[]}
        selectedId={undefined}
        onSelect={vi.fn()}
        onRegister={onRegister}
        registering={false}
        error={null}
      />,
    );

    const input = screen.getByPlaceholderText('ghp_… / glpat-…');
    fireEvent.change(input, { target: { value: 'ghp_token123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(onRegister).toHaveBeenCalledWith('ghp_token123');
  });

  it('botão de salvar fica desabilitado sem token', () => {
    render(
      <CredentialStep
        provider="github"
        credentials={[]}
        selectedId={undefined}
        onSelect={vi.fn()}
        onRegister={vi.fn()}
        registering={false}
        error={null}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Salvar' }),
    ).toBeDisabled();
  });

  it('mostra a credencial existente e chama onSelect ao clicar', () => {
    const onSelect = vi.fn();
    render(
      <CredentialStep
        provider="github"
        credentials={[makeCred()]}
        selectedId={undefined}
        onSelect={onSelect}
        onRegister={vi.fn()}
        registering={false}
        error={null}
      />,
    );

    fireEvent.click(screen.getByTestId('credential-option'));
    expect(onSelect).toHaveBeenCalledWith('cred-1');
  });

  it('marca a credencial selecionada', () => {
    render(
      <CredentialStep
        provider="github"
        credentials={[makeCred()]}
        selectedId="cred-1"
        onSelect={vi.fn()}
        onRegister={vi.fn()}
        registering={false}
        error={null}
      />,
    );
    expect(screen.getByTestId('credential-option')).toHaveAttribute(
      'data-selected',
      'true',
    );
  });

  it('mostra a mensagem de erro vinda da api ao salvar', () => {
    render(
      <CredentialStep
        provider="github"
        credentials={[]}
        selectedId={undefined}
        onSelect={vi.fn()}
        onRegister={vi.fn()}
        registering={false}
        error="Token inválido ou sem escopo suficiente."
      />,
    );
    expect(screen.getByTestId('credential-error')).toHaveTextContent(
      'Token inválido',
    );
  });
});

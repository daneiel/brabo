import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CampoDoComposer } from './CampoDoComposer';

const TEXTO =
  'Uma agência de marketing com equipe pequena quer um protótipo que rode com npm run dev, ' +
  'com login, painel de campanhas e relatório semanal por cliente, sem perder nenhuma tecla.';

/**
 * A página que ATRASA: o `draft` que ela devolve ao campo é o de uma
 * renderização anterior (o modelo do `SessionPage` pesado, RN-882). Cada
 * valor emitido chega à página, mas a prop só alcança o último um tique
 * depois — e, nesse meio-tempo, a prop velha volta ao campo.
 */
function PaginaAtrasada({ aoFinal }: { aoFinal: (v: string) => void }) {
  const [draft, setDraft] = useState('');
  const [atrasado, setAtrasado] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setAtrasado(draft), 0);
    aoFinal(draft);
    return () => clearTimeout(id);
  }, [draft, aoFinal]);
  return (
    <>
      <CampoDoComposer aria-label="composer" valor={atrasado} aoMudar={setDraft} />
      <button onClick={() => setDraft('')}>limpar</button>
    </>
  );
}

describe('CampoDoComposer (RN-882, AT-533)', () => {
  it('digitação rápida com a página atrasada não perde tecla nenhuma', async () => {
    let final = '';
    render(<PaginaAtrasada aoFinal={(v) => (final = v)} />);
    const user = userEvent.setup({ delay: null });
    const campo = screen.getByLabelText('composer') as HTMLTextAreaElement;
    await user.type(campo, TEXTO);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(campo.value).toBe(TEXTO);
    expect(final).toBe(TEXTO);
  });

  it('a escrita de fora (esvaziar depois do envio) é adotada pelo campo', async () => {
    render(<PaginaAtrasada aoFinal={() => undefined} />);
    const user = userEvent.setup({ delay: null });
    const campo = screen.getByLabelText('composer') as HTMLTextAreaElement;
    await user.type(campo, 'olá');
    await user.click(screen.getByText('limpar'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(campo.value).toBe('');
  });
});

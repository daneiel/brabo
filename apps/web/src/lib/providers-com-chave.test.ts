import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { aposMudarChave } from './providers-com-chave';

describe('aposMudarChave (salvar a chave atualiza as abas de provider)', () => {
  it('invalida credenciais, providers com chave e catálogo após a api confirmar', async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);
    const resultado = await aposMudarChave(qc, async () => 'ok');
    expect(resultado).toBe('ok');
    const chaves = spy.mock.calls.map(([f]) => f?.queryKey);
    expect(chaves).toEqual([['credentials'], ['credentialed-providers'], ['model-catalog']]);
  });

  it('mutação recusada propaga o erro e NÃO invalida nada', async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);
    await expect(
      aposMudarChave(qc, async () => {
        throw new Error('422');
      }),
    ).rejects.toThrow('422');
    expect(spy).not.toHaveBeenCalled();
  });
});

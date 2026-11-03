/** Predicado do corte (AT-722): só o ambiente `local` carrega o acesso rápido. */
export const acessoRapidoNoBuild = (ambiente: string | undefined): boolean =>
  ambiente === 'local';

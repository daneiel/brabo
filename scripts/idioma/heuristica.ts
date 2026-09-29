/**
 * A heurística de idioma MORA NA API desde a AT-163 (RN-624):
 * `apps/api/src/domain/iam/heuristica-de-idioma.ts`. Este arquivo só a
 * reexporta para o instrumento (AT-160) medir o MESMO código que o produto
 * roda — uma régua, nunca duas cópias que divergem no primeiro ajuste.
 *
 * A direção é essa, e não a inversa, porque a api não alcança `scripts/` (nem
 * no build, nem na imagem), e `packages/shared` é 100% tipo. O arquivo da api
 * não importa nada, então o Node o executa daqui por type stripping.
 */
export * from '../../apps/api/src/domain/iam/heuristica-de-idioma.ts';

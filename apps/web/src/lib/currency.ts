// Formatadores de moeda compartilhados — existiam duplicados dentro de
// TokenMeter.tsx; agora todo consumidor USD (dashboard incluso, ADR
// 0040) usa o MESMO formatter.
export const numberFmt = new Intl.NumberFormat('pt-BR');
export const brlFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
export const usdFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
});

/** Converte micro-USD (unidade que a api usa em toda parte) pra USD exibível. */
export function microsParaUsd(micros: number): number {
  return micros / 1_000_000;
}

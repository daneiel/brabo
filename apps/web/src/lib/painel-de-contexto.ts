import { useState } from 'react';

/**
 * Se o painel "Contexto da sessão" está aberto, e como ele nasce (AT-328).
 *
 * No desktop ele nasce ABERTO, ao lado do fio, como sempre. No layout móvel
 * (RN-643, `useLayoutMovel`) ele nasce FECHADO: em 390px os 320px dele
 * deixavam ~70px para o fio, que quebrava uma palavra por linha. Cruzar o
 * corte volta ao padrão do lado novo — uma gaveta aberta no telefone não pode
 * virar um painel "aberto" guardado que reaparece espremendo o fio.
 *
 * `abrirDeInicio` é a navegação que VEM ao painel (o chip de evidência do
 * Psicólogo traz `highlightEvent`, e o evento mora no log do painel): aí ele
 * nasce aberto também no telefone, senão o destino do link ficaria escondido.
 */
export function usePainelDeContexto(movel: boolean, abrirDeInicio = false) {
  const [aberto, setAberto] = useState(!movel || abrirDeInicio);
  const [movelAnterior, setMovelAnterior] = useState(movel);
  if (movel !== movelAnterior) {
    setMovelAnterior(movel);
    setAberto(!movel);
  }
  return [aberto, setAberto] as const;
}

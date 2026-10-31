import { useEffect, useRef, type TextareaHTMLAttributes } from 'react';

/**
 * RN-882 (AT-533): o campo do composer da Sessão é dono do PRÓPRIO valor
 * enquanto se digita.
 *
 * Até aqui o `<textarea>` era controlado direto pelo `draft` do
 * `SessionPage` — cada tecla re-renderizava a página inteira (o fio, as
 * filas, o composer), e o valor que voltava ao DOM era o que aquela
 * renderização tinha. Com a página atrasada em relação à digitação, o React
 * reescrevia o campo com um `draft` mais VELHO que o que já estava no DOM, e
 * a tecla do meio sumia ("agncia", "eqipe" — 991 de 1 010 caracteres no
 * TP-01, com um textarea comum na mesma página recebendo 249/249).
 *
 * AT-539 (revisão): o controlado por estado local ainda era reescrito por um
 * commit com `local` sem a tecla que o DOM já tinha (perda a cada 53 teclas
 * numa rajada de CDP). Agora o campo é NÃO controlado: `defaultValue` + `ref`,
 * `onChange` só emite, e a prop só vira atribuição no nó (esvaziar no envio,
 * texto devolvido na falha, exemplo do convite) quando difere do DOM e não é
 * eco do que o campo emitiu. Re-render da página nunca toca o valor do DOM.
 */
export function CampoDoComposer({
  valor,
  aoMudar,
  ...resto
}: {
  valor: string;
  aoMudar: (valor: string) => void;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const no = useRef<HTMLTextAreaElement>(null);
  // Os valores que ESTE campo emitiu e a página ainda pode devolver como prop.
  const emitidos = useRef<Set<string>>(new Set());

  useEffect(() => {
    const el = no.current;
    if (!el) return;
    if (valor === el.value) {
      emitidos.current.clear();
      return;
    }
    // Eco atrasado do que o próprio campo digitou: nunca reescreve.
    if (emitidos.current.has(valor)) return;
    // Escrita de fora (envio, falha, convite): atribuição imperativa no nó.
    emitidos.current.clear();
    el.value = valor;
  }, [valor]);

  return (
    <textarea
      {...resto}
      ref={no}
      defaultValue={valor}
      onChange={(e) => {
        const novo = e.target.value;
        emitidos.current.add(novo);
        aoMudar(novo);
      }}
    />
  );
}

import { useEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';

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
 * Agora o valor desenhado é o estado LOCAL, atualizado no próprio `onChange`;
 * o `draft` da página recebe cada valor (envio, rascunho, botões seguem
 * lendo dele), mas um `draft` atrasado que volta como prop NUNCA reescreve o
 * campo: só é adotado o valor que este campo não emitiu — o esvaziar depois
 * do envio, o texto devolvido quando o envio falha, o exemplo do convite.
 */
export function CampoDoComposer({
  valor,
  aoMudar,
  ...resto
}: {
  valor: string;
  aoMudar: (valor: string) => void;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const [local, setLocal] = useState(valor);
  // Os valores que ESTE campo emitiu e a página ainda pode devolver como prop.
  const emitidos = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (valor === local) {
      emitidos.current.clear();
      return;
    }
    // Eco atrasado do que o próprio campo digitou: nunca reescreve.
    if (emitidos.current.has(valor)) return;
    // Escrita de fora (envio, falha, convite): o campo a adota.
    emitidos.current.clear();
    setLocal(valor);
    // `local` fica de fora de propósito: só a PROP decide adotar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);

  return (
    <textarea
      {...resto}
      value={local}
      onChange={(e) => {
        const novo = e.target.value;
        emitidos.current.add(novo);
        setLocal(novo);
        aoMudar(novo);
      }}
    />
  );
}

/*
 * Previews do Textarea. Conteúdo portado do uso real: a recusa de história em
 * ProjectBacklogTab.tsx, que é o único lugar da app com este campo.
 */
import { Textarea } from 'web';

const coluna: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  maxWidth: 520,
};

/** Com rótulo e texto de apoio — a forma que a app usa. */
export function ComRotuloEApoio() {
  return (
    <div style={coluna}>
      <Textarea
        label="Motivo"
        hint="Vai como mensagem fixada na sessão do PO. Diga o que falta — é com isto que ele reescreve a história."
        placeholder="Ex.: os critérios de aceite não cobrem a recusa do pagamento."
        rows={4}
      />
    </div>
  );
}

/** `error` substitui o apoio e marca o campo como inválido. */
export function Invalido() {
  return (
    <div style={coluna}>
      <Textarea
        label="Motivo"
        error="Diga o que falta — o PO recebe este texto como está."
        defaultValue=" "
        rows={3}
      />
    </div>
  );
}

/** Sem rótulo: o campo cru, para quem já tem um cabeçalho por fora. */
export function Cru() {
  return (
    <div style={coluna}>
      <Textarea placeholder="Escreva aqui…" rows={3} />
    </div>
  );
}

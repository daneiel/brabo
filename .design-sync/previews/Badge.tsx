/*
 * Previews do Badge. Conteúdo tirado do uso real em apps/web/src/routes —
 * status de sessão com `dot`, contadores com `square`, veredito de gate.
 */
import { Badge } from 'web';

const row: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
};

/** Os cinco tons, o eixo que mais muda a aparência. */
export function Tons() {
  return (
    <div style={row}>
      <Badge tone="success">aprovado</Badge>
      <Badge tone="warning">aguardando</Badge>
      <Badge tone="danger">negado</Badge>
      <Badge tone="accent">triagem pesada</Badge>
      <Badge tone="muted">draft</Badge>
    </div>
  );
}

/** `dot` é como o status de sessão aparece na lista de sessões. */
export function StatusDeSessao() {
  return (
    <div style={row}>
      <Badge tone="success" dot>
        active
      </Badge>
      <Badge tone="warning" dot>
        closing
      </Badge>
      <Badge tone="muted" dot>
        closed
      </Badge>
      <Badge tone="danger" dot>
        closed_abnormally
      </Badge>
    </div>
  );
}

/** `pulse` marca o que está acontecendo agora; sem ele o badge é estático. */
export function Pulsando() {
  return (
    <div style={row}>
      <Badge tone="accent" dot pulse>
        dev-api implementando
      </Badge>
      <Badge tone="warning" dot pulse>
        3 ações aguardando você
      </Badge>
    </div>
  );
}

/** `square` (radius menor) é o contador — usado no sino e em tabelas densas. */
export function Contadores() {
  return (
    <div style={row}>
      <Badge tone="accent" square>
        7
      </Badge>
      <Badge tone="danger" square>
        2
      </Badge>
      <Badge tone="danger">4 descoberta(s)</Badge>
      <Badge tone="muted">12</Badge>
    </div>
  );
}

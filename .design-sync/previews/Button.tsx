/*
 * Previews do Button. Rótulos tirados do uso real: as ações do ApprovalCard
 * ("Aprovar", "Negar", "Sempre permitir") e do wizard de projeto.
 */
import { Button } from 'web';

const linha: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
};

/** As cinco variantes — o eixo que decide o peso visual da ação. */
export function Variantes() {
  return (
    <div style={linha}>
      <Button variant="primary">Aprovar</Button>
      <Button variant="secondary">Negar</Button>
      <Button variant="success">Confirmar arquitetura</Button>
      <Button variant="danger">Encerrar sessão</Button>
      <Button variant="ghost">Sempre permitir</Button>
    </div>
  );
}

/** `disabled` chega por spread — Button repassa os atributos de <button>. */
export function Desabilitado() {
  return (
    <div style={linha}>
      <Button variant="primary" disabled>
        Aprovar
      </Button>
      <Button variant="secondary" disabled>
        Negar
      </Button>
      <Button variant="ghost" disabled>
        Sempre permitir
      </Button>
    </div>
  );
}

/** `fullWidth` é o botão de submit dentro de um passo do wizard. */
export function LarguraTotal() {
  return (
    <div style={{ display: 'grid', gap: 8, maxWidth: 320 }}>
      <Button variant="primary" fullWidth>
        Provisionar repositório
      </Button>
      <Button variant="ghost" fullWidth>
        Voltar
      </Button>
    </div>
  );
}

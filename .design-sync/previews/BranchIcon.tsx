/*
 * Preview do BranchIcon. Todos os ícones do set têm a mesma assinatura
 * (apps/web/src/components/ui/icons.tsx), então as duas células abaixo são as
 * mesmas para todo o set: os tamanhos que a app usa, e a herança de cor.
 */
import { BranchIcon } from 'web';

const linha: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  alignItems: 'center',
};

/** Os tamanhos usados na app (12–22px). Grid de 24, traço 1.6. */
export function Tamanhos() {
  return (
    <div style={linha}>
      <BranchIcon size={12} />
      <BranchIcon size={14} />
      <BranchIcon size={16} />
      <BranchIcon size={22} />
    </div>
  );
}

/** O traço é `currentColor` — a cor vem do contexto, não de uma prop. */
export function HerdaACor() {
  return (
    <div style={linha}>
      <BranchIcon size={20} />
      <span style={{ color: 'var(--accent)', display: 'flex' }}>
        <BranchIcon size={20} />
      </span>
      <span style={{ color: 'var(--success)', display: 'flex' }}>
        <BranchIcon size={20} />
      </span>
      <span style={{ color: 'var(--danger)', display: 'flex' }}>
        <BranchIcon size={20} />
      </span>
      <span style={{ color: 'var(--text-muted)', display: 'flex' }}>
        <BranchIcon size={20} />
      </span>
    </div>
  );
}

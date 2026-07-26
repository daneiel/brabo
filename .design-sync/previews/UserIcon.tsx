/*
 * Preview do UserIcon. Todos os ícones do set têm a mesma assinatura
 * (apps/web/src/components/ui/icons.tsx), então as duas células abaixo são as
 * mesmas para todo o set: os tamanhos que a app usa, e a herança de cor.
 */
import { UserIcon } from 'web';

const linha: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  alignItems: 'center',
};

/** Os tamanhos usados na app (12–22px). Grid de 24, traço 1.6. */
export function Tamanhos() {
  return (
    <div style={linha}>
      <UserIcon size={12} />
      <UserIcon size={14} />
      <UserIcon size={16} />
      <UserIcon size={22} />
    </div>
  );
}

/** O traço é `currentColor` — a cor vem do contexto, não de uma prop. */
export function HerdaACor() {
  return (
    <div style={linha}>
      <UserIcon size={20} />
      <span style={{ color: 'var(--accent)', display: 'flex' }}>
        <UserIcon size={20} />
      </span>
      <span style={{ color: 'var(--success)', display: 'flex' }}>
        <UserIcon size={20} />
      </span>
      <span style={{ color: 'var(--danger)', display: 'flex' }}>
        <UserIcon size={20} />
      </span>
      <span style={{ color: 'var(--text-muted)', display: 'flex' }}>
        <UserIcon size={20} />
      </span>
    </div>
  );
}

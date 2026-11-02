import type { CSSProperties, ReactNode } from 'react';
import { Tabs as ShadcnTabs, TabsCount, TabsList, TabsTrigger } from '@/components/shadcn/tabs';

/**
 * Régua de abas do design system — `components/primitivas/Tabs` no bundle
 * (`ds-bundle/_ds_sync.json`), uma das 66 peças que o `BraboDS` gera A PARTIR
 * deste app.
 *
 * Desde o ADR 0126 ela não tem consumidor dentro de `apps/web`: o único era
 * `GroupedTabs`, e `GroupedTabs` era do `ProjectPage`, que passou a navegar
 * por um trilho vertical (que o ADR 0211 trocou pela lista da sidebar,
 * `routes/AbasDoProjeto.tsx`). Ela FICA — primitiva
 * genérica sem chamador é peça do sistema de design em estoque, não código
 * morto, e apagá-la mudaria o inventário do DS por um efeito colateral de
 * uma tela.
 */
export interface TabItem {
  key: string;
  label: string;
  count?: number;
  /** Cor do sublinhado da aba ativa (ex.: `var(--violet)`); sem ela, `--accent`. */
  cor?: string;
}

interface TabsProps {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
  trailing?: ReactNode;
}

export function Tabs({ items, active, onChange, trailing }: TabsProps) {
  return (
    <ShadcnTabs value={active} onValueChange={(v) => onChange(String(v))}>
      <TabsList variant="casa">
        {items.map((item) => (
          <TabsTrigger
            key={item.key}
            value={item.key}
            variant="casa"
            style={item.cor ? ({ '--tab-cor': item.cor } as CSSProperties) : undefined}
          >
            {item.label}
            {item.count !== undefined && <TabsCount>{item.count}</TabsCount>}
          </TabsTrigger>
        ))}
        {trailing}
      </TabsList>
    </ShadcnTabs>
  );
}

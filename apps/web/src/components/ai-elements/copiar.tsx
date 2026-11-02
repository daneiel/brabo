import { useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { Button } from '@/components/shadcn/button';

/* Action "Copiar" do Message (prévia AT-674). */
export function AcaoCopiar({ texto, rotulo, rotuloCopiado }: { texto: string; rotulo: string; rotuloCopiado: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      data-slot="ai-copiar"
      aria-label={copiado ? rotuloCopiado : rotulo}
      title={copiado ? rotuloCopiado : rotulo}
      onClick={() => {
        void navigator.clipboard?.writeText(texto).then(() => {
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1500);
        });
      }}
    >
      {copiado ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

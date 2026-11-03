import { useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { Button } from '@/components/shadcn/button';

/* Action "Copiar" do Message (AT-674). Sem clipboard (contexto inseguro), não copia e não marca "copiado". */
export function AcaoCopiar({
  texto,
  rotulo,
  rotuloCopiado,
  aoFalhar,
}: {
  texto: string;
  rotulo: string;
  rotuloCopiado: string;
  aoFalhar?: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const nome = copiado ? rotuloCopiado : rotulo;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      data-slot="ai-copiar"
      aria-label={nome}
      title={nome}
      onClick={() => {
        navigator.clipboard?.writeText(texto).then(
          () => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
          },
          () => aoFalhar?.(),
        );
      }}
    >
      {copiado ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

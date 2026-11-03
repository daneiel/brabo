import type { ReactNode } from 'react';
import { Button } from '@/components/shadcn/button';
import { Button as BotaoDeIcone } from '@/components/ui/Button';

type Props = {
  sugestoes: string[];
  onEscolher: (texto: string) => void;
  desabilitado?: boolean;
};

/** Padrão Suggestion: chips que devolvem o texto; o chamador decide o que fazer. */
export function Sugestoes({ sugestoes, onEscolher, desabilitado }: Props) {
  if (sugestoes.length === 0) return null;
  return (
    <div data-slot="suggestions" className="flex flex-wrap gap-2">
      {sugestoes.map((s) => (
        <Button
          key={s}
          type="button"
          variant="outline"
          size="sm"
          disabled={desabilitado}
          onClick={() => onEscolher(s)}
        >
          {s}
        </Button>
      ))}
    </div>
  );
}

export type AcaoSugerida = {
  chave: string;
  rotulo: string;
  aoClicar: () => void;
  desabilitada?: boolean;
  /** Por que está inerte, em TEXTO visível (tooltip de botão desabilitado não abre). */
  motivo?: string;
  /** Tooltip só de botão habilitado. */
  explica?: string;
  testId?: string;
  /** Com ícone o botão fica só no ícone e o `rotulo` vira a legenda (nome acessível). */
  icone?: ReactNode;
};

/**
 * AT-681 (RN-976): sugestões que são AÇÃO. O clique chama o handler da página
 * (nunca escreve no campo, RN-882) e nada é clicado sozinho.
 */
export function SugestoesDeAcao({ acoes }: { acoes: AcaoSugerida[] }) {
  if (acoes.length === 0) return null;
  // Motivos iguais (ex.: o de papel) aparecem uma vez só.
  const motivos = [...new Set(acoes.flatMap((a) => (a.motivo ? [a.motivo] : [])))];
  return (
    <div data-slot="suggestions" className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        {acoes.map((a) =>
          a.icone ? (
            <BotaoDeIcone
              key={a.chave}
              type="button"
              variant="secondary"
              size="sm"
              legenda={a.rotulo}
              data-testid={a.testId}
              disabled={a.desabilitada}
              title={a.desabilitada ? undefined : a.explica}
              onClick={a.aoClicar}
            >
              {a.icone}
            </BotaoDeIcone>
          ) : (
          <Button
            key={a.chave}
            type="button"
            variant="outline"
            size="sm"
            data-testid={a.testId}
            disabled={a.desabilitada}
            title={a.desabilitada ? undefined : a.explica}
            onClick={a.aoClicar}
          >
            {a.rotulo}
          </Button>
          ),
        )}
      </div>
      {motivos.map((m) => (
        <span key={m} className="text-xs text-muted-foreground">
          {m}
        </span>
      ))}
    </div>
  );
}

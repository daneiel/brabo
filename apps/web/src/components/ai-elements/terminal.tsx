import Ansi from 'ansi-to-react';

/*
 * Terminal (AT-683, prévia v5). Comando + saída com cores ANSI + exitCode.
 * Só apresentação: o chamador passa o texto pronto. A lib só entra no chunk
 * de quem importa este arquivo (o ApprovalCard), nunca na carga inicial.
 */
type TerminalProps = {
  comando?: string;
  /** Mensagem já traduzida para comando ausente/inválido. */
  semComando?: string;
  saida?: string;
  /** Mensagem já traduzida para saída vazia. */
  semSaida?: string;
  exitCode?: number | null;
  cabecalho?: string;
};

export function Terminal({ comando, semComando, saida, semSaida, exitCode, cabecalho }: TerminalProps) {
  return (
    <div data-slot="ai-terminal" className="overflow-hidden rounded-md border border-border bg-muted font-mono text-xs">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-muted-foreground">
        <span data-slot="ai-terminal-command" className="min-w-0 truncate text-foreground">
          {comando ? <>$ {comando}</> : semComando}
        </span>
        {exitCode != null && (
          <span
            data-slot="ai-terminal-exit"
            className={exitCode === 0 ? 'shrink-0 text-muted-foreground' : 'shrink-0 text-destructive'}
          >
            exit {exitCode}
          </span>
        )}
      </div>
      {saida !== undefined && (
        <pre data-slot="ai-terminal-output" className="m-0 max-h-80 overflow-auto p-3 whitespace-pre-wrap text-foreground">
          {cabecalho && <span className="mb-1 block text-muted-foreground">{cabecalho}</span>}
          {saida ? <Ansi>{saida}</Ansi> : semSaida}
        </pre>
      )}
    </div>
  );
}

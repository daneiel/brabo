/*
 * Previews do ToastProvider.
 *
 * O provider não recebe os toasts por prop: ele expõe `showToast` por contexto,
 * e quem está dentro chama via `useToast()`. Para o card mostrar um toast de
 * verdade, um filho dispara showToast no mount.
 *
 * `durationMs` default é 5000 — com ele, o toast desaparece no meio da captura
 * e o resultado fica sendo sorteio. Por isso os previews passam um durationMs
 * enorme: o card fica determinístico.
 */
import { useEffect } from 'react';
import { ToastProvider, useToast, Button } from 'web';

const PARA_SEMPRE = 10 ** 9;

function Dispara({
  toasts,
}: {
  toasts: { title: string; message?: string; tone?: 'success' | 'warning' | 'danger' | 'accent' }[];
}) {
  const { showToast } = useToast();
  useEffect(() => {
    for (const t of toasts) showToast({ ...t, durationMs: PARA_SEMPRE });
  }, [showToast, toasts]);
  return null;
}

const moldura: React.CSSProperties = {
  minHeight: 220,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/** Um toast de sucesso — o retorno de uma ação aprovada. */
export function Sucesso() {
  return (
    <ToastProvider>
      <div style={moldura}>
        <Button variant="primary">Aprovar</Button>
      </div>
      <Dispara
        toasts={[
          {
            title: 'Ação aprovada',
            message: 'dev-backend já está executando o comando.',
            tone: 'success',
          },
        ]}
      />
    </ToastProvider>
  );
}

/** Os quatro tons empilhados, que é como a pilha se comporta de verdade. */
export function OsQuatroTons() {
  return (
    <ToastProvider>
      <div style={moldura} />
      <Dispara
        toasts={[
          { title: 'Merge liberado', message: 'QA e SecOps aprovaram a PR.', tone: 'success' },
          { title: 'Orçamento em 92%', message: 'O projeto está perto do teto.', tone: 'warning' },
          { title: 'Sessão encerrada', message: 'Causa: node_shutdown.', tone: 'danger' },
          { title: 'Nova hipótese', message: 'O Psicólogo tem algo sobre dev-backend.', tone: 'accent' },
        ]}
      />
    </ToastProvider>
  );
}

/** Só título, sem mensagem — o contrato deixa `message` opcional. */
export function SoTitulo() {
  return (
    <ToastProvider>
      <div style={moldura} />
      <Dispara toasts={[{ title: 'Instrução revertida para a v2', tone: 'accent' }]} />
    </ToastProvider>
  );
}

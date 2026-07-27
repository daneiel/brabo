/*
 * Previews do Modal.
 *
 * O Modal é overlay: renderiza o backdrop cobrindo a viewport e o painel
 * centralizado. Ele NÃO tem prop de aberto/fechado — quem usa monta o Modal
 * quando quer mostrá-lo, então o estado fechado não é um preview possível.
 * `onClose` é obrigatório e aqui é no-op (o card é estático).
 */
import { Modal, Button, Input, LockIcon, TrashIcon } from 'web';

const noop = () => {};

/** O caso canônico: título, corpo e as ações no fim. */
export function Confirmacao() {
  return (
    <Modal title="Encerrar a sessão?" onClose={noop}>
      <p style={{ margin: '0 0 16px', fontSize: 13.5, lineHeight: 1.5 }}>
        A sessão passa para <b>closing</b> e os agentes param de aceitar trabalho novo. O
        event log é preservado — nada do que já aconteceu é apagado.
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={noop}>
          Cancelar
        </Button>
        <Button variant="danger" onClick={noop}>
          Encerrar
        </Button>
      </div>
    </Modal>
  );
}

/** `icon` acompanha o título — usado quando o modal pede um segredo. */
export function ComIconeEFormulario() {
  return (
    <Modal title="Registrar credencial do GitHub" icon={<LockIcon size={15} />} onClose={noop}>
      <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
        <Input mono type="password" placeholder="ghp_…" />
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          O token é cifrado com envelope encryption antes de ir para o banco.
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={noop}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={noop}>
          Salvar
        </Button>
      </div>
    </Modal>
  );
}

/** Título como nó, não string — o contrato aceita ReactNode. */
export function TituloComposto() {
  return (
    <Modal
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Remover <code style={{ fontFamily: 'var(--font-mono)' }}>dev-frontend</code>
        </span>
      }
      icon={<TrashIcon size={15} />}
      onClose={noop}
    >
      <p style={{ margin: '0 0 16px', fontSize: 13.5 }}>
        O worktree do agente é descartado. As branches já publicadas continuam no
        repositório.
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="danger" onClick={noop}>
          Remover
        </Button>
      </div>
    </Modal>
  );
}

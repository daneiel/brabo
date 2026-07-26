/*
 * Previews do Table. É uma tabela em CSS grid, genérica na linha: `columns`
 * declara `render(row)`, então cada célula pode ser qualquer nó — na app são
 * Badge e texto mono. `width` por coluna alimenta o grid-template-columns.
 */
import { Table, Badge } from 'web';

interface Tarefa {
  id: string;
  titulo: string;
  modulo: string;
  status: 'todo' | 'in_progress' | 'in_review' | 'done';
  responsavel: string;
  bloqueada: boolean;
}

const TOM = {
  todo: 'muted',
  in_progress: 'accent',
  in_review: 'warning',
  done: 'success',
} as const;

const ROTULO = {
  todo: 'a fazer',
  in_progress: 'em andamento',
  in_review: 'em revisão',
  done: 'concluída',
} as const;

const tarefas: Tarefa[] = [
  {
    id: 'task-1',
    titulo: 'expor oban_queue_depth no /metrics',
    modulo: 'engine',
    status: 'in_review',
    responsavel: 'dev-backend',
    bloqueada: false,
  },
  {
    id: 'task-2',
    titulo: 'drenar sessões ativas no preStop',
    modulo: 'engine',
    status: 'in_progress',
    responsavel: 'dev-backend',
    bloqueada: false,
  },
  {
    id: 'task-3',
    titulo: 'painel de custo por projeto no Grafana',
    modulo: 'infra',
    status: 'todo',
    responsavel: 'infra',
    bloqueada: true,
  },
  {
    id: 'task-4',
    titulo: 'propagar traceparent no envelope do outbox',
    modulo: 'api',
    status: 'done',
    responsavel: 'dev-backend',
    bloqueada: false,
  },
];

const colunas = [
  {
    key: 'titulo',
    label: 'Tarefa',
    width: '2fr',
    render: (t: Tarefa) => (
      <span>
        {t.titulo}
        {t.bloqueada && (
          <>
            {' '}
            <Badge tone="danger" square>
              bloqueada
            </Badge>
          </>
        )}
      </span>
    ),
  },
  {
    key: 'modulo',
    label: 'Módulo',
    width: '100px',
    render: (t: Tarefa) => (
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{t.modulo}</span>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    width: '140px',
    render: (t: Tarefa) => <Badge tone={TOM[t.status]}>{ROTULO[t.status]}</Badge>,
  },
  {
    key: 'responsavel',
    label: 'Responsável',
    width: '130px',
    render: (t: Tarefa) => (
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{t.responsavel}</span>
    ),
  },
];

/** O backlog: colunas com larguras distintas e Badge dentro da célula. */
export function Backlog() {
  return <Table columns={colunas} rows={tarefas} rowKey={(t: Tarefa) => t.id} />;
}

/** Vazio com a mensagem default. */
export function Vazio() {
  return <Table columns={colunas} rows={[]} rowKey={(t: Tarefa) => t.id} />;
}

/** Vazio com mensagem própria — o que a tela de aprovações mostra. */
export function VazioComMensagem() {
  return (
    <Table
      columns={colunas}
      rows={[]}
      rowKey={(t: Tarefa) => t.id}
      emptyMessage="Nenhuma ação aguardando sua decisão."
    />
  );
}

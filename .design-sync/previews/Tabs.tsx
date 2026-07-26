/*
 * Previews do Tabs. As abas são as reais das telas de projeto e de sessão.
 * `active` é controlado por quem usa; nos cards ele é fixo, então o preview
 * mostra a aba selecionada em vez de reagir ao clique.
 */
import { Tabs, Badge, Button, PlusIcon } from 'web';

const noop = () => {};

const abasDoProjeto = [
  { key: 'visao', label: 'Visão geral' },
  { key: 'backlog', label: 'Backlog', count: 24 },
  { key: 'aprovacoes', label: 'Aprovações', count: 3 },
  { key: 'insights', label: 'Insights' },
  { key: 'config', label: 'Configuração' },
];

/** Com contadores — é assim que a tela de projeto usa. */
export function ComContadores() {
  return <Tabs items={abasDoProjeto} active="backlog" onChange={noop} />;
}

/** Sem contadores, e com outra aba ativa. */
export function SemContadores() {
  return (
    <Tabs
      items={[
        { key: 'chat', label: 'Chat' },
        { key: 'atividade', label: 'Atividade' },
        { key: 'time', label: 'Time' },
      ]}
      active="atividade"
      onChange={noop}
    />
  );
}

/** `trailing` ancora uma ação à direita da régua de abas. */
export function ComAcaoAoLado() {
  return (
    <Tabs
      items={abasDoProjeto}
      active="aprovacoes"
      onChange={noop}
      trailing={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Badge tone="warning" dot>
            3 aguardando
          </Badge>
          <Button variant="ghost">
            <PlusIcon size={13} /> Nova sessão
          </Button>
        </div>
      }
    />
  );
}

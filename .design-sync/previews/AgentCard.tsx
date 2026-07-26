/*
 * Previews do AgentCard.
 *
 * O `agent` é um AgentDef: nome, papel, cor (que entra por `--agent-color`) e o
 * componente de ícone. O mapa AGENTS de apps/web/src/lib/agents.ts NÃO está
 * exportado no bundle, então os objetos abaixo repetem os valores reais de lá —
 * um AgentDef inventado renderiza um card sem identidade nenhuma.
 *
 * `status` é pt-BR no domínio: 'trabalhando' | 'aguardando' | 'ocioso' |
 * 'falhou' (ver AgentStatus em components/AgentCard.tsx).
 */
import { AgentCard, CodeIcon, PermissionIcon, StackIcon, LockIcon } from 'web';

const noop = () => {};

const devBackend = {
  key: 'dev-backend' as const,
  name: 'Dev Backend',
  role: 'Implementação de API e domínio',
  color: 'var(--success)',
  icon: CodeIcon,
};

const qa = {
  key: 'qa' as const,
  name: 'QA',
  role: 'Verificação e testes',
  color: 'var(--danger)',
  icon: PermissionIcon,
};

const arquiteto = {
  key: 'arquiteto' as const,
  name: 'Arquiteto',
  role: 'Design técnico e decisões estruturais',
  color: 'var(--accent)',
  icon: StackIcon,
};

const secops = {
  key: 'secops' as const,
  name: 'SecOps',
  role: 'Segurança e conformidade',
  color: '#8AA6AE',
  icon: LockIcon,
};

/** O estado que o painel do time mostra na maior parte do tempo. */
export function Trabalhando() {
  return (
    <AgentCard
      agent={devBackend}
      status="trabalhando"
      model={{ name: 'qwen2.5-coder:14b', provider: 'ollama' }}
      autonomy="auto"
      onAutonomyChange={noop}
      activity={{
        label: 'expor oban_queue_depth no /metrics',
        branch: 'feature/dev-backend/oban-metrics',
      }}
      tokensMicros={2_290_000}
    />
  );
}

/** Aguardando decisão do usuário — o gate de PR parado na autoridade humana. */
export function Aguardando() {
  return (
    <AgentCard
      agent={qa}
      status="aguardando"
      model={{ name: 'claude-opus-5', provider: 'anthropic' }}
      autonomy="manual"
      onAutonomyChange={noop}
      activity={{ label: 'parecer emitido — esperando o merge' }}
      tokensMicros={148_000}
    />
  );
}

/** Falhou: o card precisa deixar o erro óbvio, não só mudar de cor. */
export function Falhou() {
  return (
    <AgentCard
      agent={arquiteto}
      status="falhou"
      model={{ name: 'claude-opus-5', provider: 'anthropic' }}
      autonomy="manual"
      onAutonomyChange={noop}
      activity={{ label: 'consolidando o mapa de módulos' }}
      tokensMicros={8_910_000}
    />
  );
}

/** O mínimo do contrato: só agente e status, sem modelo, atividade ou custo. */
export function SomenteOMinimo() {
  return <AgentCard agent={secops} status="ocioso" />;
}

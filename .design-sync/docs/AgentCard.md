---
category: Dominio
keywords: [agente, time, status, autonomia, modelo, custo]
---

# AgentCard

O card de um agente no painel do time: identidade, o que está fazendo agora,
qual modelo usa, quanto já gastou e se opera em autonomia manual ou automática.

## Como usar

```tsx
<AgentCard
  agent={AGENTS['dev-backend']}
  status="trabalhando"
  model={{ name: 'qwen2.5-coder:14b', provider: 'ollama' }}
  autonomy="auto"
  onAutonomyChange={setAutonomia}
  activity={{ label: 'expor oban_queue_depth no /metrics', branch: 'feature/dev-backend/oban-metrics' }}
  tokensMicros={2_290_000}
/>
```

## O que respeitar

- **`agent` é um `AgentDef` do DS**, não um objeto solto: nome, papel, ícone e a
  cor (que entra por `--agent-color`) saem dele. Inventar o objeto rende um card
  sem identidade.
- **`status` é em pt-BR**: `trabalhando`, `aguardando`, `ocioso`, `falhou`.
- `tokensMicros` é micro-USD — 2_290_000 são US$ 2,29.
- `activity` é o que o agente faz AGORA. Sem ela o card encolhe e continua
  válido; não preencha com texto de enfeite.
- `onAutonomyChange` é opcional, mas sem ele o toggle fica inerte: só passe
  `autonomy` sem handler se a mudança realmente não for permitida ali.

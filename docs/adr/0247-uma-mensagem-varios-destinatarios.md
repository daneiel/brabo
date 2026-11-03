# ADR 0247 — Uma mensagem, vários destinatários

- **Status:** aceito
- **Data:** 2026-11-03
- **Referencia:** os ADRs [0163](0163-o-clique-responde-ao-aceitar.md) (responder ao aceitar) e [0191](0191-a-mensagem-com-turno-em-curso-entra-numa-fila.md) (fila por agente). Revisa a RN-584 e a RN-631 (um destinatário só por mensagem). Nenhum ADR é editado.

## Contexto

AT-717 (EP-031): o `@` do composer. O dono decidiu em 02/11 que `@po @arquiteto` manda a MESMA mensagem aos dois. Até aqui a mensagem tinha um destinatário, escolhido no seletor "Para" (RN-631), e o `chat.message` não dizia a quem foi.

## Decisão

1. **Rota nova** `POST /projects/:projectId/sessions/:sessionId/messages` (`developer`), corpo `{ text, destinatarios: string[] (1 a 7), anexos? }`, 202 com `{ mensagemId, entregas: [{ agente, entrega: 'turno'|'enfileirada'|'recusada', motivo? }] }`. A rota de um agente só (`.../agents/:agent/message`) não muda.
2. **UM `chat.message`** com `payload.destinatarios`. A rota de um agente passa a gravar `[agent]`, e o log diz a quem cada mensagem foi.
3. **Uma entrega por agente, com o MESMO `mensagemId`**, pelo caminho que já existe (`agent/message` do engine, `TurnoAssincrono`, fila RN-673, recusas nomeadas). Não há fila nova. A recusa de um destinatário (não conversacional, inativo, fila cheia) vira `recusada` com o motivo e não derruba os outros. Sessão encerrada continua 409 `sessao_encerrada` (RN-581), antes de qualquer entrega.
4. **O `mensagemId` compartilhado pede escopo por agente na fila**: `chat.message_delivered` (ator = o agente) e `chat.message_cancelled` (`agente` no payload) só fecham a cópia do agente a que se referem. Evento antigo sem `agente` vale para todos.
5. **Reidratação:** o `chat.message` já entra como mensagem do usuário na história de todo agente; os destinatários o leem como a eles dirigido e para quem não é destinatário nada muda.

## Consequências

- Cada destinatário paga um turno; a tela acompanha mais de um turno (lane web).
- Os agentes que não são destinatários continuam sem ler ao vivo; só na reidratação.
- A RN-584 (recusa nomeada) e a RN-631 (seletor de um destino) seguem valendo por destinatário.

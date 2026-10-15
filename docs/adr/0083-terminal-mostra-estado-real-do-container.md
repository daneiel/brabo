# 0083 — A aba Terminal ganha o consumidor real do ciclo de vida, não o terminal

## Status

Aceito. Revisa a seção "Nenhuma rota HTTP nova" do
[ADR 0081](0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md), que
adiou essa rota de propósito até existir um consumidor real. Não revisa —
e não pode revisar — o [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)
nem a FASE 25b (CLAUDE.md), que continuam declarando o terminal interativo
cortado: este documento não sobe a parede física do container, só lê o
estado registrado do lado de fora dela.

## Contexto

O plano original desta frente (PROGRAMA 28, Onda 5, frente F2) era "terminal
interativo", assumindo que por esta altura o container por projeto já teria
ciclo de vida real — provisionamento de verdade, com o worktree do agente
vivendo dentro do container. Isso não aconteceu. A Onda 4/frente F1 (ADR
0081) entregou `project_containers` — uma TABELA de estado
(`provisioning/running/stopped/failed/removed`) e dois casos de uso que
gravam e leem essa tabela — mas nenhuma chamada real a Docker: nenhum
serviço monta `/var/run/docker.sock`, nenhum roda `privileged`, e
`RegistrarTransicaoDeContainerUseCase` não tem chamador nenhum fora dos
próprios testes. Não existe container real rodando para abrir um terminal
DENTRO dele.

Implementar um terminal que finge executar comandos, ou que executa no MESMO
container do monorepo do Brabo — a dívida que o ADR 0055 já descreve como
política, não isolamento —, inventaria uma capacidade que não existe. É o
mesmo erro que os ADRs 0041/0042 já recusam para provider de LLM sem prova e
modelo de catálogo sem curadoria: capability só se declara quando provada.

O ADR 0081 já tinha nomeado esta frente como o consumidor que faltava:

> Nada na Onda 4 consome esta tabela por HTTP ainda — o terminal interativo
> (25b/Onda 5) é o candidato óbvio, e decidir a forma da rota antes de saber
> exatamente o que ele precisa ler seria adivinhar um contrato.
> — ADR 0081

## Decisão

**A aba Terminal não ganha um terminal.** Ganha o consumidor real que o ADR
0081 esperava: `GET /projects/:projectId/container/lifecycle` (RN-267), uma
rota de leitura só, `role:viewer`, que espelha
`ObterCicloDeVidaDoContainerUseCase` sem adicionar lógica — `null` quando o
projeto nunca foi provisionado (o caso comum hoje, porque nada em produção
transiciona a tabela) ou o estado registrado
(`status`/`imageVersion`/`resources`/`failureReason`/`statusChangedAt`).

Sob o texto explicativo que já existia em `CodeBottomPanel.tsx` desde a FASE
26b ("o terminal interativo ainda não existe — FASE 25b"), a aba passa a
mostrar esse estado com um `Badge` traduzido para pt-BR e o motivo da falha
quando houver. A busca só acontece enquanto a aba Terminal está aberta
(`enabled: aba === 'terminal'`), sem polling em segundo plano — a mesma
disciplina de tráfego que a RN-107 já aplica ao gate da imagem.

O texto explicativo da FASE 25b **não é removido nem enfraquecido**: o
estado do ciclo de vida é informação adicional, não substituição da
explicação de por que o terminal em si não existe. Um projeto podendo
mostrar `running` não significa que há algo executável ali — significa
apenas que alguém (hoje, um teste ou uma chamada manual) registrou essa
transição na tabela.

## Consequências

**O que passa a existir.** A primeira exposição HTTP do ciclo de vida do
container, e a primeira tela do produto que lê `project_containers` — antes
disso a tabela só era visível a quem consultasse o banco ou os testes
diretamente.

**O que continua exatamente como estava.** O terminal interativo. A FASE 25b
segue cortada e declarada — nenhuma linha desta ADR sobe um orquestrador,
monta um socket Docker ou roteia um comando de terminal para dentro de um
container. Os achados Z e AD (allowlist de verbo não converge) continuam
abertos pelo mesmo motivo do ADR 0081: fechar exige a parede física, não uma
tela que lê uma tabela de estado.

**O que fica honesto por construção.** Como nada em produção hoje transiciona
`project_containers`, a resposta mais comum da rota nova é `null`, e a aba
mostra isso literalmente ("ainda não foi provisionado") em vez de inventar
um status. No dia em que um orquestrador real existir e começar a
transicionar a tabela de verdade, esta mesma tela passa a refletir esse
estado sem precisar mudar — ela já lê o que a tabela diz, nunca o que
gostaríamos que ela dissesse.

## Referências

- [ADR 0081](0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md) —
  a tabela e os dois casos de uso que este documento finalmente expõe por HTTP.
- [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md) —
  a FASE 25b, que continua cortada; este documento não a reabre.
- [RN-105](../business-rules/autenticacao.md#rn-105), [RN-107](../business-rules/autenticacao.md#rn-107),
  [RN-243](../business-rules.md#rn-243), [RN-267](../business-rules.md#rn-267),
  [RN-268](../business-rules.md#rn-268).
- `apps/api/src/interfaces/http/containers/containers.controller.ts`,
  `apps/web/src/routes/code/CodeBottomPanel.tsx`.

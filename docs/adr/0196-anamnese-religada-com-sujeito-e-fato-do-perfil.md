# 0196 — A Anamnese religada: não roda sem sujeito, e a hipótese aceita vira fato do perfil

## Status

**Accepted.** 2026-10-01 (AT-277, história HS-072, épico EP-030, rodada 36;
decisão do dono em 01/10: *"religar a Anamnese com correções"* — guarda de
sujeito elegível, e a hipótese ACEITA vira fato do perfil no grafo e entra no
contexto dos agentes que conversam com a pessoa; a recusada fica só
registrada). Encerra a pausa de 2026-08-10 só para a Anamnese — o Psicólogo
segue pausado (`PSYCHOLOGIST_ENABLED=false`). Usa o grafo do
[ADR 0099](0099-neo4j-grafo-de-conhecimento-e-templates.md) como ele foi desenhado
(memória DERIVADA do event log) e o caminho de orientação efêmera do idioma
(RN-622) sem editar nenhum dos dois.

## Context

Medido no código de `dev` e no relatório do uso real de 2026-09-29, antes de
mudar:

- **Seis rodadas, seis `anamnese.run_skipped` escritos pelo MODELO** com o
  mesmo motivo, "nenhum membro elegível" (sessões `be70`, `67f3`, `d7e9` ×2,
  `5d66` ×2), por 8 933 micros em 6 chamadas. `anamnese_runs` = 0,
  `proficiency_profiles` = 0.
- **De onde vinha o sujeito:** `GetAnamneseContextUseCase` lia
  `ProjectRepository.listMembers`, que é SÓ `project_members`. Criar projeto
  não grava linha ali (`CreateProjectUseCase`), e a autorização trata o dono
  do workspace como membro do projeto por `projectRole ?? workspaceRole`
  (RN-471). Num projeto de uma pessoa, a lista vinha vazia sempre.
- **O worker não olhava a lista:** `AnamneseWorker.maybe_analyze/3` só
  perguntava à triagem (volume da janela, fila de hipóteses), e hipótese na
  fila FORÇAVA a rodada. O prompt dizia "(nenhum membro elegível)" e o modelo
  era pago para concluir isso.
- **A hipótese aceita não tinha consumidor de fato:** `AcceptHypothesisUseCase`
  enfileirava em `anamnese_queue` (3 linhas no uso real), e o único consumo
  era o `propose_instruction_patch` de uma rodada — que, no `5d66` seq 17,
  respondeu "não há arquivo de instrução de agente disponível no contexto".
  O grafo não projetava `psychologist.hypothesis_accepted`.
- **O caminho de leitura do grafo não tinha consumidor:**
  `QueryUserContextUseCase` existia (hipóteses, perfis, handoffs por usuário e
  projeto) e nenhum código o chamava.
- `ANAMNESE_ENABLED` tinha default `false` no `runtime.exs` e nos três
  composes desde a RN-540; o relatório registra o engine do uso real com a
  flag `true` por ambiente.

## Decision

1. **A rodada não roda sem sujeito elegível.** `Engine.Anamnese.Elegibilidade`
   decide ANTES da triagem, sem exceção (nem a fila de hipóteses a atravessa):
   sujeito é o membro EFETIVO do projeto, fora do opt-out, com interação
   PRÓPRIA no que o prompt mostra — evento `actor_kind: "user"` dele na janela,
   ou decisão dele. Sem sujeito: nenhuma chamada ao LLM, nenhuma busca no RAG,
   motivo nomeado no log do engine (`sem_sujeito_elegivel`, com
   `nenhum_membro` ou `nenhuma_interacao_propria` e os números) e, só na rodada
   pedida à mão (`origem: "manual"`), `anamnese.run_skipped` durável. O prompt
   passa a listar só os sujeitos.
2. **Membro do projeto é o membro EFETIVO.** `ProjectRepository` ganha
   `listEffectiveMembers` (`membrosEfetivos`, a régua da RN-471: a linha de
   projeto sobrepõe a de workspace nos dois sentidos), usada pelos três casos
   de uso da Anamnese. `listMembers` continua sendo só `project_members`, que é
   o que a tela de Membros edita.
3. **A hipótese aceita vira FATO do perfil, derivado do event log.** O
   `psychologist.hypothesis_accepted` passa a carregar `projectId`, `sujeito`
   (o autor da sessão analisada), `hipotese`, `sugestao` e `fatoDoPerfil`. O
   `GraphEventTranslator` — o MESMO do projetor e de `grafo:reprojetar` — o
   traduz para `(:FatoDoPerfil {hypothesisId})-[:SOBRE]->(:Usuario)` e
   `-[:NO_PROJETO]->(:Projeto)` (`RecordProfileFactUseCase`, `MERGE` pela
   hipótese, constraint única nova). O evento é autossuficiente: reprojetar
   não lê `psychologist_hypotheses`.
4. **O fato só nasce do clique do próprio sujeito.** `fatoDoPerfil` é `true`
   quando quem aceitou É o autor da sessão. Aceite de terceiro continua
   valendo para tudo o mais (status, fila da Anamnese) e diz no payload por que
   não virou fato (`motivoSemFato`). A recusada não muda: fica só registrada.
5. **O fato entra no contexto dos agentes que conversam com a pessoa.**
   `SendAgentMessageUseCase` lê os fatos do AUTOR da mensagem pelo
   `QueryUserContextUseCase` — escopados ao projeto, os 5 mais recentes, com o
   total ao lado — e os manda ao engine como `perfilDoAutor`, texto montado por
   `textoDoPerfilDoAutor` (2 000 caracteres no máximo, recorte dito). O engine
   os põe no turno pelo MESMO caminho do idioma: o controller junta os dois
   num mapa, `IdiomaDaResposta.com_idioma_do_autor/2` o reconhece, e a fachada
   `EngineApiClient` acrescenta o texto como mensagem `system` EFÊMERA antes da
   orientação de idioma (`Engine.Harness.PerfilDoAutor`). Nenhum servidor de
   agente muda. Grafo fora do ar vira log, e o turno segue sem os fatos.
6. **Religar.** O default de `ANAMNESE_ENABLED` volta a `true` no
   `runtime.exs` e nos três composes (a régua de
   `flags-do-engine-no-compose.spec.ts` continua: compose repete o código).
   `START_ANAMNESE` não muda em lugar nenhum: `true` no código, no dev e na
   instalação; `false` no compose de produção, divergência já declarada.
   `PSYCHOLOGIST_ENABLED` não muda.

## Consequences

- O uso real de 29/09 deixa de gastar: projeto sem sujeito não chega ao LLM.
  E o dono do workspace num projeto sem linha própria passa a SER sujeito —
  a Anamnese religada passa a fazer algo no caso mais comum, em vez de nada.
- **Preço declarado:** a Anamnese agora perfila quem é membro só pelo
  workspace. Um membro de workspace que nunca interagiu no projeto não é
  perfilado (não é sujeito), e o opt-out continua valendo.
- **Preço declarado:** cada mensagem a um agente conversacional faz uma
  leitura a mais no grafo (quatro consultas de `QueryUserContextUseCase`).
  Sem Neo4j configurado, é um `GraphUnavailableError` imediato e um log.
- **Preço declarado:** os fatos chegam a TODO turno do autor, inclusive ao
  agente que não era o alvo da hipótese — o rótulo diz a quem ela se dirigia,
  e filtrar por agente é decisão aberta.
- **Fora, declarado:** os três aceites do uso real foram gravados antes desta
  mudança, sem os campos do fato, e NÃO viram fato na reprojeção. Continuam na
  fila da Anamnese, que os lê na próxima rodada COM sujeito. Turno sem autor
  (kickoff, dev agents, gates) não recebe fatos. O Staff segue sem gatilho
  automático: a Anamnese nunca o disparou em código.
- A rodada pelo tick sem sujeito não vira evento (seria um aviso a cada 15
  minutos por projeto); só a pedida à mão narra.

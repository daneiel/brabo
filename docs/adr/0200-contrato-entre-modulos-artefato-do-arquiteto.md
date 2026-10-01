# 0200 — O contrato entre módulos vira artefato versionado do Arquiteto, e o dev agent o lê em vez do worktree alheio

## Status

**Accepted.** 2026-10-01 (AT-276, história HS-071, épico EP-030, rodada 36;
decisão do dono em 01/10: *"o contrato entre módulos vira artefato versionado
do Arquiteto (no molde de `module_map`/`c4_diagram`), lido pelos devs pela
ferramenta de leitura; mudar contrato é nova versão do Arquiteto"*). Estende o
desenho de artefato sem tabela do [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md),
do [ADR 0068](0068-diagrama-c4-do-arquiteto.md) e do
[ADR 0131](0131-roteamento-de-modulos-para-infra.md); aplica a regra
"agente que escreve tem de poder ler" (RN-164/165) aos dev agents, sob a
leitura contida do [ADR 0060](0060-superficie-de-leitura-de-codigo.md).

## Context

### O sintoma

Uso real de 2026-09-29 (análise `analise-uso-real.md`, item A30, 6(e)):
`dev-board-engine`, seq 1157/1230/1268/1344/1486 — cinco turnos lendo
interfaces nos worktrees de outros módulos. Contra a medição da AT-237
([medicao-do-jev.md](../explanation/medicao-do-jev.md)), esse agente teve 24
passos com ferramenta na rodada inteira: **5 de 24, ~21% dos passos dele**,
foram descobrir interface alheia. O projeto tinha sete módulos de dev
(`piece-catalog`, `retro-renderer`, `input-keyboard`, `game-session`,
`scoring`, `persistence`, `board-engine`).

**O que NÃO foi possível medir aqui:** o custo em tokens desses cinco passos.
O event log de 29/09 vive na instância local do mantenedor (compose
`brabo-dev`) e não está neste ambiente; o número acima vem da análise e da
tabela de agentes da medição do Jev, não de uma consulta refeita. O ganho em
custo é medível depois, pela mesma régua da AT-239 (`token_usage` por ator).

### O que o produto dava ao dev (medido em `dev`, 2026-10-01)

- **O `module_map`** (`domain/architecture/module-graph.ts`) é
  `{name, stack, responsibility, dependsOn[]}`. Ele diz QUEM depende de quem e
  nada sobre O QUE um módulo oferece. Nenhum dos artefatos do Arquiteto
  (`module_map`, `project_image`, `module_routing`, `c4_diagram`) carrega
  interface.
- **O contexto do dev** (`Engine.Dev.ContextBuilder`) traz story, task, regras
  de negócio e ADRs filtrados por módulo — nenhuma interface de vizinho.
- **As ferramentas do dev** (`Engine.Dev.Tools`) eram `read_file`,
  `search_workspace`, `write_file`, `terminal`, `rag_search`/`rag_feedback` e
  as de término: nenhuma leitura de artefato do projeto. A única forma de ver a
  interface do vizinho era o `terminal` lendo o worktree do outro dev — código
  EM ANDAMENTO numa branch que ainda não chegou à `dev`, e que pode mudar
  depois da leitura.

## Decision

1. **O contrato é o artefato `artifact.module_contracts`, do Arquiteto.** Sem
   tabela: o evento é o registro, versionado por `version` no payload, e o
   vigente é o de maior `version` com desempate por `seq` — a mesma redução de
   `GetC4DiagramUseCase`/`GetModuleRoutingUseCase`. Cada declaração leva a
   lista INTEIRA e SUBSTITUI a anterior; mudar contrato é versão nova emitida
   pelo Arquiteto, e as anteriores continuam no log.
2. **O formato é o menor que resolve: por módulo, só o que ele EXPÕE.**
   `{modulo, expoe: [{tipo, assinatura, descricao}]}`, com `tipo` em
   `funcao | rota | evento | dado`, `assinatura` obrigatória (até 300
   caracteres), `descricao` opcional, e de 1 a 40 itens por módulo.
   - **O que ele CONSOME não é escrito no contrato.** É derivado, na leitura,
     do `dependsOn` do `module_map` vigente — o mesmo argumento do nível
     Container do C4 (ADR 0068): o mapa já validou essas arestas sem ciclo, e
     uma segunda lista escrita à mão divergiria dele no primeiro mapa revisado.
     A granularidade "quais itens de X o módulo Y usa" ficou de fora: o
     Arquiteto não a sabe antes da implementação, e quem consome X lê a lista
     inteira do que X expõe.
   - **`tipo` é enum e `assinatura` é texto livre.** O tipo é o que muda a
     forma de USAR o item; a assinatura não cabe num schema único porque a
     stack de cada módulo é livre (uma função Elixir e uma rota Go).
   - **Os tetos existem porque o contrato vai ao contexto de todo dev.** Um
     contrato que vira a documentação inteira da API custaria em cada passo o
     que a leitura do worktree custava num.
3. **Artefato SEPARADO do `module_map`, nunca um campo a mais nele.** O mapa é
   tabela, é lido pela execução inteira (claim de task, roteamento, C4) e
   revisá-lo reabre a validação de ciclo. O contrato muda noutro ritmo — a
   interface se descobre enquanto os devs trabalham —, e revisar um não pode
   reemitir o outro nem disputar o schema dele com outra frente (a lane de
   recursos da rodada 36 acrescenta campo ao `module_map`).
4. **O Arquiteto ganha `declare_module_contracts`** (`:direct`, como
   `route_modules_to_infra`: declaração de arquitetura, sem efeito externo,
   nunca `proposed_action`). A api valida e recusa com o motivo inteiro, que
   volta ao modelo (RN-061): módulo fora do mapa vigente (listando os
   válidos), sem `module_map`, módulo repetido, `expoe` vazio ou acima do teto,
   `tipo` desconhecido, `assinatura` vazia ou longa demais. O kickoff dele
   ganha o passo 5; a ferramenta entra em
   `Engine.Harness.IdiomaDaResposta.ferramentas_de_artefato/0` (RN-623).
5. **O dev agent ganha `listar_contratos_de_modulos`** (`:direct`, no registro
   de `Engine.Dev.Tools`, fora do global). Leitura CONTIDA: escopo fechado no
   projeto pelo caminho da rota (`GET internal/projects/:projectId/module-contracts`),
   NENHUM parâmetro, e o módulo do dev vem do contexto do laço (`ctx.module`,
   posto por `DevAgentServer`), nunca do modelo. Com o módulo conhecido, ela
   mostra por inteiro só o dele e os que ele consome; quem o consome e os
   demais aparecem pelo nome. Teto de 120 itens no texto, com o que ficou de
   fora dito. Contrato de módulo que saiu do mapa é DITO, nunca atribuído.
6. **O kickoff do dev diz que o contrato existe e onde lê-lo**, e que a
   interface de outro módulo não se lê no worktree dele. Sem contrato para o
   módulo de que ele precisa, a ferramenta diz o que fazer: implementar pelo
   que a story e a task dizem e, se a task depende de interface que não
   existe, `report_blocked` nomeando o módulo e o que falta — para o Arquiteto
   declarar. Não manda reler o worktree.

## Consequences

- **O passo que o dev gastava descobrindo interface vira uma leitura de custo
  constante**, e o que ele lê é a versão que o Arquiteto fixou, não o código
  em andamento de outro dev.
- **A interface passa a ter dono e versão.** Quem a muda é o Arquiteto, numa
  versão nova; o dev que precisa de uma mudança não a faz no código do
  vizinho, bloqueia nomeando o que falta.
- **Não é trava.** Nada impede o `terminal` de ler outro worktree: a
  ferramenta e o kickoff mudam o caminho que o dev conhece, não proíbem o
  outro. Fechar a leitura de worktree alheio seria contenção de caminho (ADR
  0055), outra frente.
- **O Arquiteto ganha um passo** no kickoff, sob o MESMO teto de 14
  iterações. Não medido se cabe junto dos outros sete numa arquitetura grande;
  esgotar o teto continua narrado (`toolloop.limit_reached`, RN-166).
- **Projetos sem contrato seguem funcionando**: a leitura devolve o mapa com
  `expoe: null` em cada módulo e o aviso. Nenhuma migração, nenhuma tabela.
- **A pasta `docs/` dos artefatos (ADR 0148) ganha o tipo** como versionado:
  o vigente sobrescreve o mesmo arquivo, como os outros quatro.
- **Fora daqui, declarado:** tela própria (o contrato aparece na timeline e na
  pasta `docs/`, não na aba Arquitetura); o efeito no ganho do Jev (AT-239
  mede ferramenta por passo; esta muda o cardápio do dev, e
  `scripts/jev/catalogo.json` é a fotografia de 29/09, não regenerada aqui);
  os testes ExUnit rodaram fora do `mix` (o `repo.hex.pm` dá 403 neste
  ambiente) — o CI os prova.

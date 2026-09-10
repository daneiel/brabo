# 0148 — Os artefatos dos agentes projetados em arquivo, numa pasta `docs/`

## Context

Todo artefato que os agentes produzem — o brief do Criativo, as regras de
negócio do PO, o diagrama C4 e o roteamento de módulos do Arquiteto, as
decisões dos seis conversacionais — vive **exclusivamente no event log**.
`Engine.Harness.Tools.EmitArtifact` (`apps/engine/lib/engine/harness/tools/emit_artifact.ex:3-5`)
é explícito: *"não há tabela de artefatos"*. O artefato É o evento
`artifact.<tipo>`, imutável, com autor e `seq`.

Isso é a decisão certa para a FONTE, e não se mexe nela aqui. O problema é
outro: **essa memória não chega a lugar nenhum que uma pessoa abra.** Ela é
legível pela timeline da sessão, uma linha por vez, dentro do produto. Quem
abre a pasta do projeto no editor — que é onde o código vai estar — não
encontra nada do raciocínio que produziu aquele código.

O buraco ficou maior com a decisão de **adiar o git** (RN-521/RN-522): entre a
criação do projeto e o handoff do Arquiteto ao Dev Lead, o projeto existe sem
repositório nenhum. Nesse intervalo, tudo o que o produto acumulou sobre o
projeto está em linhas de banco, e a pasta do usuário está vazia.

Existe um precedente exato no produto para resolver isso, e ele já foi
discutido e aceito: o **grafo Neo4j**
([ADR 0099](0099-neo4j-grafo-de-conhecimento-e-templates.md)/[ADR 0101](0101-memoria-relacional-como-projecao-do-event-log.md)),
que é declaradamente memória **derivada** do event log — nunca fonte, podendo
ser descartada e reconstruída. `GraphProjector`
(`apps/api/src/application/graph-projection/graph-projector.ts`) drena
`outbox_events` sob um `aggregate_type` próprio e escreve num destino externo,
degradando sem nunca derrubar quem o alimenta.

A pergunta desta decisão não é *se* a pasta deve existir — o dono do produto
pediu, literalmente, *"criar apenas uma pasta por ora chamada docs, onde os
artefatos estarão de cada um dos agentes"*. É **com que mecanismo**, e o que
isso obriga a garantir.

## Decision

**A pasta `docs/` é uma PROJEÇÃO do event log, no mesmo sentido estrito que o
ADR 0101 deu ao grafo.** A fonte continua sendo o evento; a pasta pode ser
apagada inteira e reconstruída; e **nada no produto lê dela** para decidir
coisa alguma. Ela existe para ser aberta por uma pessoa.

Disso decorre tudo o mais.

### 1. O mecanismo é o do `GraphProjector`, peça por peça

`ArtifactProjector`
(`apps/api/src/application/artifact-projection/artifact-projector.ts`) copia a
forma que já resolveu este problema: poller próprio (`setInterval` com
`.unref()`, limpo em `onModuleDestroy`), `drainOnce()` público e independente
do timer (é o ponto de entrada dos testes), flag `draining` contra ciclos
sobrepostos, lote de 50, e `markProcessed` **somente após sucesso**.

Não é reuso de código, é reuso de **desenho** — os dois projetores escrevem em
destinos sem nada em comum. Copiar a forma é o que faz um leitor que conhece um
entender o outro sem reler.

### 2. Um `aggregate_type` próprio, `artifact_projection`

`AppendSessionEventUseCase` grava uma **terceira** linha de outbox, na MESMA
transação, para os tipos em `ARTIFACT_PROJECTABLE_EVENT_TYPES`. O
`aggregate_type` é novo pelo mesmo motivo que o do grafo (documentado em
`domain/graph/graph-projection-events.ts:7-26`): `Engine.Outbox.Drain.run_once/0`
só drena `session`, `task` e `container`, e a linha `'session'` que todo evento
já tem é marcada `processed_at` por ele a cada ~2s. Ler o mesmo
`aggregate_type` seria correr contra o dreno do engine e perder quase sempre.

Uma diferença deliberada em relação ao grafo: o `aggregateId` é o **projeto**,
não a sessão. A pasta é do projeto, e o evento de origem só carrega
`sessionId` — gravar o `projectId` aqui poupa o projetor de uma consulta por
artefato para descobrir algo que o caso de uso já tinha em mãos.

### 3. Lista de PERMITIDOS, e quatro tipos deliberadamente fora

`ARTIFACT_PROJECTABLE_EVENT_TYPES`
(`apps/api/src/domain/artifacts/artifact-projection-events.ts`) é lista de
permitidos, e não de excluídos: tipo de artefato novo nasce **fora** da
projeção e entra quando alguém decidir que ele é documento — em vez de aparecer
sozinho numa pasta que o usuário lê.

Ficam de fora `qa_verdict`, `secops_verdict`, `task_blocked` e
`infra_delegation_files`. São **desfechos operacionais**, não documentos do
produto: um veredito de gate por task, num projeto com dezenas de tasks,
encheria `docs/qa-lead/` de arquivos que ninguém abre, e a pasta perderia a
propriedade que a torna útil — caber numa olhada. Eles continuam no event log,
que é a fonte, e continuam na timeline.

### 4. Por agente, e o versionado sobrescreve

O layout é `docs/<agente>/<arquivo>.md`. Navegar a pasta responde *"o que o
Arquiteto produziu?"* sem abrir nada.

Os quatro tipos **versionados** (`module_map`, `module_routing`,
`project_image`, `c4_diagram` — os que são lidos por redução ao maior
`version`, ver `obter-container-do-projeto.use-case.ts:22-25`) escrevem sempre
o **mesmo arquivo**, sobrescrevendo: a pasta mostra o VIGENTE, e o histórico
continua inteiro no event log. Projetá-los como arquivo por versão produziria
`c4-diagram-v1.md`, `c4-diagram-v2.md` e faria quem abre ter de descobrir qual
vale — exatamente o trabalho que a redução por `version` existe para poupar.

Os demais são append-only por natureza (uma decisão não substitui a anterior:
as duas aconteceram) e cada um vira arquivo próprio, com o `seq` do evento no
nome. O `seq` é gapless por sessão e já ordena o event log, então é o desempate
que não exige estado novo — e **sem ele** dois artefatos do mesmo tipo com o
mesmo título gerariam o mesmo arquivo, e o segundo apagaria o primeiro: a única
forma de esta projeção perder informação que a fonte tem.

### 5. Duas barreiras contra o filesystem, e a segunda não é redundante

O nome do arquivo é derivado do **título que o modelo escreveu** — entrada não
confiável em toda a extensão do termo. A defesa não é escapar o que veio, é
**derivar um nome novo de um alfabeto fechado**: `slugDeArquivo` não tem
caminho de retorno em que um separador sobreviva, e devolve `null` quando não
sobra nada (nome vazio colidiria com todos os outros nomes vazios).

`FsArtifactFileStore` checa **de novo**, com `relative()`, antes de abrir o
arquivo. Não é paranoia: as duas respondem perguntas diferentes — a primeira é
*"que nome eu derivo disto"*, a segunda é *"o que eu vou de fato abrir"*.
Confiar só na primeira faria a segurança desta escrita depender de nenhuma
futura mudança de slug jamais deixar passar um separador, que é precisamente a
forma de contenção que o [ADR 0130](0130-broker-de-container.md) recusa por
princípio: a que depende de o chamador estar correto.

### 6. Em modo `runner`, a pasta desvia para a raiz gerenciada

`pastaDeArtefatosDoProjeto`
(`apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`) é irmã de
`permissionsFilePath` e faz o **mesmo desvio**, pela mesma razão física: quem
escreve é a api, de dentro do container dela, e um projeto `runner` é
deliberadamente sem bind-mount. O canal do runner (`exec`/`exec_result`) só
transporta COMANDO — não existe primitiva de escrever conteúdo em arquivo —,
então nem delegar a escrita resolveria sem inventar um mecanismo novo.

### 7. A escrita NÃO passa por `proposed_action`

E não é omissão. `proposed_action` é a origem de todo efeito externo **de um
agente pedindo para agir**. Aqui não há agente pedindo nada: o artefato já foi
emitido e já está no event log quando esta classe roda. O que acontece depois é
o **sistema** materializando, num caminho derivado, uma cópia legível de algo
que já é fato.

Fazer a projeção passar pela fila de aprovação teria o efeito oposto ao
pretendido: encheria a fila de decisões rotineiras — uma por artefato — e
corroeria justamente o teto que dá sentido ao clique nas ações que **são**
efeito externo.

## Consequences

O usuário passa a ter, na pasta do projeto, uma pasta `docs/` organizada por
agente com o raciocínio que produziu o código. Ela aparece antes do git existir
(RN-521/RN-522), que é justamente o intervalo em que hoje não há nada em disco.

**A projeção nunca derruba a fonte.** Nenhum throw escapa do `drainOnce`: cada
item falha isolado, fica logado e permanece `processed_at IS NULL` para o ciclo
seguinte. Disco cheio, permissão negada ou pasta inalcançável não podem impedir
um artefato de ser EMITIDO. `outbox_events` não tem `attempts` nem
dead-letter — o retry é implícito e infinito, exatamente como o do grafo.

**Diferença deliberada em relação ao `GraphProjector`:** não há aqui um
equivalente ao `GraphUnavailableError` que pare o lote inteiro. Uma falha de
escrita costuma ser do ITEM (um nome estranho, um projeto cuja pasta sumiu), e
não do destino; parar o lote por causa de um item bloquearia todos os que
estivessem atrás dele.

**Evento que sumiu do event log é marcado processado, não retentado para
sempre** — retentar o que não existe mais não teria efeito nenhum, e a linha
ficaria na fila indefinidamente.

**Custo declarado 1: em modo `runner`, `docs/` não fica ao lado do código.**
Quem abrir a pasta do projeto na própria máquina não vai encontrá-la; ela está
em `<PROJECT_WORKSPACES_ROOT>/<workspace_dir_name>/docs/`. É uma perda REAL
neste modo, porque a pasta existe justamente para ser aberta junto do código. O
que ela evita é a alternativa pior: a projeção simplesmente não acontecer, ou
falhar em silêncio a cada artefato.

**Custo declarado 2: o Markdown é genérico.** O arquivo tem um cabeçalho (tipo,
agente, quando, `seq`) e o payload como bloco JSON. Não há renderizador por
tipo — seriam treze lugares para envelhecer quando um schema mudasse, e o que
esta pasta precisa entregar é conteúdo legível e rastreável, não diagramação.
Um formato mais rico por tipo é decisão própria, quando houver uma leitura real
pedindo por ela.

**Custo declarado 3: a pasta pode divergir do event log entre um ciclo e
outro**, e depois de uma falha persistente pode ficar incompleta indefinidamente
sem que nada avise. É o mesmo custo que o grafo já aceita, e é tolerável pela
mesma razão: a fonte está intacta e a projeção é reconstruível. **Não existe
hoje comando de reprojeção** — apagar `docs/` não a reconstrói, porque as
linhas de outbox já estão marcadas. É a mesma lacuna que o **BRB-018** já
registra para o grafo, agora com um segundo consumidor.

**O que este ADR NÃO toca.** `decide.ts` e os tetos absolutos; `proposed_action`
como origem de todo efeito externo de agente (ver ponto 7 — a projeção não é um
deles); a imutabilidade do event log; os schemas de artefato do engine, que não
mudam em nada; e o portão da imagem
([ADR 0135](0135-portao-de-imagem-nos-tres-modos.md)).

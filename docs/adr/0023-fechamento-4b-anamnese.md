# ADR 0023 — Fechamento da Fase 4b (sessão 2): catálogo que funciona, dedup que distingue quem negou, e fila que sobrevive à rodada

- Status: aceito
- Data: 2026-07-26
- Fase: 4b (fechamento da sessão 2 — a Anamnese em si é o ADR 0016)

## Contexto

O ADR 0016 entregou a Anamnese: scheduler por projeto, `proficiency_profiles`
com evidência, catálogo derivado do `module_map`, `instruction_patch` como
`proposed_action` com diff LCS, versionamento append-only com rollback pra
frente, fila fechando o loop, e as duas seções de UI. Nada disso foi desfeito.

Faltava o passo que a sessão 1 recebeu no ADR 0022: rodar o critério de aceite
e fechar o que só aparece rodando. A auditoria dos três apps achou ~28
desvios — sete quebravam o critério, um item do enunciado nunca foi
implementado, e o critério **nunca tinha sido executado** (não havia
`demo:anamnese`, nem forma de rodar uma rodada sob demanda).

## Decisões

### 1. O catálogo tem que tokenizar stack composta — era isto que travava tudo

`deriveCatalog` punha a `stack` do `module_map` inteira como UMA competência.
Só que `ModuleMapModule.stack` é UMA string de texto livre escrita pelo
Arquiteto (via LLM), e na prática lista várias tecnologias. Com
`stack: "NestJS + Drizzle + Postgres"`, o catálogo ganhava a competência
`"nestjs + drizzle + postgres"` e a emissão natural (`"nestjs"`) caía fora —
e como `validateProficiencyBatch` rejeita o LOTE INTEIRO, a rodada não
gravava perfil nenhum.

A consequência era pior que "um perfil a menos": só `emit_proficiency` dá halt
no ToolLoop, então a rodada nunca concluía, nunca gravava `anamnese_runs`, e a
janela era reprocessada indefinidamente. **A Anamnese não funcionava em nenhum
projeto realista.** O teste existente só exercitava o caso idealizado de token
único (`deriveCatalog(['NestJS'])`), que é justamente o que um humano
escreveria e um LLM não.

`deriveCatalog` passou a quebrar em `+`, `,`, `/` e `&`, adicionando cada token
E a frase inteira (quem escreveu `"Node.js"` — um token com ponto — não pode
deixar de valer). Token de 1 caractere é descartado: alargar o catálogo com
ruído é exatamente o que o guarda-corpo não pode fazer, e há teste explícito de
que tokenizar **não** afrouxa a rejeição dos atributos sensíveis.

Dois defeitos vizinhos, do mesmo caminho de escrita:

- a competência era gravada CRUA, e o unique é `(project, user, competency)` —
  `"NestJS"` e `"nestjs "` criavam duas linhas pra mesma coisa. Agora grava
  normalizada.
- duas entradas pro mesmo `(userId, competency)` no lote batiam em
  `ON CONFLICT DO UPDATE command cannot affect row a second time` (o upsert é
  um comando só), virando 500 opaco em vez de tool-result corrigível. Agora é
  rejeição com mensagem que diz o que fazer.

### 2. Negação de POLÍTICA não é negação do usuário

"negação registra para não repropor igual" fala da decisão do **usuário**. Mas
o dedup filtrava só `status === 'denied'`, e `ProposeActionUseCase` grava esse
mesmo status **sem decisor** quando o `decide` recusa por papel abaixo de
`maintainer` ou por `permissions.json`. Resultado: um patch barrado por
política ficava condenado pra sempre — o humano nunca viu o diff, e nem
corrigindo o papel dava pra propor de novo.

Passou a exigir `decidedBy !== null`. É uma linha, e é a diferença entre "o
usuário disse não" e "o sistema não deixou nem mostrar".

### 3. Consumo da fila é consequência do patch existir

`emit_proficiency` mandava `consumedQueueIds: ctx.queued_ids` incondicionalmente
junto dos perfis. Uma rodada que lia a hipótese aceita e **não** propunha patch
queimava a entrada da fila, e nada re-enfileirava: o critério "aceito uma
hipótese e vejo o patch seguinte referenciá-la" falhava em silêncio e não se
recuperava nunca.

Invertemos a responsabilidade: o engine não mexe mais em id de fila, e
`ProposeInstructionPatchUseCase` marca a entrada consumida quando o patch que
a referencia NASCE, na mesma transação. Uma hipótese lida e não usada continua
pendente pra próxima rodada.

Por que consumir na PROPOSTA e não na aprovação: a hipótese cumpriu seu papel
quando virou um patch que o humano pode avaliar. Se o usuário negar o patch,
quem impede a repetição é o dedup (decisão 2) — re-enfileirar levaria a
propor o mesmo patch pra sempre.

Consequência de contrato: `consumedQueueIds` saiu do DTO interno, e
`markConsumed(ids)` virou `markConsumedByHypothesis(projectId, hypothesisId)`.
O `projectId` no filtro fecha de passagem um furo cross-tenant: a versão antiga
era `inArray(id, ids)` sem escopo, então uma chamada podia marcar consumida a
fila de outro projeto.

### 4. `hypothesisId` é validado nas duas pontas

Nem o engine (contra as hipóteses da rodada) nem a api (contra o projeto)
validavam o id. Um id alucinado atravessava até
`agent_instruction_versions.source_hypothesis_id` e a rastreabilidade
hipótese→patch→versão apontava pra nada.

O engine rejeita `hypothesisId` fora de `ctx.queued_hypothesis_ids`, com a
mensagem voltando pro modelo corrigir no turno seguinte (mesmo idioma da
rejeição de evidência do Psicólogo); a api revalida que a hipótese existe e é
do projeto. Note que o ctx passou a carregar ids de HIPÓTESE, não de linha de
fila — o que o prompt oferece ao modelo e o que o patch precisa carregar são a
mesma coisa.

### 5. "comandos que aprova/nega" entra na janela — revertendo o deferimento do 0016

O item 1 do enunciado lista quatro sinais: linguagem, correções nos agentes,
**comandos que aprova/nega**, e nível das perguntas. Os três primeiros estão no
event log; o quarto vive em `proposed_actions.decided_at`, e o ADR 0016:170-174
deferiu a leitura ("evolução natural do contexto"). Um de quatro sinais fora,
por desenho.

Novo `listDecidedInWindow(projectId, from, to)` — só decisões com decisor
humano, na mesma janela que o engine usa pro log — alimenta um campo
`decisions[]` no contexto, e o prompt ganhou seção própria com o
`rejectionReason`. **O motivo de uma negação é o sinal mais rico da janela**:
diz o que a pessoa achou errado, com as palavras dela ("nunca use push
--force, gere migration" vale mais que dez mensagens de chat).

`Triage.should_run?` passou a contar decisões junto dos eventos: uma janela em
que o usuário só aprovou e negou ações É material, e era descartada como vazia.

### 6. Evidência de perfil é de escopo de PROJETO — a UI precisava resolver a sessão

O chip de evidência navegava sempre pra `useLatestSession(projectId)`. Mas a
janela da Anamnese atravessa várias sessões (ADR 0016 decisão 10), então
qualquer evidência de sessão antiga caía em "evento não encontrado nesta
sessão". É o MESMO defeito que o ADR 0022 decisão 1 fechou pro Psicólogo,
repetido aqui — e `ProficiencyProfile` não tem `sessionId` pra corrigir no
cliente.

Novo `GET /projects/:projectId/events/:eventId` sobre `GetProjectEventUseCase`:
diferente do endpoint por sessão da sessão 1, aqui a sessão é a **resposta**,
não a validação. O chip resolve e então navega. O rótulo do evento fixado no
`SessionPage` deixou de dizer "citado pela hipótese" — agora chega de duas
origens.

### 7. Privacidade: cada um vê o seu; quem administra vê o time

`GET /proficiency` era `viewer` e devolvia o perfil de TODOS os membros
(competência, nível, os porquês, evidências). Pior: o delete exigia
`developer`, então um `viewer` era perfilado e tomava **403 pra apagar o
próprio perfil** — furando o "todo o perfil visível e apagável pelo usuário".

Perfil de competência é dado sobre a pessoa, então o default é ela ver o dela:
`owner`/`maintainer` recebem a visão agregada (útil pra alocar trabalho),
qualquer outro papel recebe só o próprio, pelo `listByUser` que existia e era
código morto. Delete e opt-in passaram a exigir só `viewer` — ser membro.
Descartamos "ninguém vê o de ninguém": deixaria a tela vazia pra quem
administra, sem ganho real de privacidade dentro de um projeto que a pessoa
escolheu integrar.

Dois furos menores do mesmo guarda-corpo: a evidência não era escopada por
projeto (`findById` sem checar projeto, enquanto a mensagem prometia "deste
projeto"), e `delete` + `opt-out` eram dois awaits soltos — um crash entre eles
deixava o perfil apagado e re-derivável, ou seja o apagar teria sido cosmético
do mesmo jeito. Agora é uma transação.

### 8. Rodada sob demanda, porque 15 minutos não é testável

A única forma de uma rodada acontecer era o tick do scheduler. `POST
/projects/:projectId/anamnese/run` (engine + api, `maintainer` pela mesma razão
da reanálise do Psicólogo: roda o ToolLoop e gasta orçamento) fecha a
assimetria e é o que torna o critério de aceite executável. Projeto sem sessão
responde 409 — não há log pra analisar nem onde narrar, igual ao caminho
periódico.

### 9. Paridade com o que a sessão 1 endureceu

A Anamnese tinha, um por um, os mesmos defeitos que o ADR 0022 fechou no
Psicólogo:

- `perform` devolvia `:ok` na falha de contexto, com comentário dizendo que
  deixava o Oban retentar — `:ok` marca `completed`, então a rodada do projeto
  sumia em silêncio e `max_attempts: 3` era peso morto.
- `reason_for({:ok, ctx})` ignorava `ctx.last_error`. Era a **única** dos
  quatro call sites (QA, Dev, Psicólogo, Anamnese) fora do padrão: provider
  caído virava "encerrou sem emitir perfis".
- a janela ia numa mensagem `:pinned` (que o `ContextManager` não pode
  compactar, de propósito — os event ids da evidência têm que sobreviver) com
  500 eventos e `inspect(payload)` sem truncagem, contra um `context_window`
  fixo. Ganhou teto de eventos por config, payload truncado, e nota de omissão
  VISÍVEL pro modelo (ele só pode citar ids que vê). De passagem, o
  `created_at` — que era coletado e descartado — entrou na linha do evento:
  "nível das perguntas" é análise de tendência, e tendência precisa de tempo.
- todos os tetos eram atributos de módulo. Foram pro `runtime.exs` e pro
  compose com os valores atuais como default.
- o `ActionPipeline` estava registrado em `:pre_tool_use` sendo no-op
  permanente (nenhuma tool da Anamnese é `terminal`/`write_file`).

### 10. Um diff, uma aparência

`--diff-add`/`--diff-del` são especificados em `design/COMPONENTS.md:127` e
**não existiam** em `design/tokens.css`. O `ApprovalCard` usava
`var(--diff-add, #0e2e24)` e portanto sempre caía no hex hard-coded; o
histórico de versões, escrito depois, inventou cor de TEXTO em vez de fundo. O
mesmo patch tinha duas aparências dependendo de onde você olhasse. Os tokens
foram definidos nos dois temas (o par do spec é calibrado pro escuro) e os dois
lugares passaram a usar o mesmo idioma.

Também: apagar o perfil ganhou confirmação via o `ui/Modal` que já existia (é
irreversível e um clique cru era demais), rollback e opt-in ganharam estado de
pending (duplo clique criava duas versões), opt-in passou a invalidar a query,
e o card de patch renderiza todos os arquivos — não só `files[0]`, enquanto o
branch de `git_commit` ao lado sempre loopou.

## Verificação executada

`pnpm --filter api demo:anamnese` — o script separa explicitamente o que é
determinístico (catálogo tokenizado, guarda-corpo, fila só consumida com patch,
patch→aprovação→versão com `sourceHypothesisId`→rollback que volta o conteúdo
criando outra versão, dedup por decisão humana, opt-out impedindo
re-derivação) do que depende do modelo (a rodada gravar perfil com evidência
resolvível e propor o patch). Sai com código 1 listando o que falhou.

Suites: engine 250, api 500, web 105 — todas verdes. Os testes que faltavam
incluem os primeiros de web da Anamnese (a sessão 1 ganhou os dela no ADR 0022;
esta não tinha nenhum) e dois que guardavam garantias sem cobertura: o teto de
"`instruction_patch` nunca é auto-aprovável" no `decide.ts` — mesma classe da
trava de merge, que tem quatro testes — e o `ExecuteInstructionPatchUseCase`,
único executor sem spec, passado como `undefined as never` nos testes vizinhos.

## Escopo & assunções

Fora deste fechamento: sincronizar a união `ActionType` do web com os 12 tipos
do backend (débito pré-existente, ADR 0016); rebuild de prompt em GenServer
conversacional vivo; índice em `session_events` pra janela por projeto; edição
manual de instrução pela UI; índice em `source_hypothesis_id` e a consulta
reversa (hipótese → versões), que ninguém pede ainda.

A `apply` do patch continua rodando fora da transação que atualiza a ação
(`ExecuteInstructionPatchUseCase`): um crash exatamente entre as duas deixa a
instrução patchada com a ação em `approved`. Fica registrado porque é real,
mas o conserto pede repensar a fronteira transacional de TODOS os executores
(o de infra e o de git têm a mesma forma), e fazer isso só aqui criaria
inconsistência entre irmãos.

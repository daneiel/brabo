# 0142 — A validação do workspace montado é adiada até a materialização

## Context

O [ADR 0141](0141-base-unica-dos-projetos-montados.md) decidiu ONDE um projeto
`mounted` mora — dentro de `BRABO_PROJECTS_BASE`, uma base única montada por
identidade em `api` e `engine` — e deixou explicitamente para o PR seguinte a
outra metade: **quando** essa pasta passa a existir, e quem verifica que ela
serve.

O requisito que força a pergunta é do dono do produto, e é literal:

> se for `Pasta montada`, o bind-mount deve ser criado **APÓS a decisão do
> arquiteto**.

O código de hoje torna isso impossível. `validarCaminhoDeWorkspaceLocal`
(`project-workspaces-root.ts`) roda na CRIAÇÃO do projeto e faz três perguntas
de disco — a pasta existe? é um diretório? o processo consegue escrever nela? —
e recusa com 400 quando qualquer uma falha (RN-170/RN-422). A criação de
projeto é a PRIMEIRA tela do fluxo; a decisão do Arquiteto (`project_image`,
`module_map`, `module_routing`) acontece muitas sessões depois. Exigir a pasta
pronta na criação é exigi-la antes de existir decisão nenhuma.

E o problema não é hipotético nem estético. É o que separa `mounted` de ser
escolha de primeira classe: o assistente de criação sugere
`<base>/<slug do nome>`, e uma pasta sugerida por nós é, por construção, uma
pasta que ainda não existe.

O modo `runner` já resolveu exatamente esta tensão, e resolveu bem (RN-423, ADR
0104): ele valida só o LÉXICO na criação — absoluto, sem `..`, fora de pasta de
sistema, sem sobrepor o checkout do Brabo — e deixa o disco para quem tem
autoridade sobre ele, o CLI conectando na máquina do usuário. A diferença entre
os dois modos nunca foi *o que conta como caminho válido*; foi **quando e quem**
confirma a parte de disco.

## Decision

**`mounted` passa a validar só o LÉXICO mais a base na criação, e a pasta é
MATERIALIZADA quando alguém com autoridade sobre o disco precisa dela.**

### Na criação e na conversão: léxico + base, zero I/O

`validarExecutionModeEWorkspacePath` deixa de tocar disco no ramo `mounted`.
O que ela passa a exigir são duas coisas:

1. o mesmo predicado léxico de `runner` (`caminhoDeWorkspaceLocalValido`), que
   vale para sempre e por isso também roda em toda leitura;
2. estar dentro de `BRABO_PROJECTS_BASE` (`dentroDaBaseDeProjetos`, ADR 0141).

A segunda não é rigor extra: a base é a única pasta do computador que os
containers da api e do engine enxergam, então um caminho fora dela produz
exatamente o projeto que trava depois — que é o defeito que a validação da
criação existe para impedir. Sem base configurada, o modo **não está disponível
nesta instalação**, e a recusa diz isso em vez de fingir que o caminho é que
estava errado.

O projeto nasce, como o `runner`, com `workspaceVerifiedAt: null`.

### `materializarWorkspaceMontado`, e os dois lugares que a chamam

A verificação adiada volta a acontecer numa função só, `mkdir -p` mais as três
perguntas de disco de sempre, com a recusa por estar fora da base ANTES do
`mkdir` — senão um caminho gravado por fora do produto faria a api criar pasta
em qualquer lugar que ela alcança.

**1. `ExecuteContainerStartUseCase`** — o lugar normal. Quando a Infra sobe o
container de um projeto `mounted`, a pasta é criada, provada gravável, e
`workspace_verified_at` é carimbado pelo mesmo caminho que
`ConfirmProjectWorkspaceUseCase` usa. É aqui que o requisito "após a decisão do
Arquiteto" se cumpre literalmente: `container_start` só existe depois de haver
imagem decidida.

Falhar nisso é `failed` **NOMEADO**, nunca throw, nunca 500 — mesma disciplina
que `BrokerIndisponivelError`/`RunnerNaoConectadoError` já seguem no mesmo
arquivo —, e o ciclo de vida **não** chega a ser marcado `provisioning`. Marcar
`provisioning` e só então descobrir que não dá para escrever deixaria a linha de
`project_containers` afirmando um estado que nunca existiu.

**2. `ConvertProjectExecutionModeUseCase`** — a exceção, e ela é declarada.
Converter um projeto para `mounted` não tem passo de container onde pendurar o
trabalho: é um ato isolado, e logo em seguida ele MOVE o `permissions.json`
para `permissionsFilePath(localNova)`, que em `mounted` é `projectScopeRoot`,
que é a pasta do usuário. Mover arquivo para dentro de uma pasta que não existe
falha. Então a conversão materializa na decisão — antes da transação, para que
uma recusa não deixe transação aberta — e vira 400 com a mensagem que ensina.

### O que NÃO muda, e é a regressão mais fácil de causar aqui

A regra da base **não entra** em `caminhoDeWorkspaceLocalValido`. Esse
predicado roda em TODA LEITURA, por `projectScopeRoot`, em caminho quente:
escopo de terminal (ADR 0055), `permissions.json`, aba Code. Um projeto
`mounted` LEGADO — criado quando o bind-mount era uma linha de compose por
projeto, portanto fora da base — passaria a explodir com
`LocalizacaoDeProjetoInvalidaError` ao ser simplesmente LIDO, sem que ninguém
tivesse tocado nele.

A base é regra de **criação e conversão**, onde há alguém na frente da tela que
ainda pode escolher outro caminho. O **léxico é para sempre**. Há teste de
não-regressão para isso, e um comentário na própria função dizendo por quê.

### Sem migration, e o CHECK do banco fica intacto

`mounted` continua gravando `workspace_path` NÃO-nulo — a sugestão composta,
`<base>/<slug>` —, então
`(execution_mode <> 'container') = (workspace_path IS NOT NULL)` segue
satisfeito byte a byte. **Adiar a VERIFICAÇÃO nunca toca o invariante de
PAREAMENTO**: são perguntas diferentes, e confundi-las seria o caminho mais
curto para uma migration que este ADR não precisa.

## Consequences

**O que fica melhor.** O requisito do dono do produto passa a ser executável: a
pasta de um projeto `mounted` é criada quando o container sobe, e não antes. O
assistente de criação pode sugerir um caminho — o que é o ponto de `mounted`
virar escolha de primeira classe — sem que a sugestão seja recusada por não
existir. E os dois modos com pasta do usuário passam a ter a MESMA disciplina
na criação, o que torna a diferença entre eles (quem confirma o disco) mais
fácil de explicar do que era quando um tocava disco e o outro não.

**A janela entre criar e materializar é real, e é aceita.** Entre a criação do
projeto e a subida do container, `workspace_path` aponta para uma pasta que
pode não existir. Nada quebra por isso — `projectScopeRoot` é léxico,
`permissions.json` degrada para `EMPTY_PERMISSIONS_FILE` (que é
`require_approval` em tudo, o lado seguro) —, mas a tela precisa DIZER, e é o
que a ressalva "a pasta é criada quando o container subir" faz, no PR da
prontidão do container. Uma tela que mostra um caminho sem dizer que ele ainda
não existe é uma tela afirmando o que não sabe.

**O erro chega mais tarde, e por isso precisa ser mais explícito.** A validação
na criação tinha uma virtude: a recusa acontecia na tela onde a decisão foi
tomada. Agora ela pode acontecer num `container_start` aprovado horas depois, e
por isso o `failed` NOMEIA a variável (`BRABO_PROJECTS_BASE=<valor>`), o
caminho, a causa provável (dono da pasta no host — as imagens rodam non-root,
ADR 0024) e o que fazer em seguida ("aprove `container_start` de novo"). Um
`failed` genérico aqui seria pior que a validação antiga.

**A mensagem antiga MORREU, de propósito.** `comoMontar` ensinava a
acrescentar `- <caminho>:<caminho>` aos serviços `api` e `engine` do
`docker-compose.yml`. Esse remédio custava um restart dos dois serviços por
projeto — todo turno de agente, socket de terminal e chamada de LLM em voo da
instalação — e o ADR 0141 o substituiu por uma base configurada uma vez.
Continuar ensinando o remédio antigo mandaria o usuário derrubar a instalação
para resolver um problema que a base já resolve. Há asserção de teste sobre a
AUSÊNCIA daquele texto.

**`workspaceVerifiedAt` passa a ter dois emissores.** Era só do `runner`
(RN-423). Agora `mounted` também o carimba, na materialização. O campo continua
significando exatamente a mesma coisa — *alguém com autoridade confirmou este
caminho no disco, uma vez* —, e continua NÃO sendo batimento: reconectar não
regrava, e a tela segue dizendo "pasta confirmada em `<data>`", nunca "de pé"
(RN-468). O que muda é a descrição de OpenAPI, que dizia
"`container`/`mounted` never fill this field in" e passou a descrever o código.

**O que este ADR NÃO decide.** Não muda a ramificação de
`ExecuteContainerStartUseCase` entre broker e runner — dar container ao modo
`mounted` pelo BROKER é outro PR, e este toca o arquivo apenas para acrescentar
a materialização acima da ramificação existente. Não mexe em
`caminhoDeWorkspaceLocalValido`, não mexe no `CHECK`, não tem migration, e não
toca o `Engine.Actions.Workspace.ensure!/4` — a lacuna do engine em modo
`runner` segue declarada e aberta no `CLAUDE.md`.

# ADR 0111 — Converter o `execution_mode` de um projeto existente: recusar com dev agent ativo, realocar o `permissions.json`, aposentar a linha do container

- **Status:** Aceito
- **Data:** 2026-08-23
- **Contexto:** fecha o item de backlog "converter o `execution_mode` de um projeto EXISTENTE" (Onda 2 do lote runner/execution_mode, `docs/explanation/backlog.md`), corrige o item 4 do ADR 0104
- **Revisa (sem editar):** [ADR 0104](0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md) (a afirmação do item 4), [ADR 0072](0072-projeto-local-ou-container.md), [ADR 0081](0081-ciclo-de-vida-do-container-tabela-sem-orquestrador.md)

## Contexto {#context}

O ADR 0104 (Onda 1 do mesmo lote) introduziu o `execution_mode` de três
valores (`container`/`mounted`/`runner`) na CRIAÇÃO do projeto e, no item 4,
afirmou como *consequência* — não algo que ele desenhou — que converter entre
os três modos num projeto existente "deixa de exigir recriar o projeto". Essa
frase foi escrita antes de alguém rastrear o que de fato aponta para o escopo
antigo. A própria implementação da Onda 1 descobriu que ela estava errada e
registrou a correção em `backlog.md` em vez de editar o ADR aceito:
`UpdateProjectDto` continua excluindo de propósito
`executionMode`/`workspacePath` (`apps/api/src/interfaces/http/iam/dto/update-project.dto.ts`)
porque três coisas apontam para o par (modo, caminho) antigo e nenhuma delas
acompanha um `UPDATE` puro de coluna:

- o `permissions.json`, escrito fisicamente em `projectScopeRoot(project)` —
  um lugar diferente do sistema de arquivos para cada modo
  (`fs-permissions-file-store.ts`);
- `project_containers` (ADR 0081), cuja única máquina de estados válida
  supõe `execution_mode = 'container'` — `RegistrarTransicaoDeContainerUseCase`
  recusa (400) tocar a linha caso contrário;
- um `Engine.Dev.DevAgentServer` em execução, que captura o `workspace_root`
  UMA vez, no estado do GenServer, no momento da criação do worktree
  (`Engine.Actions.Workspace.ensure_remoto/2` →
  `workspace_dir/1,2` → `Engine.Projects.Project.workspace_dir_name/1`) — o
  gêmeo, no engine, de `projectScopeRoot`. Virar a coluna do banco por baixo
  de um agente vivo não o move; só o PRÓXIMO worktree resolve contra o lugar
  novo.

Este ADR desenha a conversão que a Onda 1 adiou, e fecha a correção
registrada em `backlog.md` — a afirmação do item 4 do ADR 0104 volta a ser
VERDADE, pelo mecanismo abaixo, não editando o texto aceito.

## Decisão {#decision}

### 1. Uma rota dedicada, não um `UpdateProjectDto` afrouxado {#1-a-dedicated-route-not-a-loosened-updateprojectdto}

`PUT /projects/:projectId/execution-mode` (papel `maintainer` — a mesma
gravidade que o CLAUDE.md já atribui a mudar `max_parallel`/orçamento de área:
"mudar o teto é decidir quanto o produto gasta sem pedir"), sustentada por
`ConvertProjectExecutionModeUseCase`. `UpdateProjectDto` continua excluindo os
dois campos, e o comentário dele agora aponta para cá em vez de só descrever a
lacuna. O `PATCH` genérico é uma escrita de coluna; a conversão é uma
ORQUESTRAÇÃO — validar o novo (modo, caminho), recusar com dev agent ativo,
realocar o `permissions.json`, aposentar a linha do ciclo de vida do container
ao sair de `container`, e só então escrever a coluna —, e misturar isso no DTO
genérico faria o caso simples (renomear um projeto) carregar a complexidade do
raro.

### 2. RN-447 — recusar (409) enquanto qualquer dev agent do projeto não estiver ocioso; nunca drenar/migrar {#2-rn-447-refuse-409-while-any-dev-agent-of-the-project-is-non-idle-never-drainmigrate}

O risco de concorrência é real, não teórico: `DevAgentServer` não volta a
resolver o lugar do worktree, então converter por baixo de um agente vivo o
deixaria escrevendo num escopo que o `permissions.json` e a política de
caminho do terminal (ADR 0055) já abandonaram. A checagem lê
`engine.dev_agent_states` direto — entre schemas, no mesmo banco físico, o
mesmo precedente do `onlineAgentCount` da RN-409 — buscando
`status <> 'idle'` em TODAS as sessões do projeto (não no event log de uma
sessão, diferente de `GetSessionPendingWorkUseCase`, que é escopado por sessão
e exigiria consultar toda sessão que o projeto já teve). `idle_tripped` conta
como ativo de propósito, diferente da contagem de online da RN-409: um agente
com o disjuntor aberto ainda segura um `workspace_root` capturado e precisa de
um humano para desbloqueá-lo, mesmo não estando "online" pela definição da
RN-409 — as duas perguntas ("alguém está acompanhando este agente trabalhar"
vs. "alguém tem um ponteiro de escopo que ficaria velho") são diferentes, e a
exclusão de `idle_tripped` da RN-409 não se transfere para cá.

A decisão é RECUSAR e explicar, nunca drenar nem forçar a migração de um
agente vivo — o mesmo padrão "recusar e ensinar" das mensagens de validação de
disco da RN-088/RN-422. Construir um caminho de migração para um agente em voo
significaria ou matar o processo dele no meio da tarefa (perdendo o que ainda
não foi commitado) ou ensiná-lo a resolver o escopo de novo ao vivo, o que
nenhuma outra parte do produto faz também.

### 3. RN-448 — o `permissions.json` é REALOCADO, o conteúdo nunca muda {#3-rn-448-permissionsjson-is-relocated-its-content-never-changes}

`PermissionsFileStore` ganhou `move(from, to)`: lê o arquivo no
`projectScopeRoot` ANTIGO, escreve o MESMO conteúdo no NOVO e então apaga, em
melhor esforço, o arquivo antigo. O conteúdo (padrões `allow`/`deny`/`ask`) não
carrega caminho nem execution_mode dentro dele — é puro histórico de política
("este comando exato foi sempre-aprovado"), então não há nada a reescrever, só
onde o arquivo físico mora. Verificado rastreando `projectScopeRoot` de ponta
a ponta (`project-workspaces-root.ts`): para `mounted`/`runner` ele devolve o
próprio `workspacePath`, tratado como um caminho dentro do sistema de arquivos
do próprio CONTAINER da API — para `runner` isso já é verdade hoje, mesmo sem
conversão, já que não há bind-mount; o arquivo mora fisicamente num caminho
que só coincide em STRING com a pasta real do usuário, desconectado dela. A
conversão não muda essa propriedade existente, só realoca o arquivo de forma
coerente com ela — nenhum tratamento especial para `runner` além de usar
`move()` como em qualquer outro par.

### 4. RN-449 — sair de `container` aposenta a linha de `project_containers` antes de a coluna virar {#4-rn-449-leaving-container-retires-the-project_containers-row-before-the-column-flips}

Se o `execution_mode` é `container` hoje e o destino não é,
`RegistrarTransicaoDeContainerUseCase` leva a linha do ciclo de vida do
container (quando existe uma) a `removed` — passando antes por `stopped`
quando ela está `running`, já que a máquina de estados de
`container-lifecycle.ts` não tem aresta direta `running -> removed` — ANTES de
a coluna `execution_mode` do projeto mudar. A ordem importa: o próprio
`RegistrarTransicaoDeContainerUseCase` recusa (400) qualquer transição num
projeto que não esteja hoje com `execution_mode = 'container'`, então chamá-lo
depois da virada falharia sempre. Entrar em `container` VINDO de
`mounted`/`runner` faz o oposto de nada: nenhum provisionamento automático — o
portão de imagem do Arquiteto (RN-105) e o ciclo de vida normal do container
valem a partir daí, exatamente como para qualquer projeto `container`, nunca
um atalho que pula o portão porque o projeto "já teve código em algum lugar".

### 5. RN-450 — `workspaceVerifiedAt` volta a `null` em toda conversão real {#5-rn-450-workspaceverifiedat-resets-to-null-on-every-real-conversion}

Ele só significa algo para `runner` (RN-423): um carimbo provando que um
runner conectado confirmou o caminho no host real. Qualquer conversão —
inclusive uma que volte a `runner` com o que parece ser o mesmo caminho —
força uma NOVA confirmação, porque o carimbo antigo atesta uma checagem de
caminho que aconteceu sob um par (modo, caminho) DIFERENTE; levá-lo adiante
afirmaria uma confirmação que nunca aconteceu para o estado novo.

### 6. O mesmo (modo, caminho) de hoje é um no-op — por desenho, não por acaso {#6-same-mode-path-as-today-is-a-no-op-by-design-not-by-accident}

Se o par pedido resolve exatamente ao que o projeto já tem, o caso de uso
devolve o projeto intocado: nenhuma checagem de dev agent, nenhum `move` do
`permissions.json`, nenhum reset de `workspaceVerifiedAt`. Reenviar o mesmo
formulário não deveria custar uma varredura de agentes vivos, nem
desverificar em silêncio um projeto `runner` já confirmado.

## Consequências {#consequences}

**O que este ADR NÃO move: o código que já está no disco.** A conversão nunca
copia arquivos entre a raiz de escopo antiga e a nova. Isto deliberadamente não
é uma lacuna que a implementação tenta disfarçar — é consequência de como o
engine já deriva um workspace (`Engine.Actions.Workspace.ensure!/4`,
`apps/engine/lib/engine/actions/workspace.ex`): um diretório de workspace que
ainda não está marcado como pronto recebe `git init` + `fetch` a partir do
repositório BARE do projeto (a fonte de verdade de fato) na próxima criação de
worktree, seja qual for o (modo, caminho) para onde a coluna aponta agora. O
trabalho commitado está seguro — ele mora no repositório bare e é feito
checkout de novo no lugar novo. **Mudanças não commitadas no worktree antigo
abandonado não são migradas nem apagadas — ficam órfãs no lugar**, ainda
fisicamente no disco, na raiz de escopo antiga (recuperáveis à mão, nunca
automaticamente), mas invisíveis ao produto a partir do momento da conversão.
A guarda da RN-447 reduz esse risco (nenhuma conversão enquanto um agente está
ativamente `working`), mas não o elimina: um dev agent `idle` entre tarefas
ainda pode estar sentado sobre um diff não commitado, e nada aqui inspeciona a
limpeza da árvore de trabalho antes de permitir a conversão.

**O que este ADR não constrói:** um jeito de converter o MESMO projeto para um
modo ao qual ele já é plenamente equivalente sem disparar uma marca de
"mudou" — não é necessário, ver a Decisão 6. Ele não toca `UpdateProjectDto`,
não acrescenta migration (`ProjectRepository.update` já aceitava essas três
colunas desde o `ConfirmProjectWorkspaceUseCase` do ADR 0104/RN-423) e não
muda a política de escopo de caminho do terminal (ADR 0055) nem o portão de
imagem (RN-105) além do que a Decisão 4 já diz.

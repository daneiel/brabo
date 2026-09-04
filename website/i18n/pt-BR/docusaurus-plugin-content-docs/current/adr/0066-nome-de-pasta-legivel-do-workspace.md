# 0066 — Nome de pasta legível do workspace

## Status

Aceito.

Este ADR **revisa o [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md)**,
que continua aceito e não é editado. O 0055 introduziu `projectScopeRoot`
como a função ÚNICA que deriva `<PROJECT_WORKSPACES_ROOT>/<projectId>` —
compartilhada porque `permissions.json` e o escopo de terminal (RN-075)
precisam concordar sobre onde a pasta do projeto está. Este documento muda
o QUE entra no lugar de `<projectId>`, preservando a garantia de que as
duas derivações (api e engine) continuam concordando.

## Contexto

A pasta física de cada projeto em disco era nomeada pelo UUID puro
(`<raiz>/3f2b1c8e-0a5d-4f6b-9c1e-2d7a8b3c4d5e/`) — o mesmo `projectId` que
identifica a linha no banco. Navegando a pasta pelo Finder/Explorer (o que
`docs/getting-started.md` passou a permitir, apontando
`PROJECT_WORKSPACES_HOST_DIR` para um caminho real do disco), o usuário via
uma lista de UUIDs sem forma de saber qual pasta era qual projeto sem abrir
cada uma.

O pedido: nome de pasta LEGÍVEL, baseado no slug do projeto, mantendo um id
único. Dois mecanismos foram considerados (ver "Alternativas consideradas");
o usuário escolheu explicitamente **renomear a pasta física** em vez de um
symlink apontando para a pasta UUID intocada.

`PROJECT_WORKSPACES_ROOT` é UMA raiz para a instância inteira,
COMPARTILHADA entre todos os workspaces — dois workspaces podem ter,
cada um, um projeto de slug `api`. Slug sozinho não é globalmente único, e
é isso que torna "id único junto do nome legível" um requisito real, não
capricho.

## Decisão

### 1. `projects.workspace_dir_name` é o nome de pasta, gravado no banco

Nova coluna `workspace_dir_name` (`text`, `NOT NULL`, `UNIQUE`) em
`projects`. `projectScopeRoot` (ADR 0055) passa a receber este valor, e
NUNCA MAIS o `projectId` cru — os dois consumidores que a função protege
(`permissions.json` e o escopo de terminal) continuam derivando a MESMA
raiz porque continuam chamando a mesma função, só que com o argumento
certo.

### 2. Projeto novo nasce com `<slug>-<8 chars do id>`; projeto antigo mantém o UUID

`workspaceDirNameFor(id, slug)` (pura, em
`project-workspaces-root.ts`) compõe o nome — mesma convenção de 8
caracteres que `apps/web/src/lib/session-label.ts` já usa para rótulo de
sessão. `CreateProjectUseCase` passou a gerar o id em CÓDIGO
(`crypto.randomUUID()`, não mais o `defaultRandom()` do Postgres): o nome
da pasta precisa do id ANTES do `INSERT`, e só há duas formas de ter isso —
gerar o id fora do banco, ou fazer duas viagens (inserir, ler o id gerado,
`UPDATE`). A primeira é mais simples e tem precedente no próprio código
(`token-factory.ts`, `emitir-sessao.use-case.ts`).

Projeto criado ANTES desta migração manteve a pasta física que já
tinha: a migração faz `workspace_dir_name = id` para toda linha existente
— o mesmo valor que já era verdade no disco — e **nunca renomeia
diretório nenhum**. Renomear um working tree possivelmente aberto por um
agente ativo é risco real sem necessidade: o projeto antigo continua
funcionando exatamente como funcionava.

### 3. O nome é CONGELADO na criação, nunca recalculado

`UpdateProjectUseCase` permite editar o `slug` depois — e isso não toca
`workspace_dir_name`. A alternativa (recalcular o nome quando o slug muda)
exigiria mover um diretório com working tree e worktrees de agente
possivelmente em uso, e o valor de "congelado" é justamente não precisar
tratar esse caso: a pasta física é decidida uma vez e para sempre.

### 4. Um trigger `BEFORE INSERT` é a rede de segurança, não o caminho principal

`CreateProjectUseCase` sempre grava `workspace_dir_name` explicitamente,
ANTES do `INSERT` — esse é o caminho real. Um trigger
(`projects_workspace_dir_name_default_trg`) aplica o MESMO fallback
(`id::text`) para qualquer `INSERT` que chegue sem o campo. A decisão de
adicionar o trigger — o primeiro em todo o histórico de migrations do
produto — não estava no pedido original, e vale registrar o motivo: mais
de cinquenta specs de teste da api inserem `projects` direto contra o
banco, sem conhecer (nem precisar conhecer) o conceito de nome de pasta.
Sem o trigger, tornar a coluna `NOT NULL` quebraria todas elas, e a
alternativa — editar cinquenta arquivos para inventar um `workspace_dir_name`
plausível em cada um, cuidando de unicidade GLOBAL entre eles — trocaria
uma dívida por outra maior, sem provar nada a mais sobre a feature em si.
O trigger nunca sobrescreve um valor não-nulo: quem grava explícito
continua no controle.

### 5. A engine lê a MESMA coluna, nunca recomputa o nome

`Engine.Projects.Project.workspace_dir_name/1` consulta a coluna
diretamente. `Engine.Actions.Workspace.workspace_dir/1` (que antes era
`Path.join(root, project_id)`, uma função pura) passou a resolver o nome
por essa consulta, com fallback para o `project_id` cru quando a consulta
não encontra linha, quando `project_id` não tem forma de UUID, ou quando a
consulta falha por qualquer motivo (`rescue`/`catch` amplos — degradar é
sempre preferível a propagar uma falha de resolução de CAMINHO para quem só
queria um diretório).

Este é o ponto que garante a invariante do ADR 0055 sobrevivendo à mudança:
api e engine não implementam duas fórmulas que precisam concordar por
acaso — as duas leem a MESMA linha do MESMO banco. Se um dia divergissem,
seria porque uma delas parou de consultar, não porque a fórmula mudou num
lado só.

`workspace_dir/1` **não é hot path**: o laço de ferramentas do dev agent
(`search_workspace`, `write_file`, `read_file`) já recebe
`ctx[:workspace_root]` PRONTO — resolvido uma vez, quando
`Engine.Dev.WorktreeManager.create/3` monta o worktree do agente — e só
cai em `workspace_dir/1` como fallback para os chamadores que hoje não
passam por esse `ctx` (`worktree_manager` internamente,
`instruction_files`, `TerminalExecutor` via `ensure_remoto`). Nenhum
desses roda por chamada de ferramenta.

`Engine.Dev.WorktreeCleanup` (a poda periódica de worktrees órfãos) foi a
exceção que exigiu desenho próprio: antes da RN-109, o nome da pasta ERA o
`project_id`, e varrer o disco (`File.ls(root)`) e tratar cada entrada como
um id era uma leitura válida. Com nome de pasta legível, a pasta deixou de
ser o id, e não há como voltar um para o outro sem consultar. A correção
troca a fonte de iteração: em vez de varrer o disco, consulta
`Project.all_workspace_dirs/0` (todos os `{id, workspace_dir_name}` numa
query só) e usa o `work_dir` resolvido diretamente — nem esta função nem
`WorktreeManager` fazem uma segunda consulta por projeto para descobrir o
nome de novo.

## Consequências

**Aceitas.** Uma coluna nova, um trigger novo (primeiro do produto — ver
item 4), duas funções puras (`workspaceDirNameFor` na api,
`workspace_dir_name/1` no engine) e a extensão de `Workspace.workspace_dir`
de pura para DB-aware-com-fallback. `WorktreeCleanup` trocou a fonte de
iteração de disco para banco — mesmo custo de UMA consulta, nunca por
projeto.

**Fora do escopo.** Renomear a pasta de projeto existente para o formato
legível não está implementado, nem foi pedido: exigiria mover um working
tree possivelmente aberto por agente ativo, e o valor do nome legível é
cosmético, não vale o risco. Quem quiser a pasta legível cria um projeto
novo.

**O que NÃO muda.** RN-075 (escopo de terminal) e RN-092 (leitura de
código, aba Code) continuam apontando para a MESMA pasta que o engine usa
de verdade — é essa concordância, e não a forma do nome, que os dois ADRs
protegem.

## Alternativas consideradas

- **Symlink apontando para a pasta UUID intocada** — menor risco (o
  working tree físico nunca muda de lugar, só ganha um atalho legível ao
  lado). Foi a recomendação inicial. O usuário decidiu explicitamente pela
  outra opção: renomear a pasta de verdade, sem duas entradas por projeto
  no disco.
- **Recalcular o nome a cada mudança de slug** — rejeitada: moveria um
  diretório potencialmente em uso, para um ganho cosmético. "Congelado na
  criação" evita a categoria inteira de bug.
- **Coluna `NOT NULL` sem trigger, com edição de cinquenta specs de teste**
  — rejeitada por custo/risco: cinquenta arquivos editados à mão para
  inventar nomes plausíveis, com o cuidado extra de unicidade GLOBAL entre
  eles, não prova nada a mais sobre a feature do que o trigger já prova com
  três testes.

## Referências

- [RN-109](../business-rules/autenticacao.md#rn-109) — o nome de pasta é congelado na
  criação, e projeto antigo mantém o UUID.
- [RN-075](../business-rules/custo.md#rn-075) — escopo de caminho na política de
  terminal (o que este ADR preserva).
- [RN-092](../business-rules/custo.md#rn-092) — contenção de caminho na leitura de
  código (idem).
- [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) — o
  documento revisado.

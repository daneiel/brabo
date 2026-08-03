# 0049 — Curadoria de modelo por workspace

## Contexto

O [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md)
registrou o problema com todas as letras e não o resolveu:

> **Catálogo por workspace.** Hoje a curadoria é global e o `:workspaceId` da
> rota é só âncora de RBAC — um owner do workspace A ativando um modelo o ativa
> para o B.

Não era teoria. `models.is_active` era **uma coluna para a instalação inteira**.
As rotas de curadoria já eram `/workspaces/:workspaceId/models/*` — mas o
`:workspaceId` nunca entrava na consulta; servia só para o `RolesGuard` ter de
onde tirar o papel efetivo. Quem clicasse "ativar" numa tela decidia por todos
os workspaces da instalação, e a tela não dava nenhum sinal disso.

Três consequências, em ordem de gravidade:

1. **Um workspace liga um modelo caro para o vizinho.** O seletor do outro
   passa a oferecê-lo, e o gasto aparece no orçamento de quem não decidiu nada.
2. **Desligar é igualmente contagioso.** Um owner tirando do seletor um modelo
   que não confia tira também de quem dependia dele.
3. **Não havia como saber quem decidiu.** `is_active` é um booleano sem autor e
   sem data própria.

## Decisão

**O catálogo continua global; a curadoria passa a ser por workspace.**

A separação é a resposta à pergunta "de quem é este dado?":

| dado | dono | onde |
| --- | --- | --- |
| nome, preço, janela, capabilities | o **provider** | `models` (global) |
| `availability` | o **provider**, observado pelo sync | `models` (global) |
| `is_active` — aparece no seletor? | o **workspace** | `workspace_models` |

`workspace_models` é `(workspace_id, model_id)` como chave primária, mais
`is_active` e `curated_by`.

### Por que NÃO duplicar `models` por workspace

A alternativa óbvia — uma linha de `models` por workspace — foi rejeitada:

- Criaria **N verdades sobre o mesmo modelo**. O preço do `gpt-4o` é o mesmo
  para todo mundo; mantê-lo em N linhas garante que elas divirjam.
- Partiria `token_usage.model_id` e `model_bindings.model_id` ao meio: o
  histórico de custo aponta para uma linha de `models`, e duplicá-la exigiria
  reescrever o passado — exatamente o que a
  [RN-044](../business-rules.md#rn-044) proíbe.
- O sync de catálogo passaria a escrever N vezes o que hoje escreve uma.

### Ausência de linha É o desligado

Não existe terceiro estado "nunca decidido" separado de "desligado". Modelo que
o sync descobre simplesmente **não tem linha** em `workspace_models`, e a
leitura o trata como inativo.

Isto preserva a [RN-043](../business-rules.md#rn-043) ("modelo descoberto entra
desligado") **sem coluna nenhuma em `models` para o sync poder atropelar** — o
sync deixou de ter qualquer campo de curadoria no seu upsert. A regra passou de
"o sync escreve `false`" para "o sync não alcança essa decisão", que é mais
forte.

Desligar, porém, é `UPDATE` e não `DELETE`: apagar a linha apagaria junto quem
decidiu e quando. A leitura trata os dois casos como inativo; o registro existe
para quem for auditar.

### A rota do seletor pende do PROJETO

`GET /models` virou `GET /projects/:projectId/models`, e não
`/workspaces/:workspaceId/models`. As três telas que consomem a lista (visão
geral, ajustes e a sessão) estão todas dentro de um projeto e **nenhuma tinha
um workspace na mão**; o `RolesGuard` resolve papel a partir de `:projectId`
igualmente bem. O workspace sai do projeto dentro do caso de uso — uma
tradução, num lugar só, em vez de espalhada pela UI.

### `isActive` saiu da entidade `Model`

`Model` não tem mais `isActive`; quem precisa dele usa `ModelComCuradoria`, um
tipo que **só existe quando há workspace na mão**. O mesmo vale no wire:
`ModelResponseDto` (seletor) e `ModelComCuradoriaResponseDto` (curadoria).

É deliberado que a versão sem workspace não compile: era justamente a
existência de uma leitura global de curadoria que produzia o defeito, e um tipo
é mais confiável que um comentário pedindo cuidado.

## Consequências

- **Migração de dados antes do `DROP`.** A `0034` faz o produto cartesiano de
  `workspaces × models WHERE is_active` e só então derruba a coluna: cada
  workspace existente recebe exatamente o que enxergava até então. `curated_by`
  fica nulo nessas linhas — a decisão veio de uma curadoria global que nunca
  registrou dono, e nulo é mais honesto que atribuí-la ao criador do workspace.
- **Quebra de contrato HTTP.** `GET /models` não existe mais. É a única rota
  movida, e está no CHANGELOG como mudança incompatível.
- **O seed passou a curar.** Sem uma chamada explícita de ativação, os modelos
  existiriam no catálogo e o seletor nasceria vazio — e o binding do workspace,
  logo abaixo no mesmo seed, seria recusado por "modelo desativado".
- **Escopos `agent` e `session` não verificam curadoria.** Os dois não têm
  âncora de workspace: binding de agente é por SLUG global (o `:projectId` da
  rota é explicitamente ignorado hoje). `assertModelIsBindable` recebe `null`
  nesses casos e checa só a disponibilidade. A lacuna é antiga e fica
  **explícita** em vez de ser preenchida com um workspace chutado.

## O que fica para depois

- **Binding de agente por projeto.** Enquanto o escopo `agent` for um slug
  global, a curadoria não tem como alcançá-lo. Resolver isso é mudar a
  semântica do binding, não a da curadoria — e merece decisão própria.
- **Herança de curadoria.** Um workspace novo nasce sem nenhum modelo ligado, e
  hoje alguém precisa ligá-los um a um. Um default de instalação, ou copiar do
  primeiro workspace, resolveria — mas é política de produto, não consequência
  técnica desta decisão.
- **Orçamento por workspace amarrado à curadoria.** Ligar um modelo caro
  continua sendo uma decisão sem teto próprio; os tetos reais seguem sendo
  projeto, sessão e task.

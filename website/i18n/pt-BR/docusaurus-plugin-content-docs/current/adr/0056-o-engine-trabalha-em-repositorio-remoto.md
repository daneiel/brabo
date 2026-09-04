# 0056 — O engine trabalha em repositório remoto

## Status

Aceito — implementado e provado por teste na Fase B do backlog
([RN-076](../business-rules/custo.md#rn-076)).

Uma descoberta da implementação, registrada porque muda o tamanho do problema:
**dois dos quatro consumidores nunca precisaram de credencial**.
`Engine.Gates.Diff` e `Engine.Harness.ProjectContext` só usam o NOME da branch
default — eles paravam em provider remoto por dano colateral de uma função que
devolvia mais do que eles pediam. Separar `default_branch/1` de
`remoto_de_trabalho/1` destravou os dois sem token nenhum.

## Contexto

`Engine.Projects.ProjectRepository.get_local_repo_path/1` devolve
`{:error, {:unsupported_provider, "github"}}` para tudo que não é `local`.
Quatro consumidores dependem dele, e todos param junto:

| consumidor | o que deixa de funcionar |
|---|---|
| `Engine.Dev.WorktreeManager` | o dev agent não tem worktree — não escreve código |
| `Engine.Actions.TerminalExecutor` | sem workspace, todo comando falha |
| `Engine.Gates.Diff` | QA e SecOps não têm o diff que julgam |
| `Engine.Harness.ProjectContext` | o agente monta contexto sem o repositório |

A assimetria é a raiz: a **api** fala com o GitHub por **HTTP** — criou o
repositório, commitou os arquivos do bootstrap, criou as branches — enquanto o
**engine** trabalha no **sistema de arquivos** e só conhece bare repo local.
Um projeto no GitHub faz a metade conversacional e o bootstrap, e para na
metade de construção.

É o que hoje impede a FASE 13b de existir como escrita: ela pede uma execução
medida num projeto ADOTADO do fork via GithubProvider remoto, e essa execução
não tem como chegar ao primeiro comando.

### O que já está pronto e não precisa mudar

`Engine.Actions.Workspace.init_from_bare!/3` faz `git init` + `remote add
origin <origem>` + `fetch` + `checkout`. **Isto já é genérico**: `<origem>`
ser um caminho local é acidente do provider `local`, não do desenho. Trocar a
origem por uma URL resolve o caminho inteiro sem reescrevê-lo.

O que falta, então, não é encanamento de git — é **credencial**.

## Decisão

### 1. O engine pede um remoto de trabalho à api, e nunca guarda credencial

O token vive cifrado em `user_credentials`, com envelope encryption, e a chave
mestra é da api. O engine **não** recebe a chave mestra e **não** persiste
token: ele pede à api, pelo canal `/internal/*` que já existe com service
token, o **remoto de trabalho** de um projeto, no momento em que precisa
buscar ou empurrar.

Dar a chave mestra ao engine seria alargar o raio de explosão do segredo mais
sensível do produto para ganhar uma chamada HTTP a menos.

### 2. O token NUNCA entra no `.git/config`

Esta é a decisão que mais importa, e ela é consequência direta do
[ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md).

O caminho óbvio — `remote add origin https://x-access-token:TOKEN@github.com/…`
— grava a credencial **em texto puro dentro da pasta do projeto**. E a
[RN-075](../business-rules/custo.md#rn-075) acabou de dar ao dev agent leitura
**auto-aprovada** dentro dessa pasta: um `cat .git/config` devolveria o token
sem passar por aprovação nenhuma, e ele viajaria para o provider de LLM no
turno seguinte, dentro do histórico do laço.

O escopo de caminho protege contra o agente ler para **fora** do projeto. Ele
não protege — e não tem como proteger — contra um segredo que o próprio
produto colocou **dentro**.

Então: `origin` guarda a URL **limpa**, e a autenticação é injetada por
invocação, viva só durante o processo de git que a usa. Nada de credencial em
arquivo, nem no `.git/config`, nem em helper persistido.

### 3. A credencial é a do OWNER do workspace

Mesma regra que a [RN-058](../business-rules/custo.md#rn-058) já estabeleceu para
chave de LLM, pelo mesmo motivo: quem paga e quem autoriza é o dono do
workspace, não o agente nem quem abriu a sessão.

### 4. `provider: local` continua igual

Não é compatibilidade retroativa por educação: o provider local é o que os
testes de contrato usam e o que faz o `pnpm dev` funcionar sem credencial
nenhuma. O remoto de trabalho de um projeto local é o caminho do bare repo, e
o resto do caminho não sabe a diferença.

### 5. Falha de credencial é `infra`, e é dita

Token ausente, expirado ou sem permissão no repositório reprova com origem
`infra` — não `modelo`, não `código`. É a regra do CLAUDE.md sobre origem de
falha, e o achado T desta rodada mostra que ela é violada justamente nos
caminhos de erro que ninguém exercita.

## Consequências

**O que destrava.** Projeto em provider remoto passa a ter worktree, terminal,
diff de gate e contexto — isto é, a metade de construção. É a precondição da
FASE 13b: sem isso não existe execução medida em repositório remoto.

**O que fica mais caro.** O engine passa a depender da api para trabalhar no
sistema de arquivos. Um `fetch` agora pode falhar por rede, por token expirado
ou por a api estar fora — três modos de falha que o bare repo local não tinha.
Daí o ponto 5 ser decisão e não detalhe.

**O que este ADR NÃO resolve.** Isolamento continua sendo o problema em aberto
do [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md): o token não
está mais no disco, mas o agente segue rodando no mesmo container que o
monorepo do Brabo. Um `env` do processo de git durante a janela em que ele
roda é uma superfície menor que um arquivo permanente, e não é zero.

## Alternativas consideradas

**Dar a chave mestra ao engine.** Elimina a chamada HTTP e multiplica por dois
os lugares de onde todo segredo do produto pode vazar. Recusada.

**Token na URL do `origin`.** É o que quase todo tutorial faz, e é exatamente o
que o ADR 0055 tornou perigoso: escrever o segredo no lugar onde o agente tem
leitura auto-aprovada. Recusada — e registrada aqui porque a tentação de
"simplificar" para isso vai voltar.

**Espelhar o remoto num bare local e sincronizar.** Manteria o engine igual,
mas cria uma segunda fonte de verdade do repositório, com divergência
silenciosa quando alguém empurra direto no provider. Recusada.

**Manter só `local` e adiar.** É o estado atual, e é o que impede a FASE 13b.

## Referências

- Achado N de
  [achados-execucao-real.md](../explanation/achados-execucao-real.md), Fase B
  do [backlog](../explanation/backlog.md).
- [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) — o escopo que
  torna a decisão 2 obrigatória.
- [RN-058](../business-rules/custo.md#rn-058) — de quem é a credencial que o agente
  gasta.
- `apps/engine/lib/engine/projects/project_repository.ex`,
  `apps/engine/lib/engine/actions/workspace.ex`,
  `apps/engine/lib/engine/actions/git_executor.ex`.

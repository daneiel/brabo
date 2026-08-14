# 0072 — O projeto escolhe onde o código mora: pasta do usuário ou pasta gerenciada

## Status

Aceito.

Este ADR **revisa parte do [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)**,
que continua aceito e não é editado, e mexe no terreno que o
[ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) descreve. Os dois
decidiram a direção CONTRÁRIA à deste documento — caminhar para a parede de
container —, e é por isso que a seção de consequências é a mais importante
daqui: ela declara, sem atenuar, o que se perde.

## Contexto

### O pedido

> "Cruzar a fronteira de apenas escrever código no container e poder escrever
> código a partir de uma pasta do usuário. Ao criar o projeto separar **Local**
> para ter este propósito de ser alguma pasta do usuário e **Container** com a
> opção que já tem hoje."

E, sobre a forma do caminho, a variante escolhida explicitamente pelo dono do
produto, ciente do aviso de que só funciona se a pasta estiver montada no
container: **caminho livre, digitado pelo usuário**.

### O terreno: a única fronteira que existe hoje

Antes deste ADR, a raiz de um projeto era, literalmente, uma linha:

```ts
join(PROJECT_WORKSPACES_ROOT, workspaceDirName)
```

com `workspaceDirName` validado contra `^[A-Za-z0-9_-]{1,64}$`
(`apps/api/src/infrastructure/filesystem/project-workspaces-root.ts`). A força
dessa forma não está na validação: está no `join`. Com um segmento sem `/` e
sem `..`, o resultado **não tem como sair** da raiz gerenciada, aconteça o que
acontecer com a coluna. É contenção ESTRUTURAL, e ela sustenta quatro
consumidores que precisam concordar entre si:

| consumidor | onde | o que quebra se as raízes divergirem |
|---|---|---|
| `permissions.json` | `fs-permissions-file-store.ts` | política lida de um lugar, aplicada a outro |
| escopo de terminal (ADR 0055) | `propose-action.use-case.ts` → `decide.ts` | o escopo que AUTORIZA comando aponta para a pasta errada |
| leitura da aba Code (RN-095) | `caminhoDeRepositorioContido` | contenção de leitura sobre a árvore errada |
| working tree do engine | `apps/engine/lib/engine/actions/workspace.ex` | o agente escreve onde a api não lê |

### O que muda

`projects` ganha o par (`workspace_mode`, `workspace_path`). No modo
`container` — o default, e o comportamento de todo projeto que já existe — nada
muda. No modo `local`, a raiz passa a ser o caminho absoluto que o usuário
digitou, e o `join` sai de cena.

## Decisão

1. **O modo é do PROJETO, escolhido na criação, e o default é `container`.**
   Migração `0043`. `container` como default da coluna é o que faz projeto
   existente não mudar de lugar — e a decisão é NOT NULL, como `story_promotion`
   (ADR 0046), porque o valor É a decisão e decisão de autoridade não fica
   implícita.

2. **Modo e caminho são UMA decisão, travada no banco por CHECK**
   (`(workspace_mode = 'local') = (workspace_path IS NOT NULL)`). A trava não
   fica só no caso de uso porque a coluna é lida por DOIS processos (api e
   engine) e escrita por scripts de seed e backfill que não passam por ele.
   `local` sem caminho seria escopo de terminal apontando para lugar nenhum;
   `container` com caminho seria uma segunda fonte de verdade esperando
   divergir da primeira.

3. **A derivação continua ÚNICA.** `projectScopeRoot` passou a receber a
   LOCALIZAÇÃO (`{workspaceDirName, workspaceMode, workspacePath}`) em vez do
   nome da pasta, e é ela quem escolhe o ramo. Nenhum chamador ganhou
   validação própria: a razão que fez a função existir — as duas derivações
   têm que concordar — vale ainda mais agora que existem dois ramos. Vale a
   regra da PÓS-FASE 15: *duplicá-la em cada chamador seria checagem que um dia
   diverge*.

4. **A guarda da criação recusa em vez de deixar quebrar depois (RN-170).**
   Um caminho que não está montado no container produz um projeto que trava na
   primeira ferramenta do primeiro agente, longe da tela onde a decisão foi
   tomada. A criação valida, e recusa com 400 **e com a instrução de como
   montar**: caminho absoluto, sem `..`, que existe, é pasta, e é gravável pelo
   processo (`access(W_OK|X_OK)` — as imagens rodam non-root, ADR 0024, e pasta
   do host com outro dono chega como somente leitura na prática).

5. **A recusa cobre a raiz do sistema e o checkout do Brabo, nos dois
   sentidos.** `/`, as pastas de sistema e tudo abaixo delas ficam de fora
   porque a raiz do projeto é o escopo que autoriza o terminal do agente: um
   projeto com raiz em `/etc` transforma "o agente pode escrever no projeto
   dele" em "o agente pode reescrever o container". A sobreposição com o
   checkout do Brabo é recusada nas duas direções — a pasta que CONTÉM o
   monorepo (o caso literal do pedido) e a pasta DENTRO dele, que é o problema
   que o ADR 0055 relata acontecendo de verdade. Recusar um e permitir o outro
   seria fechar a porta e deixar a janela.

6. **A parte léxica da guarda roda também na LEITURA.** A validação da criação
   é o portão, mas o único jeito de burlá-la é escrever direto no banco — e
   quando isso acontece, o que se ganha é escopo de terminal em `/`. Então
   `projectScopeRoot` reaplica o predicado léxico a cada derivação e falha alto.
   O que NÃO se revalida ali é a parte de disco (existe, é gravável): é I/O, e
   a função está em caminho quente.

7. **O portão da imagem do Arquiteto (RN-105) não vale para projeto Local.**
   Ele existe porque o container é o que dá sentido a ler o código; um projeto
   Local não sobe container nenhum. Sem esta decisão, a aba Code responderia
   409 para sempre num projeto onde a decisão do Arquiteto nunca vai acontecer
   — a aba fechada por efeito colateral, não por escolha. A dispensa mora no
   mesmo funil do portão, nunca espalhada pelas rotas.

8. **O engine lê as duas colunas e resolve o localizador na CONSULTA.**
   `Engine.Projects.Project` devolve o NOME da pasta no modo `container` e o
   CAMINHO ABSOLUTO no modo `local`, e `Workspace.workspace_dir/2` distingue os
   dois pela barra inicial — que é inequívoca, porque o nome de pasta é
   validado contra um regex que não admite `/`. Resolver na consulta, e não em
   cada chamador, é o mesmo argumento do item 3.

## O que este ADR NÃO faz

- **Não sobe container por projeto.** A FASE 25b continua cortada, e o ADR 0065
  segue valendo como está. Um projeto `local` roda no MESMO container de hoje;
  a pasta é que mudou.
- **Não muda a fronteira de efeito externo (RN-106).** `git push`, abertura de
  PR e deploy continuam `deny` no terminal, dentro ou fora do escopo, no modo
  Local como no Container.
- **Não muda a política de terminal (ADR 0055).** Escopo de caminho e allowlist
  estreito continuam sendo a fronteira; o que muda é onde o escopo começa.
- **Não oferece seletor de pasta.** O caminho é digitado, por decisão declarada
  do dono do produto. Um seletor exigiria a api enumerar o filesystem do
  container para o navegador, o que é superfície nova para resolver ergonomia.

## Consequências

### A que dói, e é o preço declarado desta entrega

**A contenção estrutural do `join` deixa de existir para projetos Local.** Onde
antes nenhuma coluna corrompida conseguia produzir uma raiz fora de
`PROJECT_WORKSPACES_ROOT`, agora a raiz é o que a coluna disser. O que sobra no
lugar é uma lista de recusas (item 5) e a revalidação na leitura (item 6) — e
lista de recusas é o tipo de barreira que os achados **Z e AD** provaram não
convergir para verbos de comando. A diferença que sustenta a decisão é de
espaço: caminho absoluto é um espaço fechado e ordenado, onde "está sob esta
raiz" é decidível por prefixo, enquanto verbo/forma/invocação são três espaços
abertos. Não é o mesmo problema, mas também não é uma parede.

**O vetor de symlink declarado no ADR 0055 continua aberto, e agora aponta para
a máquina do usuário.** A normalização é léxica, por contrato (`decide()` é
puro, zero IO), então um symlink DENTRO da pasta do projeto apontando para fora
não é detectado — e, no modo Local, "fora" pode ser o `$HOME` de quem está
operando. Fechar isso é isolamento, não política, e continua dependendo da
FASE 25b.

**A pasta do usuário fica escrevível por agente.** É o pedido, não um efeito
colateral: o agente escreve código na pasta do usuário. Vale dizer em voz alta
que o `permissions.json` daquele projeto passa a morar lá dentro também, e que
apagar a pasta apaga a política junto.

### As que ajudam

- **Nada muda para quem não escolhe.** O default é o comportamento de sempre, e
  a suite existente passou sem modificação de comportamento — só de assinatura.
- **A recusa é datada e ensinada.** O modo de falha mais provável (pasta não
  montada) vira 400 com a linha de compose a acrescentar, na tela onde a
  decisão está sendo tomada, em vez de virar um agente travado depois.
- **O contrato externo dos gates, o RBAC e a trava de merge (RN-014) não são
  tocados.**

### O que exige do operador

Montar a pasta nos DOIS serviços, no MESMO caminho absoluto — ver
`docs/runbook.md`, seção "Projeto no modo Local", e `docs/reference/configuration.md`.
Montar só na api produz um projeto que a api aceita e o engine não enxerga: a
api valida o que ela vê, e ela não tem como saber o que está montado no outro
container.

## Alternativas consideradas

- **Uma raiz de pastas do usuário, com o projeto escolhendo um SUBDIRETÓRIO
  dela** (`LOCAL_WORKSPACES_ROOT` + nome). Preservaria o `join` e a contenção
  estrutural inteira, e foi a alternativa mais forte — mas não é o pedido: o
  dono do produto escolheu caminho livre, ciente do aviso.
- **Aceitar o caminho sem validar e deixar falhar no uso.** Descartada: é
  exatamente o modo de falha que a RN-170 existe para impedir, e ele aparece
  longe da tela onde a decisão foi tomada.
- **Marcar o projeto Local como "sem aba Code" em vez de dispensar o portão da
  RN-105.** Seria punir o modo novo por uma regra que não fala dele.

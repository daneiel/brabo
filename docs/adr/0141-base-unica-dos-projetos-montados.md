# 0141 — A base única dos projetos montados, montada por identidade

## Context

O modo `mounted` (o antigo `local`, ADR 0072/RN-169, renomeado pelo ADR
0104/RN-421) deixa o código do projeto numa pasta do USUÁRIO, e essa pasta
precisa ser alcançável de dentro de DOIS containers: a api, que lê e escreve o
`permissions.json` e serve a aba Code, e o engine, que monta o worktree e
escreve o código. O mecanismo, desde o começo, é bind-mount.

O que nunca foi decidido é **quem cria esse bind-mount, e quando**. O que
existia era uma INSTRUÇÃO: `docker/docker-compose.yml` trazia, nos serviços
`api` e `engine`, um comentário grande ensinando a acrescentar à mão uma linha
por projeto —

```yaml
- /home/voce/projetos/loja:/home/voce/projetos/loja
```

— e a criação de projeto recusava com 400 (RN-170/RN-422) quando a pasta não
estava lá, com a mensagem repetindo essa linha. A recusa é boa e continua
existindo; o problema é o preço do remédio que ela ensina.

**Uma edição de compose e um restart de `api` + `engine` POR PROJETO CRIADO.**
Reiniciar esses dois serviços mata todo turno de agente em andamento, todo
socket de terminal aberto e toda chamada de LLM em voo, na instalação inteira —
para onboardar um projeto. Isso era tolerável enquanto `mounted` era uma escape
hatch de quem já sabia o que estava fazendo. Deixa de ser no momento em que ele
vira escolha de primeira classe, oferecida na tela de criação com um caminho
sugerido.

E há um segundo problema, que a sugestão de caminho torna concreto. A regra
"a pasta do projeto não pode se sobrepor ao checkout do Brabo", que é o coração
do [ADR 0055](0055-escopo-de-caminho-em-comando-de-agente.md), é aplicada por
`caminhoDeWorkspaceLocalValido` comparando contra `raizDoBrabo()` — que é
`process.cwd()`, e dentro do container da api é `/workspace`. O checkout REAL,
no disco de quem desenvolve, a api não tem como conhecer. Quem clonar o Brabo
em `$HOME/brabo` e apontar a pasta do projeto para lá passa por **toda**
validação existente, e os dev agents passam a executar comandos dentro da
árvore do próprio produto — exatamente a falha que o ADR 0055 existe para
impedir, entrando por uma porta que ele não vigia.

## Decision

**Uma base ÚNICA, configurada pelo operador, montada por IDENTIDADE nos
serviços `api` e `engine`.**

```
# .env
BRABO_PROJECTS_BASE=/home/voce/brabo
```

```yaml
# docker/docker-compose.yml — serviços api E engine
- ${BRABO_PROJECTS_BASE:-brabo_projects_base}:${BRABO_PROJECTS_BASE:-/data/brabo-projects-base}
```

O operador configura **uma vez**, dá um `docker compose up -d api engine`, e
nada mais é editado por projeto, nunca. Todo projeto `mounted` mora dentro da
base.

O truque `${VAR:-nome_de_volume}` à esquerda, com um default absoluto e inerte
à direita, é o MESMO já usado por `PROJECT_WORKSPACES_HOST_DIR`/
`GIT_LOCAL_REPOS_HOST_DIR` nas linhas vizinhas: sem a variável, o lado esquerdo
é o nome de um volume nomeado declarado no fim do arquivo, a linha continua
sendo Compose válido, e nada é montado do host.

Sem a variável, a api reporta `projectsBase: null` (`GET
/workspaces/:workspaceId/projects-base`, `maintainer` — o mesmo mínimo de `POST
.../projects`, porque é para decidir o que aquela rota oferece que este valor
existe) e o assistente de criação **não oferece** o modo Pasta montada. Nunca
oferecer um modo que a instalação não honra.

### Por que uma variável NOVA, e não `PROJECT_WORKSPACES_HOST_DIR`

Existe uma variável que já troca um volume gerenciado por uma pasta real do
host, e a tentação de reusá-la é grande. São três motivos para não, e o
primeiro tem consequência de dados.

**1. Colisão de namespace, com `git init` na pasta do outro.** Um workspace
gerenciado é nomeado por `workspace_dir_name` (RN-109), coluna UNIQUE; um
projeto montado é nomeado pelo USUÁRIO, que digita o caminho. Com as duas
raízes apontando para o mesmo lugar, `<base>/loja` e um projeto `container`
cujo `workspace_dir_name` seja `loja` caem na MESMA pasta física — e
`Workspace.init_from_bare!` daria `git init` dentro do projeto de outra pessoa.
Nada no schema impede: a unicidade é entre valores de `workspace_dir_name`,
nunca contra o basename de `workspace_path`, e não há como haver, porque um
lado é escolhido pelo produto e o outro por quem digita.

**2. Semântica de dono oposta.** `/data/project-workspaces` é do PRODUTO:
descartável, opaco, e é isso que torna aceitável um projeto `container` ser
apagado com o volume. A base é do USUÁRIO — é onde o código dele mora, aberto
no editor dele, versionado por ele. Fundir as duas faria a documentação ter que
dizer "esta pasta é descartável e também não é".

**3. A base é navegável; a raiz gerenciada não deve ser.** O navegador de
pastas servido pela api (PR seguinte) é escopado à base, para o usuário poder
escolher onde o projeto vai morar. Conflar as duas exporia o interior de todo
projeto `container` da instalação a quem estiver criando um projeto qualquer.

### Por que IDENTIDADE (`$X:$X`), e não um ponto de montagem fixo

Um mount fixo — `${BRABO_PROJECTS_BASE}:/data/mounted` — seria mais curto de
escrever, e está errado por dois motivos que se somam.

A string de `projects.workspace_path` é **digitada pelo usuário e mostrada de
volta a ele** (`AmbienteDoProjeto`). Com host ≠ container, o produto teria de
escolher qual das duas guardar, e qualquer escolha faz a tela mentir para
alguém: guardar o caminho de dentro mostraria uma pasta que não existe na
máquina dele; guardar o de fora exigiria traduzir em todo ponto de uso.

E é justamente essa tradução que a identidade dispensa. `projectScopeRoot` (api)
e `Engine.Actions.Workspace.workspace_dir/2` (engine) discriminam modo pela
barra inicial do caminho e usam o valor da coluna tal como está. Com host ==
container, os dois **continuam corretos sem uma linha de código nova** — e o
escopo de terminal do ADR 0055, que é derivado dessa mesma raiz, continua
autorizando exatamente a pasta que o usuário vê.

### O broker ganha uma SEGUNDA raiz

`BRABO_PROJECTS_HOST_BASE` entra no serviço `broker` derivando de
`BRABO_PROJECTS_BASE` (que já é um caminho de host por definição — é ela que
`api`/`engine` montam por identidade), ao lado de `PROJECT_WORKSPACES_HOST_ROOT`
e pelo mesmo motivo do [ADR 0130](0130-broker-de-container.md): o `-v` de um
`docker run` é resolvido pelo DAEMON, contra o filesystem do host, e um caminho
vindo de dentro da api montaria uma pasta vazia. A contenção continua
**configurada no broker**, nunca afirmada pelo chamador — que é o invariante
real daquele ADR.

Nada consome essa variável ainda: quem resolve um projeto `mounted` contra essa
raiz é o PR que dá container ao modo Pasta montada. Ela nasce aqui porque a
base nasce aqui, e uma variável de host que aparece meia release depois é uma
variável que ninguém liga ao arquivo que a explica.

### A guarda do `/workspace`, no lugar onde ela é possível

`scripts/dev/preflight.mjs` passa a **recusar subir** quando
`BRABO_PROJECTS_BASE` se sobrepõe ao checkout do Brabo, nos dois sentidos (a
base contém o checkout; o checkout contém a base), usando `git rev-parse
--show-toplevel`.

O preflight roda no HOST. Ele consegue responder o que a api não consegue, e é
por isso que a guarda mora ali e não no domínio: a api compara contra
`process.cwd()`, que é `/workspace` dentro do container dela, e nunca vai ver o
caminho real. A lógica pura mora em `scripts/dev/base-de-projetos.mjs`, módulo
próprio e testado — `preflight.mjs` executa `await main()` no topo, e importá-lo
de um teste subiria o preflight inteiro.

## Consequences

**O que fica melhor.** Criar um projeto `mounted` deixa de exigir edição de
compose e restart de `api` + `engine` — deixa de custar todo turno de agente,
socket de terminal e chamada de LLM em voo da instalação. A configuração passa
a ser um ato do OPERADOR, uma vez, e não um ato do usuário, por projeto. E o
vetor do ADR 0055 que nenhuma validação da api alcançava passa a ter guarda,
com mensagem que explica por que nada mais pegaria aquilo.

**Ação de operador exigida ANTES do deploy**, e é por isso que a branch nasce
`breaking/` e a versão sobe MAJOR: quem já usa o modo `mounted` tem as linhas
de bind-mount por projeto escritas à mão no compose. Elas continuam
funcionando — nada as remove, e nada neste PR passa a recusar um projeto
`mounted` fora da base (a regra da base é de CRIAÇÃO e CONVERSÃO, e entra no PR
seguinte; o predicado léxico, que roda em toda leitura, não muda). Mas a partir
daqui o caminho suportado é a base, e continuar por linha-por-projeto é dívida
que ninguém mais mantém.

**Custo declarado 1: symlink sob a base resolve diferente dos dois lados.** Um
link simbólico dentro da base apontando para fora dela é seguido pelo kernel
DENTRO do container só se o alvo também estiver montado — e não está. O
navegador de pastas recusa descer em symlink (e conta quantos pulou, para não
mentir "pasta vazia"); quem pega a divergência de verdade é a checagem de disco
no momento da materialização, como um `failed` NOMEADO. É contenção léxica com
um furo conhecido, o mesmo que o ADR 0055 já declara e pela mesma razão:
resolver `realpath` exigiria I/O onde a decisão precisa ser pura.

**Custo declarado 2: código fora da base exige mover a pasta.** Esta v1 suporta
UMA base. Quem tem repositórios espalhados por vários lugares do disco precisa
mover o projeto para dentro dela — e a mensagem de recusa diz exatamente isso,
em vez de sugerir que existe uma configuração escondida. Uma segunda base (ou
uma lista) é decisão de produto que não se toma antes de alguém pedir: cada
raiz a mais é uma raiz a mais que o navegador de pastas expõe e que o broker
precisa distinguir.

**O que este ADR NÃO decide.** Não toca `caminhoDeWorkspaceLocalValido` nem
`projectScopeRoot` — a exigência de que um projeto `mounted` esteja dentro da
base é do PR seguinte, e vai deliberadamente para a criação/conversão, não para
o predicado que roda em toda leitura (senão um projeto montado legado, fora da
base, passaria a explodir ao ser LIDO). Não muda schema, não tem migration, e o
CHECK do par `(modo, caminho)` fica intacto. E não dá container a projeto
`mounted`: isso é outro PR, e é lá que `BRABO_PROJECTS_HOST_BASE` ganha
consumidor.

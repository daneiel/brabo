# 0146 — A base consentida no bootstrap, e `mounted` como padrão local

## Context

O ADR 0141 criou `BRABO_PROJECTS_BASE`: **uma** base no host, montada por
identidade (`$X:$X`) em `api` e `engine`, onde moram as pastas de todo projeto
no modo Pasta montada. Ele resolveu o problema que se propôs a resolver —
acabou a linha de bind-mount por projeto no compose, e com ela o restart que
matava todo turno de agente em voo para onboardar UM projeto.

Mas ele deixou a variável **ausente por padrão**, e a consequência disso é a
razão desta fase existir. Sem a variável a api reporta `projectsBase: null` e o
assistente de criação **não oferece** o modo (`docs/adr/0141-base-unica-dos-projetos-montados.md:68-72`).
O estado normal de uma instalação recém-clonada é, portanto: o único modo que
põe o código numa pasta que o usuário abre no editor **não aparece na tela**.
`container` não tem pasta que ele veja; `runner` exige binário, `chmod`,
pareamento e — desde o ADR 0145 — Docker de pé na máquina dele. O produto tem
três modos de execução e nenhum deles entrega, sem trabalho de configuração que
ninguém pediu ao usuário para fazer, a coisa mais simples que ele espera: ver os
arquivos.

Falta um **gesto de consentimento**. Escolher onde os projetos vão morar é
decisão do dono da máquina, acontece **uma vez**, e acontece **no host** — não
dentro de um container, não pela api, não pela interface web. O produto já tem
exatamente um lugar com essas três propriedades: `pnpm bootstrap`
(`scripts/dev/bootstrap.sh`), o menu que já cria o `.env`, corrige donos de
pasta e reconfigura o Ollama.

Há um segundo fato do mundo que mudou desde o ADR 0130 e que esta fase não pode
ignorar. O broker sobe sob `profiles: ["container-broker"]` e **não sobe por
padrão**, e a justificativa registrada é literal
(`docs/adr/0130-broker-de-container.md:131-135`):

> Nada o chama para escrever ainda; dar acesso ao Docker do host a toda máquina
> de desenvolvimento **em troca de nada** seria uma mudança de postura sem
> contrapartida.

A premissa dessa frase — "nada o chama" — deixou de ser verdadeira. O ADR 0133
deu a `container_start` um chamador real; o ADR 0136 acrescentou `stop` e
`remove`; o ADR 0134 acrescentou `exec`. E o ADR 0144 fez `mounted` subir
container **pelo broker**. Um projeto `mounted` num compose local sem o profile
ligado não termina em erro de configuração: termina em `BrokerIndisponivelError`,
depois de o usuário ter escolhido o modo, criado o projeto e conversado com o
Arquiteto.

## Decision

### 1. A base padrão é `$HOME/projetos-brabo`, e quem a grava é Node, não bash

O caminho proposto é **`$HOME/projetos-brabo`**, sempre expandido para absoluto
antes de ser gravado. O `~` continua proibido, e não por gosto: o Compose não o
expande no lado que interessa, e escrevê-lo cria uma pasta chamada `~`
(`.env.example:225-229`).

Sob `$HOME` porque é o que o Docker Desktop compartilha **por padrão** — `/Users`
no macOS, o perfil do usuário no Windows. Um default que exige o usuário abrir as
configurações do Docker antes de funcionar não é um default; é uma pergunta
disfarçada. Não `$HOME/brabo`, porque a base não pode ser (nem conter) o checkout
do próprio Brabo — `scripts/dev/preflight.mjs:316` já recusa subir nesse caso — e
quem clona o produto ali cairia exatamente na recusa.

E **não `$HOME/brabo-projetos`**, apesar de ser o nome mais natural, porque
`.env.example:202` já usa esse caminho como exemplo comentado de
`PROJECT_WORKSPACES_HOST_DIR` — a raiz dos workspaces que o PRODUTO gerencia. São
variáveis diferentes com donos opostos, e o ADR 0141 recusou conflá-las
justamente porque a colisão "quebra de um jeito difícil de enxergar":
`<base>/loja` colidiria com um projeto `container` cujo `workspace_dir_name`
também fosse `loja`, e o bootstrap daria `git init` dentro do projeto do outro
(`.env.example:231-237`). Propor como default o caminho que a documentação já
sugere para a outra variável seria andar para dentro dessa armadilha pela porta
da frente.

O nome, porém, é só a esquiva. A proteção é **mecanismo**: o script **recusa**
qualquer base que seja igual a, contenha ou esteja contida em
`PROJECT_WORKSPACES_HOST_DIR`, reusando `dentroDe` de
`scripts/dev/base-de-projetos.mjs` — a mesma função que já sustenta
`baseSobrepoeOCheckout`. A checagem vale para o caminho digitado, não só para o
default; um default bem escolhido só evita que a recusa seja a primeira coisa que
o usuário veja.

**Quem grava é `scripts/dev/consentir-base.mjs`**, novo, irmão de
`scripts/dev/base-de-projetos.mjs` (que já hospeda a lógica pura de normalização
e sobreposição), chamado por um item de menu do `bootstrap.sh`.

Não é bash, e os dois motivos são medidos, não estéticos. O primeiro: o
`bootstrap.sh` **não tem** helper de escrever variável no `.env` — `garantir_env`
(`scripts/dev/bootstrap.sh:91`) só copia o `.env.example` quando o arquivo não
existe. O único helper que atualiza uma chave in-place, preservando comentários e
anexando ao fim quando ela não existe, é `escreverEnv`
(`scripts/dev/preflight.mjs:128`). O segundo, e o decisivo: **item de menu não
consegue perguntar**. Todo comando do menu roda em background com stdin vindo de
`/dev/null` (`scripts/dev/bootstrap.sh:770`), e o comentário acima da linha
explica por quê — sem isso, qualquer coisa que leia stdin rouba as setas do
usuário, e um comando que espera resposta trava sem nunca mostrar a pergunta.
Um passo de consentimento escrito em bash dentro do menu seria, por construção,
um passo que não pode consentir.

**Valor já presente nunca é sobrescrito sem confirmação.** E **sem TTY, o script
reporta e não faz nada** — precedente literal de `perguntarUsoDoOllama`
(`scripts/dev/preflight.mjs:208`), que sem terminal aplica o default e avisa em
vez de travar. Um script de consentimento que "consente" sozinho num pipe de CI é
a negação da palavra.

A pasta é criada com `mkdir -p` **depois** de o usuário aceitar o padrão ou
digitar outro caminho, nunca antes.

### 2. O compartilhamento do Docker Desktop se prova MONTANDO

Em macOS e Windows, uma pasta fora da lista de compartilhamento do Docker Desktop
monta **vazia** ou faz o `docker run` falhar — e o modo Pasta montada inteiro
depende desse mount. A validação é obrigatória, e a forma dela é o veredito:

**Prova-se montando, nunca lendo a configuração do Docker Desktop.** O teste é
um `docker run --rm -v <base>:/sonda <imagem já presente> ls /sonda`. Ler
`settings.json` seria ler a *intenção* declarada numa estrutura não documentada,
que muda entre versões e entre macOS e Windows, e que descreve o que o usuário
configurou — não o que o daemon fará. Montar mede a **propriedade**. É a mesma
régua que o produto já aplica aos providers: capability só é declarada quando
provada por execução, nunca lida da documentação oficial (ADR 0041/0042).

Só em macOS e Windows, por `process.platform`. Em Linux não há lista de
compartilhamento: a checagem é existência e permissão de escrita, e nada mais.
Isto torna a validação a **segunda** guarda de plataforma do produto — a
primeira é `validarDirDentroDoHomeNoLinux` (`apps/runner/src/guard.ts:240`), que
restringe `--dir` ao `$HOME` **só** no Linux. As duas são simétricas no
princípio: cada uma restringe apenas onde a restrição significa alguma coisa.
Vale registrar que hoje **nenhum script de dev detecta plataforma** — nem
`bootstrap.sh` nem `preflight.mjs` chamam `uname` ou leem `process.platform` —,
então este ADR introduz o padrão, e é por isso que ele fica escrito aqui em vez
de virar um `if` sem dono.

Base fora da lista: **recusa com mensagem acionável**, nomeando o caminho
testado e onde adicioná-lo (Docker Desktop → Settings → Resources → File
sharing). Nunca grava a variável, nunca monta em silêncio. Uma base aceita e não
compartilhada produz um projeto que a api aceita, cria e mostra — e cujo
container sobe com a pasta vazia, longe da tela onde a escolha foi feita. É a
mesma lição da RN-170, e a razão de a recusa vir antes da gravação.

### 3. O broker sai do `profiles` no compose LOCAL, e só nele

**Veredito: sai em `docker/docker-compose.yml`; permanece sob
`profiles: ["container-broker"]` em `docker/docker-compose.prod.yml`.**

A justificativa original (`docs/adr/0130-broker-de-container.md:131-135`, citada
no Context) tem duas metades, e só a segunda sobrevive. "Nada o chama para
escrever ainda" é **falso** desde os ADRs 0133/0134/0136 — o broker tem quatro
chamadores reais. E "em troca de nada" deixou de descrever a troca: com este ADR
tornando `mounted` o padrão local (ponto 4) e o ADR 0144 fazendo `mounted` subir
pelo broker, o profile desligado passa a ser o que separa o **modo padrão** de
terminar em `BrokerIndisponivelError`. A contrapartida existe, e ela é o caminho
comum.

O que sustenta a assimetria local↔produção é o que o socket significa em cada
lado. **Quem roda `pnpm dev` já tem o socket do Docker** — está rodando
`docker compose`, com o daemon do próprio host. O broker recebê-lo não concede
nada que o operador já não possua; a superfície marginal é o HTTP do próprio
broker, que não publica porta (`docker/docker-compose.yml:486-487`), vive numa
rede `internal: true` que só a api alcança, e compara `BRABO_SERVICE_TOKEN` em
tempo constante. Em produção o cálculo é o oposto: o socket é fronteira de
privilégio de verdade, o operador não é o desenvolvedor, e nada nesta fase muda o
modo padrão de uma instalação de produção. Por isso o profile fica lá.

**As cinco camadas de contenção não são tocadas**
(`docs/adr/0130-broker-de-container.md:171-176`). Este ADR muda **quando** o
broker roda, nunca **o que** ele aceita: ele continua recebendo `projectId` e uma
das cinco operações, continua indo à api ler a decisão do Arquiteto, e continua
sem parâmetro nenhum onde se escreva `privileged`, `cap_add`, `network: host` ou
um `-v` livre. A contenção nunca foi o profile.

`DOCKER_GID`/`group_add` continua sendo o ponto ambiental frágil, e ele agora
vale para toda máquina de desenvolvimento em vez de só para quem ligava o
profile — ver Consequences.

### 4. Com base configurada, `mounted` é o padrão do assistente

Base presente: **`mounted` pré-selecionado**, com o caminho **sugerido** como
`<base>/<slug>` e editável. Base ausente (`projectsBase: null`): `mounted` **não
é oferecido** e `container` permanece o padrão.

Nenhuma das duas metades é regra nova. "Não oferecer sem base" é a RN-500 e o
`docs/adr/0141-base-unica-dos-projetos-montados.md:68-72`; "sugerir
`<base>/<slug>`" é a RN-501 e o ADR 0142, que adiou a validação de disco
justamente para que o assistente pudesse propor um caminho que **ainda não
existe**. O que este ADR registra é que **as duas nunca foram implementadas no
cliente**: `GET /workspaces/:workspaceId/projects-base` não tem chamador nenhum
no web, e o card do modo é oferecido incondicionalmente. A fase as torna
verdadeiras; ela não as inventa.

O que é novo é a **pré-seleção**. Ela **revisa o default do ADR 0072**, onde
`container` é "a normal" e o modo local é escape hatch — e revisa-o **só para a
instalação local**, onde a base foi consentida por um humano no host. O enum
`projectExecutionModeEnum` não muda, nenhum modo novo nasce, e a conversão entre
modos (ADR 0111) continua idêntica.

### 5. O script de consentimento é versionado no repositório

`scripts/dev/consentir-base.mjs` vive no repositório, entra no diff, passa por
revisão e é o mesmo arquivo para todo mundo. **Nunca gerado dinamicamente pela
api, nunca baixado em tempo de execução.**

É a mesma cadeia de suprimentos que já pina toda action de terceiro por commit
SHA e verifica todo binário baixado com `sha256sum -c`: um script que configura o
host do usuário, cria pasta e escreve no `.env` é precisamente o artefato cuja
procedência precisa ser auditável. Um script gerado pela api seria código que
roda na máquina do usuário e que **ninguém revisou**, entregue por um canal cuja
integridade o produto não verifica.

Corolário explícito: **a api não ganha rota que emita script de host.** O proxy
`GET /runner-releases/binary` que já existe não é precedente disso — ele serve um
artefato **já publicado** em GitHub Releases, não gera um; e a ausência de
assinatura nesse caminho é exatamente o **BRB-005**, item de backlog aberto, não
um padrão a imitar.

## Consequences

O usuário que clona o Brabo e roda `pnpm bootstrap` termina com uma base
consentida, validada contra o Docker que ele realmente tem, e com o assistente
oferecendo por padrão o modo que põe o código numa pasta que ele abre no editor.
As sessões 2, 3 e 4 desta fase constroem, nessa ordem, o passo do bootstrap, o
comportamento do wizard e a mudança do profile.

**O que este ADR NÃO toca.** `decide.ts` e os tetos absolutos continuam idênticos
— nada aqui é ação de agente. `proposed_action` continua sendo a origem de todo
efeito externo. A imutabilidade do event log não é encostada. O portão da imagem
vale para os três modos como o ADR 0135 deixou, e um projeto `mounted` sem
`artifact.project_image` decidido continua respondendo 409 na aba Code. O broker
continua com **cinco** operações e com a especificação computada, nunca aceita
(ADR 0128/0130) — uma sexta operação segue sendo decisão de produto com ADR
próprio.

**Custo declarado 1: `DOCKER_GID` passa a importar para todo mundo.** Enquanto o
broker subia só sob profile, um `group_add` errado afetava quem tinha ligado o
profile de propósito. Agora ele sobe por padrão no compose local, e um GID errado
vira erro de permissão no socket para qualquer desenvolvedor. O default
`${DOCKER_GID:-999}` acerta em boa parte das distribuições Linux e erra em
outras; a sessão 4 deve reportar isso no `preflight.mjs`, junto do estado da
base, em vez de deixar a falha aparecer só quando alguém propõe
`container_start`.

**Custo declarado 2: uma base só, e ela é navegável.** O ADR 0141 já declarou os
dois, e este ADR os herda sem melhorá-los: symlink sob a base apontando para fora
resolve diferente dos dois lados, e código fora da base exige mover a pasta. O
`.env.example:239-241` já instrui a escolher uma pasta **dedicada** — tudo sob a
base fica alcançável de dentro dos containers do produto —, e a mensagem do passo
de consentimento repete essa instrução em vez de presumi-la lida.

**Custo declarado 3: a sonda de compartilhamento custa um `docker run`.** Ela
roda uma vez, no gesto de consentimento, e reusa uma imagem já presente para não
puxar rede. Se não houver nenhuma imagem local, o passo diz isso e pede que o
usuário rode `pnpm dev` uma vez antes — nunca baixa uma imagem por conta própria
para poder testar.

**Lacunas assumidas, com origem.** A credencial de git continua sendo descartada
no caminho `docker exec` em modo `runner` (`apps/runner/src/index.ts:318-320`; a
porta de Docker não tem campo `env`, por desenho do ADR 0130) — esta fase não a
fecha. O symlink de dentro do projeto apontando para fora continua não sendo
detectado por `decide()`, que é puro e não faz I/O
(`docs/adr/0055-escopo-de-caminho-na-politica-de-terminal.md:9-15`); `apps/runner/src/guard.ts:9-31`
segue best-effort por invariante declarado. **BRB-005** (assinatura dos artefatos
publicados) e **BRB-031** (`chmod +x` manual) permanecem abertos: esta fase os
encosta e não os resolve.

**Windows fica de fora do caminho testado.** A sonda de compartilhamento roda em
Windows porque `process.platform` a inclui, mas o produto continua exercitado só
em Linux e macOS (`.env.example:198-201`), e nada nesta fase muda isso.

Referencia [0130](0130-broker-de-container.md) (o profile e as cinco camadas),
[0141](0141-base-unica-dos-projetos-montados.md) (a base que este ADR passa a
consentir), [0142](0142-validacao-de-workspace-montado-adiada.md) (a validação
adiada que torna a sugestão possível), [0144](0144-a-segunda-raiz-do-broker.md)
(`mounted` sobe pelo broker) e [0072](0072-projeto-local-ou-container.md) (o
default que o ponto 4 revisa para a instalação local). Nenhum deles é editado.
[0147](0147-agente-local-com-capacidades.md) é o irmão desta fase e decide a
outra metade: o agente local e suas capacidades.

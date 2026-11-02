# ADR 0114 — Detecção de Ollama nativo no bootstrap de dev: perguntar uma vez, persistir no `.env`, pôr os serviços do compose atrás de um profile

- **Status:** Aceito
- **Data:** 2026-08-26
- **Contexto:** fecha uma colisão real de porta achada no bootstrap de dev local entre o serviço `ollama` do compose e uma instalação nativa do Ollama já rodando na máquina de quem desenvolve
- **Referências (sem editar):** [ADR 0025](0025-fase5-deploy-kubernetes-kustomize.md) (decisão 10 — `pnpm dev` e `make deploy-local` compartilham portas de propósito), [ADR 0100](0100-rag-search-e-modelos-garantidos-no-boot.md) (introduziu o par `ollama`/`ollama-model-loader` que este ADR põe atrás do profile)

## Contexto

O `scripts/dev/preflight.mjs` já existia para pegar um choque de portas
conhecido antes do `docker compose up`: `pnpm dev` e `make deploy-local`
compartilham as portas 3000/4000/8080 de propósito (ADR 0025, decisão 10), e
um `port is already allocated` opaco do Docker não diz quem está segurando a
porta nem o que fazer. O preflight lê `docker compose config`, cruza com
`docker ps` e `ss -tlnp` e relata cada colisão pelo nome.

O `OLLAMA_PORT` (padrão `11434`) está nesse mesmo conjunto — e é também a
porta padrão de uma instalação *nativa* do Ollama, do tipo que um
desenvolvedor talvez já rode por motivos sem relação na própria máquina. Ao
contrário do choque com o k3d, esta colisão tem uma resolução legítima que o
relatório genérico de conflitos desconhece: reusar o daemon nativo em vez de
rodar um segundo num container. Relatada como "port 11434 ← ollama (unknown
process)", como qualquer outro conflito, a correção parece um problema a
contornar, quando a resposta de fato é "deixe reusar".

## Decisão

### 1. Confirmar que é mesmo o Ollama antes de tratá-lo de forma especial

`detectarOllamaNativo` (`scripts/dev/preflight.mjs:234`) só trata a porta
como caso especial quando um GET ao vivo em
`http://localhost:<porta>/api/tags` responde com a forma que o Ollama sempre
devolve, mesmo sem modelo baixado ainda (`{"models":[]}`, conferido via
`ehOllama`, `preflight.mjs:159`). Um timeout curto (1,5s) importa aqui: isto
roda antes de qualquer container subir, então um travamento aqui travaria o
`docker compose up` inteiro. Qualquer coisa na porta que não responda como o
Ollama cai no relatório genérico de conflitos que já existia — esta decisão
só toca o único caso em que o ocupante é, comprovadamente, a coisa de que
este ADR trata.

### 2. Perguntar uma vez, aplicar o padrão sem TTY e registrar a decisão para não perguntar de novo

`perguntarUsoDoOllama` (`preflight.mjs:198`) pergunta "Detectamos Ollama já
rodando na porta N. Usar essa instância? [S/n]" — mas só quando
`process.stdin.isTTY`. Os itens de menu do `bootstrap.sh` rodam o comando em
segundo plano com o stdin redirecionado de `/dev/null`, de propósito, para
que um comando em execução nunca roube as setas que o próprio menu está
lendo; uma pergunta que tentasse ler uma linha de um fluxo já fechado
travaria para sempre. Sem TTY a função registra no log por quê e devolve o
padrão (sim) direto — a mesma forma de guarda que o resto do produto já usa
sempre que uma decisão precisa de um humano mas talvez não haja um olhando.

A resposta é gravada no `.env` e nunca mais perguntada enquanto
`OLLAMA_MODE` estiver lá: `detectarOllamaNativo` encerra logo no início no
momento em que a chave existe (`preflight.mjs:236`). Nada no laço normal do
`pnpm dev` pergunta de novo — o único jeito de reabrir a pergunta é o item de
menu novo da Decisão 5.

### 3. `escreverEnv` — a primeira coisa neste repositório que *escreve* o `.env`, não só o lê

Todo script existente que toca o `.env` (as buscas de `*_TEST_KEY` do
`reset-total.sh`, o próprio `lerEnv` deste mesmo arquivo) só extrai um valor
com grep. Nada antes disto precisou *atualizar* um, então não havia padrão em
bash a reusar nessa direção. O `escreverEnv` (`preflight.mjs:118`) é Node
porque a atualização precisa de uma propriedade que as ferramentas de bash
orientadas a linha não dão de graça sem cuidado extra: ler o arquivo,
reescrever uma linha no lugar quando a chave dela já existe, acrescentar a
chave no fim quando não existe, e deixar intactos todo comentário e toda
outra chave. No caminho "sim, usar" ele grava `OLLAMA_MODE=host` e
`OLLAMA_HOST=http://host.docker.internal:<porta>`; no "não" grava
`OLLAMA_MODE=container` mais um `OLLAMA_PORT` novo, achado varrendo para cima
a partir de `11500` (`proximaPortaLivre`, `preflight.mjs:178`), para que o
container ganhe uma porta livre em vez de colidir com a nativa que ele acabou
de ser instruído a deixar em paz.

### 4. Pôr `ollama`/`ollama-model-loader` atrás de um profile do compose

Os dois serviços (introduzidos pelo ADR 0100) passam para `profiles:
["local-llm"]` (`docker/docker-compose.yml:82,119`) — o mesmo padrão que o
`docker-compose.prod.yml` já usa para o par equivalente sob o nome literal
`llm` (arquivo diferente, então o literal não precisa coincidir). Um serviço
com profile não sobe num `docker compose up` puro, que é exatamente o que
`OLLAMA_MODE=host` precisa: não "subiu mas está inalcançável", e sim nunca
subiu, então nunca disputa a porta e nunca gasta RAM carregando um modelo que
nada vai consultar.

### 5. `scripts/dev/perfil-ollama.sh` decide `--profile local-llm` no momento em que cada comando roda

Um script pequeno, não um `grep` duplicado em três lugares: ele imprime
`--profile local-llm` a menos que o `.env` já diga `OLLAMA_MODE=host`, e nada
caso contrário. Ele é consumido pelos dois únicos chamadores de `docker
compose` que sobem a stack **inteira** em vez de um serviço nomeado —
"Docker › Deploy › All" e "Docker › Create" (`bootstrap.sh`, itens
`1.1.1`/`1.2`) — via `$(bash scripts/dev/perfil-ollama.sh)`, escrito
**escapado** como `\$(...)` na fonte da árvore de comandos para que seja
avaliado quando o item de menu é *executado*, não quando a árvore é montada
(o mesmo escape já usado para `\${POSTGRES_USER}` no comando de Database ›
Delete). Api/Engine/Web (`1.1.2`–`1.1.4`) miram um serviço cada e nunca tocam
o `ollama`, então ficaram como estavam.

### 6. "Docker › Reconfigurar Ollama" (`1.5`) reabre a pergunta

O `scripts/dev/reconfigurar-ollama.sh` remove `OLLAMA_MODE` e `OLLAMA_HOST`
do `.env` incondicionalmente, e `OLLAMA_PORT` *só* quando o modo esquecido
era `container` — no modo `host` essa porta foi gravada por quem instalou o
Ollama nativamente, não por este mecanismo, e apagá-la faria o próximo boot
esquecer em silêncio um valor que nunca foi desta feature. O item não precisa
de tela de confirmação: muda no máximo três linhas do `.env` e nada
destrutivo para os dados, a mesma régua que o resto dos itens de menu não
triviais mas não destrutivos já cumpre (Generate, Migrate, Seed).

## Consequências

**Um profile que esconde a porta também esconde um conflito real, então o
caminho de detecção teve de ganhar o seu.** Com o `ollama` sob um profile
inativo, o `docker compose config` deixa de listar a porta `11434` por
padrão — o laço genérico por porta que pegava "outra coisa está ocupando a
11434" simplesmente deixaria de vê-la, uma regressão silenciosa em relação ao
comportamento que existia *antes* deste ADR. O `detectarOllamaNativo` fecha
essa lacuna ele mesmo: quando a porta está ocupada por algo que responde
qualquer coisa diferente da forma do Ollama, ele devolve uma entrada de
conflito no formato exato que o laço genérico já produz, e ela cai no mesmo
relatório.

**Remover o `depends_on: ollama` da `api` foi uma mudança forçada, não
acidental.** O Compose recusa o arquivo inteiro com "depends on undefined
service" quando um serviço fora de um profile inativo depende de um de
dentro dele — confirmado testando num sandbox isolado antes de tocar o
arquivo real, e isso quebrava toda invocação de `docker compose` (`up`,
`down`, `ps`, até `config`, que o próprio `preflight.mjs` chama). A
dependência já era vestigial para os fins do compose: a `api` chama o Ollama
em runtime, no turno do agente, nunca no próprio boot, então nada da ordem de
subida se perdeu.

**"Docker › Destroy" também passa pelo mesmo `--profile` condicional.** O
`docker compose down` sem `--profile` ignora containers que pertencem a um
profile inativo — se `ollama`/`ollama-model-loader` subiram sob `local-llm`,
um `down` puro os deixa rodando e pode deixar a rede num estado "ainda em
uso". O `CMD["1.3"]` do `bootstrap.sh` agora resolve pelo mesmo helper
`scripts/dev/perfil-ollama.sh` que os caminhos de `up` usam, então o Destroy
derruba exatamente o que o `up` correspondente subiu — coberto pelo caso
"Docker › Destroy também passa pelo perfil do Ollama" do `bootstrap.spec.ts`.

**Declarado, não corrigido aqui: um container `ollama` ocioso do próprio
projeto pode ser confundido com uma instalação nativa.** Se um desenvolvedor
passa para `OLLAMA_MODE=container` mas não derruba os containers antes, o
`detectarOllamaNativo` não tem como distinguir "há uma instalação nativa
nesta porta" de "o container `ollama` do próprio projeto, de uma execução
anterior, ainda está nesta porta" — ele perguntaria de novo nesse caso. Não
implementado: a sequência é incomum (reconfigurar sem parar a stack antes) e
estava fora do escopo do pedido que produziu esta feature.

**A ordem de acréscimo no `.env` não é curada.** Quando nenhuma das três
chaves existe ainda, o `escreverEnv` as acrescenta no fim do arquivo, não ao
lado do bloco `OLLAMA_PORT`/`OLLAMA_HOST` em torno do qual o `.env.example`
já as documenta. Cosmético, não problema de correção — os valores são
igualmente válidos onde quer que caiam no arquivo.

## Alternativas consideradas

- **Continuar relatando a porta ocupada como conflito genérico e deixar o
  desenvolvedor resolver à mão pelo `.env`.** Recusada: é uma situação comum
  e benigna, não um erro — rotulá-la do mesmo jeito que "o cluster k3d está
  de pé" ou "um processo sem relação está nesta porta" ensina o
  desenvolvedor a contornar algo que tem correção de uma linha, toda vez que
  ele sobe a stack.
- **Detectar e reusar a instância nativa em silêncio, sem perguntar.**
  Recusada pelo mesmo princípio que o resto do produto já mantém para
  configuração que não é dele (CLAUDE.md: o produto nunca sobrescreve
  configuração do usuário sem decisão explícita) — mesmo uma conveniência de
  dev de baixo risco ganha uma pergunta explícita, feita uma vez, não um
  padrão silencioso que o desenvolvedor só descobre depois lendo o `.env`.
- **Deixar `ollama`/`ollama-model-loader` fora de qualquer profile e só parar
  de publicar a porta no modo `host`.** Recusada: os containers ainda
  subiriam, ainda carregariam um modelo na memória e ainda gastariam
  CPU/RAM que nada jamais consultaria — um profile impede que eles subam, que
  é o que "usar o nativo no lugar" de fato quer dizer.

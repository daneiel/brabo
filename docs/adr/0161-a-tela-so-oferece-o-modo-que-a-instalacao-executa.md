# 0161 — A tela só oferece o modo que a instalação executa, e a instalação por Release não tem broker

## Status

**Accepted.** Decidido pelo mantenedor em 2026-09-18 (AT-085), com a resposta
"os dois" à pergunta "o instalador liga o broker, ou a tela para de oferecer o
que não roda?". Revisa a pré-seleção da
[RN-513](../business-rules.md#rn-513) ([ADR 0146](0146-base-consentida-no-bootstrap.md),
ponto 4) e acrescenta um motivo de recusa local à
[RN-521](../business-rules.md#rn-521). Nenhum dos dois é editado; este
documento os referencia. **Só a metade de TELA foi entregue** — a metade do
instalador foi medida e parou, pelo motivo da seção "A metade que parou".

## Context

Uma instalação real da v6.1.0, feita pelo one-liner em 2026-09-14, criou pela
web um projeto em `mounted`. Ele foi o modo **pré-selecionado**: o `install.sh`
sempre grava `BRABO_PROJECTS_BASE` (a base consentida, [RN-531](../business-rules.md#rn-531)),
e com base conhecida a [RN-513](../business-rules.md#rn-513) pré-seleciona
`mounted`. O que se seguiu no event log:

- 6× `dev.started` → 6× `dev.blocked_by_container`;
- 2× `container.start_failed` com *"BROKER_URL não está definida — o broker de
  container não faz parte desta instalação…"*.

Ninguém trabalha naquele projeto, para sempre. `container` e `mounted` só sobem
container pelo BROKER ([ADR 0144](0144-a-segunda-raiz-do-broker.md)), e sem
container `running` nenhum comando de dev agent roda
([ADR 0143](0143-agentes-de-dev-so-depois-do-container.md)). Só `runner` não
depende dele: quem sobe o container é o agente local, na máquina do usuário
([ADR 0137](0137-o-runner-sobe-o-container-do-projeto.md)). E a página
`/containers` deixou aprovar as duas `container_start` que só podiam falhar.

**Medido, e diferente da descrição da atividade:** o compose de instalação não
"herdou o broker sob profile desligado". O serviço `broker` **não existe** em
`docker/docker-compose.install.yml` — o cabeçalho dele diz isso no ponto 3 —,
e a ausência foi decidida por escrito na decisão 7 do
[ADR 0150](0150-instalador-de-uma-linha.md), que também a declarou "na saída do
instalador". O defeito não é o instalador esconder a ausência: é a TELA não
saber dela, e oferecer — pré-selecionar, até — o modo que a ausência inutiliza.

## A metade que parou: o instalador não consegue obter a imagem do broker

A decisão do mantenedor tinha uma parte (a): o `install.sh` perguntar se liga o
broker, com o risco dito em texto (o socket do Docker montado num serviço é
root-equivalente no host). Antes de escrever a pergunta, mediu-se se a
instalação consegue ter a imagem que a resposta "sim" subiria. **Não consegue:**

- `docker-bake.hcl` tem quatro alvos (`api`, `engine`, `web`, `backup`);
  `scripts/ci/images-manifest.ts` não conhece `broker`; e o `images.json` da
  Release v6.1.0 lista exatamente essas quatro;
- `docker manifest inspect ghcr.io/daneiel/brabo-broker:6.1.0` responde
  `denied` (o repositório não existe), enquanto o MESMO comando anônimo para
  `ghcr.io/daneiel/brabo-api:6.1.0` resolve — não é falta de credencial;
- os assets da Release v6.1.0 não trazem `docker/broker/Dockerfile.prod` nem o
  código de `apps/broker`/`packages/docker-port`, então uma instalação por
  one-liner, que roda numa pasta sem checkout ([ADR 0160](0160-o-compose-do-instalador-viaja-assinado.md)),
  não tem nem o que construir.

Uma pergunta cujo "sim" não tem imagem para subir é pior do que nenhuma: a
pessoa consente com o risco do socket e recebe um `pull access denied`. Só
`--source=local` (checkout limpo, em tag) poderia construir o broker — e mesmo
ali o compose de instalação não tem o serviço. A correção é a que o ADR 0150
já nomeou como pequena e fora do escopo dele: publicar o broker como quinta
imagem (um alvo no bake, um id no manifesto, uma assinatura a mais), e SÓ
DEPOIS a pergunta do instalador. Fica para frente própria, e é ela que reabre
esta metade. O `install.sh` não foi tocado por este ADR.

## Decision

### 1. A api diz se a instalação tem broker, nas duas rotas que a tela já lê

`brokerConfigurado: boolean` entra em **duas respostas existentes** e em
nenhuma rota nova:

- `GET workspaces/:workspaceId/projects-base` — a pergunta do assistente de
  criação já era *"que modo esta INSTALAÇÃO consegue executar?"*, e a base era
  só metade dela. Mesmo mínimo (`maintainer`), mesmo chamador, mesmo instante;
- `GET workspaces/:workspaceId/containers` — por LINHA, com o mesmo valor em
  todas. A resposta é uma lista, e trocá-la por envelope quebraria o contrato
  por um campo que é da instalação.

A fonte é `ContainerBrokerPort.configurado()`, a MESMA que decide se a leitura
do estado observado pergunta ao broker ou declara ausência — ler `BROKER_URL`
uma segunda vez seria a segunda fonte que um dia diverge. O campo diz que a
variável EXISTE, nunca que o broker RESPONDE: quem sabe disso continua sendo
`naoObservado` ([RN-486](../business-rules.md#rn-486)).

### 2. O assistente não pré-seleciona `mounted` sem broker, e oferece `runner`

Três estados, que não colapsam:

- **broker confirmado** (`true`): comportamento da RN-513 intacto — com base,
  `mounted` pré-selecionado;
- **ausência confirmada** (`false`): `container` e `mounted` continuam NA TELA
  (tirar o card esconderia a informação — a régua "tira-se o controle, nunca
  a informação" da [RN-102](../business-rules/custo.md#rn-102))
  mas **inertes**, o motivo é dito UMA vez em texto abaixo deles, e `runner` é
  o pré-selecionado. Uma escolha humana feita antes de a resposta chegar, num
  modo que ela torna inexecutável, cai para `runner` — a mesma regra que já
  derrubava `mounted` quando a base some;
- **não sei** (carregando, consulta que falha, campo ausente): nem "tem" nem
  "não tem". Não pré-seleciona `mounted` — a revisão da RN-513 —, e também não
  trava cards nem afirma em texto uma ausência que ninguém confirmou: fica
  `container` selecionado, como antes.

### 3. A `/containers` recusa a subida antes do clique, com motivo próprio

`decidirSubida` ganha o motivo `sem_broker_na_instalacao`, para `container` e
`mounted` quando `brokerConfigurado !== true` — "não sei" não vira "tem". Ele
vem logo depois de `ja_esta_de_pe` e ANTES de `sem_imagem_decidida`: numa
instalação sem quem suba o container, mandar decidir a imagem seria apontar a
porta errada. `runner` nunca cai nele. A ramificação é a mesma por DESTINO de
`acaoDeSubidaDoModo` (quem depende do broker é quem propõe `container_start`),
lida do outro lado por `usaBroker`, e não uma segunda régua.

## Consequences

- Numa instalação por Release, o modo que funciona de ponta a ponta passa a
  ser o sugerido, e o que não funciona passa a dizer por quê antes de alguém
  escolhê-lo. O preço: `runner` exige o agente local de pé e o Docker da
  máquina do usuário — o que a instalação por one-liner já entrega
  ([ADR 0155](0155-a-primeira-conta-nasce-no-terminal.md)).
- No compose de DESENVOLVIMENTO o broker sobe por padrão ([RN-512](../business-rules.md#rn-512)),
  mas `BROKER_URL` continua vazia até alguém a pôr no `.env`
  (`docker/docker-compose.yml`, `.env.example`). Sem ela, o assistente de quem
  desenvolve passa a mostrar o aviso — e está CERTO: sem `BROKER_URL`, a api
  nunca chama o broker que está de pé, e `container_start` falharia igual.
- A RN-512 NÃO muda: o broker segue sob `profiles: ["container-broker"]` no
  compose de produção, fora do compose de instalação, e nenhuma das cinco
  camadas de contenção é tocada. O que muda é a TELA parar de supor o
  contrário.

**Fora de escopo, declarado:**

- a metade do instalador (seção acima) — depende de publicar a imagem;
- a conversão de modo (`ExecutionModeSection`, [ADR 0111](0111-conversao-de-execution-mode-de-projeto-existente.md))
  continua podendo converter para `container`/`mounted` numa instalação sem
  broker; ela lê a mesma rota e o campo está à mão, mas é outra tela, com
  outra régua de oferta ([RN-559](../business-rules.md#rn-559));
- parar e remover (`container_stop`/`container_remove`) não ganharam a recusa:
  sem broker não há container de `container`/`mounted` registrado como de pé
  para parar, e o caso não foi medido;
- o Infra Lead não sabe de broker ausente — ele recusa por MODO
  ([RN-566](../business-rules.md#rn-566)), e enriquecer o contexto dele com a
  instalação é a frente mais cara que a RN-566 já declara;
- a sugestão de paralelização que ignora agente bloqueado por container;
- a frase de fechamento do `install.sh` diz que sem broker "projeto em modo
  Pasta montada não sobe container" e omite o modo `container`, que também
  não sobe — adjacência medida e não corrigida aqui, porque o instalador é de
  outra frente em paralelo.

---
id: fase-30-runner-por-maquina
title: FASE 30 — o agente local da máquina
sidebar_label: FASE 30 — agente local da máquina
sidebar_position: 17
description: O recorte da FASE 30 — a identidade do agente local deixa de ser por projeto e passa a ser da máquina, e o instalador fecha a instalação criando a primeira conta e subindo o agente pareado. As decisões estão nos ADRs 0154 e 0155.
keywords: [fase 30, runner, agente local, chave de dispositivo, instalador, serviço]
---

# FASE 30 — o agente local da máquina

> Este documento é o **recorte** da fase: o que ela persegue, o que ela recusa,
> e em que ordem. As **decisões** moram no
> [ADR 0154](../adr/0154-chave-de-dispositivo-de-maquina.md) e no
> [ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md) — o que estiver
> aqui e lá em desacordo, vale o ADR.

## O que a fase persegue

Instalar o Brabo numa linha e **usar**. Hoje a
[FASE 29](fase-29-instalacao-de-uma-linha.md) entrega quase isso: o
`install.sh` verifica a própria origem, sobe o compose, instala o binário do
runner com `install -m 0755` e grava a base. E então para, em dois pontos que
o próprio produto já declarava por escrito.

**O primeiro é o agente local.** A última linha do instalador diz que ele não
pareia o agente com um projeto, e que a chave de dispositivo continua vindo da
tela. Quem quiser usar o binário instalado volta ao navegador e termina colando
no terminal o comando que `apps/web/src/lib/runner-bootstrap.ts:398` monta. O
comentário ao lado explica por que a tela não consegue evitar isso — *"uma
página web não executa binário na máquina de ninguém"* — e está certo. O que
ele não cobre é que **o instalador não é uma página web**: ele roda no
terminal, com TTY, e o [ADR 0150](../adr/0150-instalador-de-uma-linha.md)
recusou `curl | sh` justamente para poder perguntar.

**O segundo é que ninguém consegue entrar.** Medido nesta fase: o `.env`
gerado não tem nenhuma variável de e-mail, `MAIL_TRANSPORT` cai em `log`
(`docker/docker-compose.install.yml:200`), e o registro exige verificar
e-mail — que, como o docblock de `apps/api/src/scripts/provisionar-usuario.ts`
já registrava, *"com o `MailSender` log-only não fecha sozinho"*. A instalação
de uma linha termina dizendo "Pronto" e deixando a pessoa pescar um link de
verificação em `docker compose logs api`.

Os dois se resolvem no mesmo lugar, e é isso que faz uma fase só.

## O que a medição mudou no recorte

A FASE 29 tirou o runner por máquina do escopo com uma medição: *"um runner
por projeto está imposto em cinco lugares independentes"*. Remedindo com
`arquivo:linha`, **três dos cinco não precisam mudar** — e isso encolhe a fase
pela metade.

| # | onde | o que impõe | esta fase |
|---|---|---|---|
| 1 | `terminal_channel.ex:204` | tópico `terminal:<projectId>` | **não toca** |
| 2 | `runner_socket.ex:73` | socket id com `project_id` | **não toca** |
| 3 | `Engine.Runners.SocketTicket` | ticket carrega `project_id` | **não toca** |
| 4 | `apps/api/src/db/schema/auth.ts:325-326` | `project_id` `NOT NULL` | vira nullable |
| 5 | `apps/runner/src/servico.ts:264,391` | unit `brabo-runner-<projectId>` | vira uma por máquina |

O motivo está no ADR 0154: os itens 1, 2 e 3 descrevem uma **conexão**, não um
processo. Um processo que abra **N conexões** — uma por projeto — os satisfaz
byte a byte, e preserva a recusa de segundo runner no mesmo projeto, que é uma
garantia real e não um acidente. O que sobra é o que é do processo: a
credencial (4) e a unit (5).

**Nada no engine muda nesta fase.** Foi o achado mais útil da medição, e é o
que mantém `RunnerReadiness` (RN-507), o espelho (RN-516) e `workspace_create`
(RN-532) byte a byte.

## As sessões

Uma entregável cada. A coluna "depende de" é que ordena.

| # | entregável | depende de | proibições próprias |
|---|---|---|---|
| 1 | este documento, os ADRs 0154/0155 e a faixa de RN | — | não toca `apps/`, `docker/`, `scripts/`, `install.sh`; não edita ADR aceito |
| 2 | **FECHADA** — api: `project_id` nullable, chave de máquina aceita em `runner-ticket`, `GET runner/projects` ([RN-543](../business-rules.md#rn-543)) | 1 | não toca o engine; não afrouxa papel de rota nenhuma |
| 3 | **FECHADA** — runner: N conexões, uma por projeto, descobertas pela rota ([RN-544](../business-rules.md#rn-544)) | 2 | não toca `RunnerReadiness`, o espelho nem `workspace_create` |
| 4 | **FECHADA** — runner: unit por máquina no `service install`, convivendo com as por projeto ([RN-545](../business-rules.md#rn-545)) | 3 | não remove a unit por projeto; não muda `Restart=on-abnormal` |
| 5 | **FECHADA** — api: `POST /internal/first-account`, conta verificada + workspace pessoal, `409` com qualquer usuário ([RN-546](../business-rules.md#rn-546)) | 1 | não cria rota pública; não toca o registro normal |
| 6 | `install.sh`: consentimento, conta, chave de máquina e `service install` (RN-547) | 4, 5 | não grava senha em lugar nenhum; sem TTY relata e sai 0 |
| 7 | **FECHADA** — web: a tela do projeto reconhece agente de máquina já pareado ([RN-548](../business-rules.md#rn-548)) | 3 | não remove o fluxo do ADR 0118 |
| 8 | E2E em máquina limpa, docmap, `docs:check` (RN-549) | 6, 7 | não afrouxa gate para o E2E passar |

### O que a sessão 2 fechou, e o que ela deixou declarado

A metade da api está de pé: `runner_device_keys.project_id` é nullable, o
`PatAuthGuard` resolve o papel contra o projeto **pedido** quando a credencial
não nomeia nenhum, e `GET runner/projects` existe. Duas coisas que a medição do
recorte não antecipava e a implementação obrigou a decidir, as duas registradas
na [RN-543](../business-rules.md#rn-543):

- **A listagem da RN-519 passou a devolver as duas espécies, marcadas.** Uma
  chave de máquina que não entrasse em listagem nenhuma seria invisível e
  permanente — o defeito que a RN-519 fechou, renascido na espécie nova.
- **A revogação ganhou alvo PLURAL.** `revogar` de uma chave de máquina não tem
  um `projectId` a passar ao engine; deixar de derrubar reabriria a RN-520 em
  N conexões. Um `{projeto, usuário}` por projeto em modo `runner` do dono,
  **sem tocar o engine**.

E o que segue **declarado, não feito**: nenhuma rota da api CRIA chave de
máquina ainda — quem registra é o `install.sh` ([ADR 0155](../adr/0155-a-primeira-conta-nasce-no-terminal.md)
ponto 4), na sessão 6. A rota nasce no PR que tiver o primeiro chamador real.

### O que a sessão 3 fechou, e as três decisões que ela teve de tomar

O agente local abre N conexões de verdade, e a medição do recorte se
confirmou: **nada no engine mudou**, e os handlers do runner (`tratarExec`,
`tratarMirrorSync`, `tratarWorkspaceCreate`) não mudaram uma linha — o que
forçou o desenho foram os quatro campos POR PROJETO de `EstadoDoRunner`, que
viraram N estados com `docker` e `base` compartilhados por valor. O modo antigo
ficou byte a byte, e o portão novo é estreito: credencial de máquina **e** base
consentida.

Três coisas o recorte não antecipava, e a [RN-544](../business-rules.md#rn-544)
as registra:

- **Um projeto recusado não derruba os outros.** O teto de tentativas e a
  recusa de join deixaram de ser do PROCESSO e passaram a ser do PROJETO; só
  quando nenhum sobra o processo sai com 1, com o desfecho de cada um. No modo
  de projeto único a disposição antiga fica idêntica, pelo raciocínio
  invertido: com UMA conexão, não sobra nada a atender.
- **A lista é consultada só no start.** Repesquisar faria uma lista que volta
  MENOR — apagado? convertido? 500 transitório? — derrubar conexão viva por
  ambiguidade. O processo diz isso ao subir, e o gesto é reconectar.
- **Lista vazia é estado NORMAL, com saída 0.** É o estado de toda instalação
  nova, e `Restart=on-abnormal` não a reergue de propósito. *(Revisado na
  sessão 8, [RN-550](../business-rules.md#rn-550): com ZERO conexões o agente
  passa a FICAR DE PÉ e reconsultar — a metade "só no start" fica intacta para
  quem tem conexão viva.)*

E o que segue **declarado, não feito**: a `apiUrl` no modo de máquina vem de
`--api-url`/`BRABO_API_URL`/default, e nunca do `brabo-runner.config.json`, que
é por PROJETO — quem escreve a flag é a unit por máquina, da sessão 4. A unit
continua por projeto: esta sessão mudou o PROCESSO, não o serviço.

### O que a sessão 4 fechou, e as três decisões que ela teve de tomar

O quinto e último acoplamento da tabela acima fechou: `service install
--machine` instala `brabo-runner.service` / `dev.brabo.runner`, sem sufixo, e
põe de pé o processo que a sessão 3 criou. A unit por projeto **não foi
removida nem renomeada**, `Restart=on-abnormal` ficou byte a byte (trocá-lo
desfaria também a decisão da sessão 3 de fazer lista vazia sair com 0), e nada
na api, no engine ou no web foi tocado.

Uma medição mudou o mecanismo, e ela contraria a letra do ADR 0154 ponto 5.
O ADR escreveu *"`service install` sem `--project` instala a unit de máquina"*;
`resolverProjeto` tem **duas** fontes, e o caminho normal de hoje é rodar
`install` sem flag nenhuma de dentro da pasta que o navegador configurou — é o
`brabo-runner.config.json` que responde. Ao pé da letra, o ADR converteria em
silêncio a instalação de quem já usa o produto, que é o oposto do que o mesmo
ponto 5 promete. Então o discriminador virou a flag **`--machine`**, opt-in
explícito, com as duas fontes de projeto intactas.

As três decisões que o recorte deixava em aberto, registradas na
[RN-545](../business-rules.md#rn-545):

- **`status` responde sobre a espécie perguntada, e o código não soma.** Os
  quatro estados e os quatro códigos (RN-088) não viram oito; a outra espécie
  aparece em TEXTO, como presença lida do **disco**, dizendo que o estado dela
  não foi perguntado ao gerenciador. Sem `--machine` e sem projeto resolvível, a
  resposta é sobre a **máquina** — a única unit cujo nome não precisa de
  argumento.
- **`install` RECUSA quando a outra espécie já está instalada.** Não remove
  nada, não grava nada, e nomeia o `uninstall` de cada unit encontrada. Sem
  `--force`: as duas juntas seriam dois processos disputando o mesmo projeto, e
  o servidor negaria um deles. A garantia do ponto 5 (unit já instalada continua
  funcionando) fica intacta — o que se recusa é criar a sobreposição agora.
- **`uninstall` sem espécie nomeada não remove nada**, e lista o que existe.
  Ele não herda o default de `status` de propósito: ler a espécie errada custa
  uma linha errada, remover a errada custa um serviço e uma chave.

Duas recusas próprias do `install --machine` não estavam no recorte e são
medidas: a pasta não pode ter `brabo-runner.config.json` (o serviço subiria em
modo de PROJETO, em silêncio, atendendo um só) e a base precisa estar consentida
(sem ela o agente sai em `uso()` no primeiro boot). A unit congela
`XDG_CONFIG_HOME` — é ela que decide onde o arquivo da base mora, e nenhum dos
dois gerenciadores repassa o ambiente do shell — mas **nunca** o valor da base.

E o que segue **declarado, não feito**: o `install --machine` não sabe se a
chave daquela pasta é mesmo de máquina (em disco as duas espécies são o mesmo
arquivo, e quem sabe é o servidor), então uma pasta com chave de projeto instala
a unit sem erro e a recusa aparece no primeiro boot. E ninguém CRIA chave de
máquina ainda — é a sessão 6.

### O que a sessão 5 fechou, e a decisão que o ADR 0155 não tinha

A sessão 5 fechou com uma decisão que o ADR 0155 não tinha enfrentado, e ela
vale para quem pegar a sessão 6: `provisionarUsuario` **recusa rodar com
`NODE_ENV=production`**, e o instalador roda exatamente lá. Em vez de
`BRABO_FORCE_SEED`, o núcleo virou `ProvisionarUsuarioUseCase` e **a recusa
ficou no script** — o que ela protege é senha CONHECIDA criada SEM interação
humana, e a rota é outra categoria. A sessão 5 também acrescentou o que o ADR
não dizia e a [RN-410](../business-rules.md#rn-410) exige: o **workspace
pessoal** nasce na mesma transação, senão a instalação fecharia com um login
que atravessa e um dashboard onde "Novo projeto" não tem onde criar.

### O que a sessão 7 fechou, e as três decisões que ela teve de tomar

A marca de espécie que a sessão 2 acrescentou à listagem — *"sem elas na lista,
uma chave de máquina seria invisível em toda tela"* — ganhou consumidor. O
painel de onboarding do runner passa a reconhecer chave de MÁQUINA ativa e, com
ela, para de mandar parear: o que falta não é pareamento, é o agente estar
rodando. Nada da api, do engine ou do runner foi tocado.

As três decisões que o recorte deixava em aberto, e o que cada uma virou
(a [RN-548](../business-rules.md#rn-548) tem o porquê inteiro):

- **Onde aparece: no PAINEL, e por isso nos três montadores de uma vez — mas
  não com o mesmo resultado.** O reconhecimento é por PROJETO, porque a rota é
  `GET /projects/:projectId/runner-device-keys`: `TerminalPanel` e
  `FolderBrowserModal` sempre têm projeto, e o `NewProjectWizard` só depois da
  criação antecipada ([RN-437](../business-rules.md#rn-437)). Sem `projectId`
  não há a quem perguntar. `AmbienteDoProjeto` foi CONSIDERADO e recusado: o
  docblock dele já declara que presença de runner é conhecimento de primeira
  mão do canal, e uma linha sobre chave registrada ali seria um terceiro proxy
  competindo com um sinal mais forte — e sobre a MÁQUINA, não sobre o projeto.
- **Com chave e sem conexão viva — o caso mais comum — a tela diz as duas
  coisas que sabe e nomeia as duas que não sabe.** Anuncia o pareamento (com os
  nomes das chaves e a data do último uso), e ao lado: *chave registrada não é
  agente rodando* e *a lista é da sua CONTA, não deste navegador*. É a régua do
  `workspaceVerifiedAt` aplicada um passo antes, tom `accent` e nunca `success`
  incluído. O gesto que ela oferece é conferir o SERVIÇO na máquina pareada, e
  quem responde pelo agora continua sendo a `EsperaDoRunner`, reusada.
- **A espécie aparece pelo CUSTO dela, não como rótulo.** O painel não lista
  chaves nem revoga — diz que uma chave de máquina atende todos os projetos do
  dono, e que revogá-la derruba o agente local em todos eles.

E o que segue **declarado, não feito**: ninguém CRIA chave de máquina ainda (é o
`install.sh`, sessão 6), então hoje a tela só é exercitável com uma chave
registrada à mão. O comando oferecido é
`brabo-runner service status --project <id>`, a forma que existe hoje — a por
máquina chega com a unit da sessão 4. Uma chave de PROJETO ativa não muda o
painel: é o defeito irmão, um escopo abaixo. E a tela de listar/revogar chave
continua não existindo.

### O que a sessão 8 fechou, e as duas decisões que ela teve de tomar

As duas peças que faltavam **do lado do agente**, e as duas vêm do ADR 0155.

A primeira é uma REVISÃO da sessão 3, e a decisão é a ASSIMETRIA
([RN-550](../business-rules.md#rn-550)): com **zero** conexões o agente deixa
de sair e passa a ESPERAR, reconsultando `GET runner/projects` a 15s/30s/60s
até o primeiro projeto aparecer; com conexão **viva**, a lista continua sendo
lida só no start, byte a byte. O argumento da sessão 3 continua inteiro onde
ele vale — lista que volta MENOR é ambígua, e derrubar conexão viva por
ambiguidade troca estado certo por palpite —, e com zero conexões não há nada
a derrubar. O que caiu foi o argumento do `exit 0` ("um serviço ativo que não
faz nada"), porque o processo passou a fazer algo e a dizer que faz. Medido
nesta sessão: `Restart=on-abnormal` **não olha código de saída** — ele reergue
por sinal, watchdog ou timeout —, então nada nas duas units muda, e o efeito é
a unit de máquina ficar `active (running)` de verdade. Esperar não tem teto;
falhar tem (dez consultas seguidas, saída 1 nomeando o número).

A segunda fecha a lacuna que as sessões 2, 3 e 4 declararam — *"ninguém CRIA
chave de máquina ainda"* — pela metade que é do agente
([RN-551](../business-rules.md#rn-551)): `brabo-runner device-key
create|finish` gera o par Ed25519 **nesta máquina**. A decisão aqui é o CORTE:
o CLI **não** fala com a api, porque quem registra é o instalador com o
`BRABO_SERVICE_TOKEN`, e dar esse segredo ao agente ampliaria o que ele pode
muito além do que ele precisa — cada lado guarda um segredo e nenhum vê o do
outro. Disso decorre o desenho de dois passos: o `kid` é o id do REGISTRO e só
existe depois dele, então o `create` grava um `.parcial` que o leitor ignora e
o `finish` grava o nome de verdade. **O arquivo que o runner lê nunca existe
sem `kid`** — o defeito da RN-475, impossível por construção.

O que segue **declarado, não feito**: a ROTA que registra a pública de máquina
e o `install.sh` que encadeia os três comandos continuam sendo a sessão 6.

Faixa reservada: **RN-543..555**. ADRs **0154** e **0155**. A RN-541 já está
alocada em branch não mergeada — o salto é deliberado, pelo critério que a
FASE 29 registrou ao resolver três colisões pela data.

## O que esta fase NÃO toca

Declarado nos dois ADRs, e repetido aqui porque é o que dá sentido ao resto:

- `decide.ts` e os tetos absolutos — nenhum ganha exceção, nem configurável
- `proposed_action` como origem de todo efeito externo de agente; criar pasta e
  parear agente continuam sendo **configuração consentida**, não ação de agente
  (a linha da RN-516)
- a imutabilidade do event log
- `RunnerReadiness` (RN-507) e suas três pré-condições — e **nunca** uma flag
  "pula container", pelo motivo do ADR 0147 ponto 4
- o espelho (RN-515/516/517) e `workspace_create` (RN-532): os dois são por
  projeto e viajam na concessão do `join` daquela conexão
- o registro normal com verificação de e-mail, e o default `MAIL_TRANSPORT=log`
- o fluxo de configuração pelo navegador ([ADR 0118](../adr/0118-configuracao-do-runner-pelo-navegador.md))

## Lacunas que a fase encosta e não resolve

- **A revogação continua alcançando `{projeto, usuário}`, nunca `{chave}`**
  (RN-520) — e passa a custar mais: revogar derruba o agente de **todos** os
  projetos daquela máquina. A FASE 29 declarou esse custo por antecipação;
  aqui ele chega. Fechar exige mudar o alvo da revogação, que é frente própria.
- **Não há tela onde listar e revogar chave de dispositivo.** A RN-519 abriu o
  `GET` na api; o web nunca ganhou a tela. A fase acrescenta uma espécie de
  chave a listar e não constrói a tela — a lacuna fica maior, e declarada. A
  [RN-548](../business-rules.md#rn-548) passa a CONSUMIR essa listagem no
  painel de onboarding, o que não a fecha: ler para reconhecer é outra coisa
  que listar para revogar.
- **Ponto único de falha.** Um processo por máquina no lugar de N: o serviço
  cair tira o agente de todos os projetos. É o preço do desenho, não um
  descuido.
- **A credencial de git segue descartada no `docker exec` em modo `runner`**
  ([ADR 0145](../adr/0145-docker-pre-requisito-do-runner.md)) — esta fase não
  a toca, e nada aqui a piora.
- **BRB-031** fecha por decisão do mantenedor, não por consequência: a fase
  cria o caminho sem `chmod` e **mantém** o do navegador. Escolher aposentar o
  segundo é decisão à parte.
- **BRB-017** (obrigação GPL da imagem do engine, P1) fica onde estava, e esta
  fase o torna mais concreto pelo mesmo motivo que a FASE 29: mais instalações
  em máquinas de terceiros.

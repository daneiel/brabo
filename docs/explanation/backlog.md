---
sidebar_position: 8
---

# Backlog triado

Saída da **FASE 13c**. Reúne os achados abertos da execução real
([achados-execucao-real.md](achados-execucao-real.md)) e os itens antigos que
viviam espalhados por ADRs e pelo CLAUDE.md.

> É **proposta**. A classificação e o agrupamento abaixo são um argumento sobre
> o que custa mais esperar; a decisão de prioridade é do usuário.

## Como está classificado

**P1** — bloqueia o produto de fazer o que ele promete. **P2** — o produto faz,
mas mente ou confunde quem olha. **P3** — qualidade, sem quem esteja preso.

**Custo**: P (uma sessão), M (uma fase pequena), G (fase própria, com ADR).

**Risco de esperar** é a coluna que decide empate: um defeito que corrompe dado
ou apaga evidência custa mais tarde do que hoje; um cosmético custa igual.

## O quadro

| fase proposta | itens | prio | custo | risco de esperar |
|---|---|---|---|---|
| ~~A — Destravar a task~~ | ~~ADR 0052, O/B~~ | **FEITA** | — | RN-072 e RN-073 |
| ~~B — Engine em provider remoto~~ | ~~N~~ | **FEITA** | — | RN-076; ADR 0056 aceito |
| ~~F — Fronteira e teto do executor~~ | ~~S, U~~ | **FEITA** | — | RN-074 e RN-075; ADR 0055 aceito |
| ~~C — A UI não pode mentir sobre agentes~~ | ~~C, I, H, L, G~~ | **FEITA** | — | os cinco itens |
| ~~D — Wizard diz a verdade e tem saída~~ | ~~D, E, F~~ | **FEITA** | — | RN-078; E e F já estavam feitos |
| ~~G — O desfecho de falha diz a verdade~~ | ~~P, Q, T~~ | **FEITA** | — | RN-077 |
| ~~H — Estado de sessão não mente~~ | ~~V~~ | **FEITA** | — | RN-064 ampliada |
| ~~E — Qualidade do que os agentes produzem~~ | ~~K, R, J~~ | **FEITA** | — | RN-079, RN-080 e RN-081 |
| ~~— avulso~~ | ~~promotion-check sem spec~~ | **FEITO** | — | 10 casos, verificados por mutação |
| ~~I — O dev agent começa do zero~~ | ~~X, Y~~ | **FEITA** | — | RN-085; Y fechado na 13b, X na FASE 14d |

**Cobertura: 19 de 19** dos achados da execução real, mais **oito novos**
(W, X, Y, Z, AA, AB, AC, AD, AE) vindos da validação da FASE 13b — ver
[validacao-real.md](validacao-real.md).

Destes, **cinco fecharam**: W, Y, AA, AB e AC na própria 13b, e X pela FASE 14d
([RN-085](../business-rules.md#rn-085)) — o teto de iterações virou por TIPO de
agente, que era a forma que a triagem tinha proposto e a decisão de produto que
faltava.

**Três seguem abertos**, e nenhum é bug a corrigir:

| achado | o que é | por que não é conserto |
|---|---|---|
| **Z** e **AD** | o allowlist de verbos não converge — verbo, forma e invocação são espaços distintos | o allowlist cumpre o que promete, e a recusa do `bash` prova que a fronteira segura. É decisão de PRODUTO sobre política por perfil de agente, com ADR |
| **AE** | o agente de QA tenta consertar o código que julga | nada vazou: barrado por duas barreiras independentes. O dado é a divergência entre o que o prompt pede e o que o modelo faz |

A conclusão prática da 13b já foi implementada e não espera nada: o caminho não
é afrouxar política, é o agente ESPERAR a decisão em vez de morrer
([ADR 0057](../adr/0057-o-gate-espera-a-aprovacao.md), estendendo o 0052).

As letras de fase (A–H) e as de achado (B–V) colidem por herança das duas
listas; onde houver ambiguidade o texto diz "achado".

Dois saíram da lista de abertos desde a primeira triagem: **A**
([RN-067](../business-rules.md#rn-067)) e **M**
([RN-066](../business-rules.md#rn-066)), ambos fechados e confirmados em
produção. E o **ADR 0052**, que era metade da Fase A, foi implementado e provado
por teste — a entrega do wake foi corrigida e coberta de ponta a ponta depois
disso.

O resto (itens antigos) está em [Backlog anterior](#backlog-anterior), sem
prioridade atribuída: são decisões de produto, não defeitos.

---

## Fase A — Destravar a task (P1) — **FEITA**

**Nenhum dev agent jamais terminou uma task.** Era o fato que ordenava tudo: o
registro de gates da FASE 15a mostra `qa-verificada`, `secops-segura` e os dois
de infra como *"nunca passou"* — não por falta de execução, mas porque nunca
existiu PR para gate nenhum julgar.

| item | o que era | como fechou |
|---|---|---|
| **ADR 0052** | aprovação pendente devolvia `status pending` como resultado da ferramenta e queimava uma iteração; o agente morria no teto sem escrever nada | o laço SUSPENDE e retoma ([RN-073](../business-rules.md#rn-073)); a entrega do desfecho foi corrigida depois — o evento nascia num agregado que o dreno do engine não lê — e o caminho está coberto de ponta a ponta |
| **O / B** | sessão e dev agents nasciam no `llama3.2:1b` local, que o ADR 0020 proíbe no passo semântico | quando a cascata pousa no default do workspace, o modelo herdado é o do **Criativo** ([RN-072](../business-rules.md#rn-072)) |

A herança ocupa o **vazio** e nunca sobrepõe: binding de sessão, de agente ou de
projeto são escolhas explícitas e continuam vencendo. E o modelo herdado passa
pelos mesmos filtros da cascata — sumido do catálogo ou sem tool calling não é
herdado.

Fechar esta fase **não** foi suficiente, e isso é o achado mais útil dela: o
agente passou a andar e morreu de outra coisa (Fase F, o `413`). *"Nenhum dev
agent jamais terminou uma task"* continua verdadeiro — o que mudou é o motivo.

**Risco de esperar: alto.** Enquanto isso não fecha, PR remota, gates de
QA/SecOps e a medição da 13b ficam represados atrás — e cada rodada de
dogfooding gasta dinheiro para reconfirmar o mesmo bloqueio.

## Fase B — Engine em provider remoto (P1) — **FEITA**

**N** — `get_local_repo_path/1` devolvia `unsupported_provider` para tudo que
não era `local`, e quatro consumidores paravam junto. A **api** fala GitHub por
HTTP; o **engine** trabalha no sistema de arquivos e só conhecia bare repo
local, então projeto remoto fazia a metade conversacional e parava na de
construção.

Fechou pelo [ADR 0056](../adr/0056-o-engine-trabalha-em-repositorio-remoto.md) e
pela [RN-076](../business-rules.md#rn-076): o engine pede o remoto de trabalho à
api, que é quem tem a chave mestra, e a credencial entra **por invocação** — a
origem gravada no `.git/config` é limpa.

**A descoberta que encolheu o problema:** dois dos quatro consumidores nunca
precisaram de credencial. `Diff` e `ProjectContext` só usam o NOME da branch —
paravam por dano colateral de uma função que devolvia mais do que eles pediam.

### O que a Fase B NÃO fechou

- **Isolamento**, de novo. O token saiu do disco, mas o agente segue no mesmo
  container que o monorepo do Brabo. É a mesma pendência que o ADR 0055 já
  declarava, e ela agora tem duas fases apontando para si.
- **Prova contra um GitHub de verdade.** `fetch` e `push` passam por `GitAuth`,
  e os testes cobrem o caminho local de ponta a ponta (push que chega no bare
  do outro lado) e os erros nomeados. O que nenhum teste pode dar é um
  repositório remoto real com token real — isso é a execução da 13b, que agora
  tem como acontecer.

## Fase F — Fronteira e teto do executor (P1) — **FEITA**

A execução do `hello-limpo` morreu aqui, e os dois itens tinham a mesma origem:
o executor de terminal não tinha limite — nem de **onde** o comando alcança, nem
de **quanto** ele devolve.

| item | o que era | como fechou |
|---|---|---|
| **S** | o contexto acumulado estourava o limite de bytes do provider e a chamada voltava `413`. Cada saída de terminal ficava no histórico e viajava em todo turno seguinte | teto de bytes no executor, com marca endereçada ao modelo ([RN-074](../business-rules.md#rn-074)) |
| **U** | `/workspace` dentro do executor é o monorepo do **próprio Brabo**, e `/data/project-workspaces/*/` dá acesso ao worktree de outros projetos | escopo de caminho na decisão ([RN-075](../business-rules.md#rn-075), [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) aceito) |

O escopo fechou os dois lados de uma vez: **apertou** (verbo liberado apontando
para fora deixou de auto-aprovar) e **afrouxou** (o `cd` para dentro deixou de
reprovar o comando composto, que era o defeito mais caro da escada).

### O que a Fase F NÃO fechou

Fica registrado em vez de ser dado como pronto:

- **Isolamento.** O ADR 0055 é política, e diz isso de si mesmo. Enquanto o
  monorepo do Brabo estiver montado no container que executa os comandos, a
  fronteira depende de a regra acertar. A normalização é léxica: `..` é
  reprovado, symlink de dentro apontando para fora não é detectado.
- **Ponto 6 do ADR — "Sempre permitir" generalizar.** Continua gravando o
  comando literal, que nunca volta a casar. Não entrou porque generalizar
  EXPANDE o que um clique autoriza (aprovar `cat foo` passaria a liberar
  `cat` em qualquer coisa), e essa é uma decisão de produto que merece
  escrutínio próprio em vez de carona.
- **Ponto 7 do ADR — o evento registrar qual escopo autorizou.** O motivo da
  decisão já diz, mas não é persistido em `proposed_action.created`.

## Fase C — A UI não pode mentir sobre agentes (P2) — **FEITA**

Cinco itens com a mesma raiz: a tela contava uma história diferente da do event
log.

| item | o que a tela faz | estado |
|---|---|---|
| **C** | a bolha ao vivo vem rotulada com o **modelo**; o agente só aparece quando o evento persistido chega — e a mensagem fica duplicada até o reload | **FEITO** — o delta passou a carregar o agente, e o refetch é adiado enquanto o turno streama |
| **G** | o convite do Criativo não aparece em projeto criado, porque o fio já tem os cards do bootstrap | **FEITO** — a condição passou a ser "a conversa começou", não "o fio está vazio" |
| **L** | o botão do rodapé continua "Estou pronto para produzir" depois do handoff | **FEITO** — some quando existe handoff saindo do Criativo |
| **H** | os eventos do bootstrap aparecem todos como "atividade em system" | **FEITO** — os cinco tipos ganharam família própria, com o passo traduzido |
| **I** | trocar o modelo da sessão reescreve retroativamente o rótulo de ações antigas | **FEITO** — o card deixou de afirmar um modelo que não tem como saber |

**C** era o mais grave dos cinco e foi apontado por você durante a execução:
quem fala é o agente, o modelo é detalhe de execução.

**I mereceu uma decisão, não só um conserto.** O card recebia o modelo ATUAL da
sessão, e não existe fonte verdadeira do modelo por ação — `proposed_actions`
não o guarda, e `token_usage` não se liga à ação. Entre inventar uma e parar de
afirmar, a segunda é a única honesta: quem propôs já está no card, em negrito, e
é o **agente**, que é o que não muda. O rótulo saiu junto com a prop, que ficou
sem nenhum outro consumidor.

**H** virou redação: os cinco tipos `bootstrap.step_*` ganharam família própria
com o passo traduzido para português, e só `step_failed` é marcado como ruim —
`degraded` e `skipped` são desfechos previstos, e pintá-los de vermelho ensinaria
a ignorar o vermelho. `create_rc_branch` continua traduzido mesmo aposentado
(ADR 0030), porque projetos bootstrapados antes têm o evento no log.

## Fase D — Wizard diz a verdade e tem saída (P2) — **FEITA**

| item | o que era | como fechou |
|---|---|---|
| **D** | `Proteger branches` falha em repo privado no plano gratuito, e o wizard **avisa isso antes**. A única ação oferecida depois era "Tentar novamente", que falha sempre | [RN-078](../business-rules.md#rn-078) |
| **E** | o preview do repositório mentia: `repo: brabo/{slug}` hardcoded, com o owner real vindo do PAT | já estava feito (commit `4dd7a073`) — o rótulo passou a mostrar só o slug, que é o que se sabe |
| **F** | o passo "Política de branches" listava `rc` nas permanentes | já estava feito (commit `4dd7a073`) |

**E e F já estavam corrigidos** quando fui atacá-los, num commit que fechou
quatro achados de uma vez. Descobrir isso custou uma leitura; o backlog não
sabia porque foi escrito antes.

**O item D era maior do que a descrição sugeria.** Não era só "tela sem saída":
`provision_failed` faz o dashboard **redirecionar o clique do projeto de volta
para a página de provisionamento**, então o projeto ficava inalcançável para
sempre, preso num passo que não tem como suceder. A saída precisou de rota,
caso de uso e evento — não só de um botão.

**Só a proteção pode ser reconhecida**, e essa é a decisão que importa: ela é o
último passo e o único cuja falha deixa um repositório utilizável. Oferecer
"seguir" numa falha anterior seria uma segunda mentira em cima da primeira.

## Fase G — O desfecho de falha diz a verdade (P2) — **FEITA**

A mesma regra do CLAUDE.md violada três vezes: **P** (`dev.blocked` com
`origin: null`), **Q** (`agent.error` com `"indeterminada"`) e **T**
(recorrência: `dev.blocked` com `"indeterminada"` numa falha cujo campo
`diagnosis` nomeava a causa na MESMA linha).

Fechou pela [RN-077](../business-rules.md#rn-077), e o diagnóstico da causa foi
o que mudou a forma do conserto: **o classificador já existia e já acertaria**
— `FalhaDeTurno.origem/1` mapeia status ≥ 400 para `codigo`, o que classifica o
`413` do achado T corretamente. O defeito nunca foi falta de regra; era
`block_task` ter `"indeterminada"` como **default**, e os call sites não
passarem nada.

Então o conserto é estrutural, não mais uma regra: **o default saiu**. Esquecer
a origem agora é erro de compilação, e não um evento sintaticamente válido e
semanticamente vazio.

`indeterminada` deixou de existir. Ela significava *o classificador não
reconheceu esta forma* — lacuna do nosso código —, e `codigo` é a origem que
aponta a ação certa. `indeterminada` não apontava nenhuma, que era exatamente a
queixa do achado.

## Fase H — Estado de sessão não mente (P2) — **FEITA**

**V** — a sessão `1f94de49` constava `closed` desde 23:34:42 e a execução seguiu
até 00:56.

A causa não era a máquina de estados: era **o heartbeat**. A sessão nasceu
23:34:12 e fechou 23:34:42 — exatamente os 30s de `SESSION_HEARTBEAT_TIMEOUT_MS`.
A [RN-064](../business-rules.md#rn-064) já mandava perguntar se havia trabalho
pendente antes de encerrar, mas "trabalho pendente" era só **handoff `offered`**
— e havia uma ação `pending` desde 23:34:13, criada um segundo depois de a
sessão nascer.

Ação aguardando decisão passou a contar. É o mesmo defeito do handoff um nível
abaixo: alguém está esperando **você**, e um agente pode estar suspenso
esperando o desfecho ([RN-073](../business-rules.md#rn-073)).

**A versão anterior da regra dizia, por escrito, que incluir trabalho de agente
"sem um teste que prove a interação seria adivinhar".** A execução produziu a
prova, e é isso que separa este conserto de um palpite.

### O que a Fase H NÃO fechou

- **Task `in_progress` sem ação pendente nem handoff.** O sinal exigiria a api
  ler `dev_agent_states`, que é do engine — decisão de fronteira, não conserto
  de passagem.
- **`closed` continuar aceitando aprovação.** Com o heartbeat corrigido, a
  sessão deixa de fechar com ação pendurada, então o caso fica raro. Bloquear a
  decisão numa sessão fechada é mudança de comportamento com consequência
  própria: uma ação órfã de uma sessão já encerrada ficaria sem ninguém para
  decidi-la.

## Fase E — Qualidade do que os agentes produzem (P3)

| item | o que acontece |
|---|---|
| **K** | rodar o Criativo duas vezes no mesmo projeto deixou 10 regras, 5 órfãs — sem dedupe nem aviso |
| **R** | o PO gerou duas histórias cobrindo o mesmo endpoint |
| **J** | o Psicólogo roda em sessão recém-aberta com as hipóteses da anterior e o log vazio, tenta citar eventos inexistentes e desiste |

**FEITA**, com um corte declarado no meio.

**J era mecanismo, ao contrário do que esta seção supunha.** Log vazio é
condição verificável, e o defeito estava na contagem que decidia se valia a
pena: ela somava os passos de máquina do bootstrap e — pior — o rastro que o
próprio Psicólogo deixa na sessão enquanto a analisa, o que fazia uma sessão
vazia parecer povoada a partir da primeira análise, e mais povoada a cada
retentativa. Fechado por [RN-079](../business-rules.md#rn-079), com a sessão do
achado reproduzida como teste.

**K e R eram mesmo prompt, e por isso fecharam só até onde código alcança.**
Duplicata EXATA de regra é recusada na emissão
([RN-080](../business-rules.md#rn-080)); história com título idêntico é recusada
e história que não acrescenta cobertura vira aviso
([RN-081](../business-rules.md#rn-081)) — aviso, e não bloqueio, porque um
segundo recorte da mesma regra pode ser legítimo e quem julga é o usuário.

O que **não** foi resolvido, e está escrito nas três RNs em vez de subentendido:
duplicata semântica. O par exato do achado R — "Endpoint público de saudação
determinística" e "Endpoint público GET /hello que responde saudação imediata" —
continua passando, porque nada mecânico liga os dois. Há teste afirmando esse
limite, para que ele seja uma decisão visível e não uma lacuna esquecida.

## Avulso

~~**`promotion-check` sem spec própria**~~ — **FEITO**. Era o único check
required da família sem teste (`pr-police`, `approval-ladder` e `gate` têm).
Encontrado ao escrever o registro de gates (FASE 15a, PR #145).

`scripts/ci/promotion-check.spec.ts` cobre as duas funções puras, afirmando a
REGRA e não a implementação: qual carimbo cada destino cobra (`qa` cobra `dev`,
`main` cobra `qa`, `dev` não cobra nada), e o que conta como carimbo **daquele**
commit — tag de outro commit não vale, tag de outro estágio não vale, e tag que
não resolveu sha não vira carimbo por omissão. É esse conjunto que impede `qa`
de receber código que nunca passou por `dev`.

~~**Os quatro segredos irmãos do compose de produção**~~ — **FEITO**
([RN-114](../business-rules.md#rn-114)). `AUTH_JWT_SECRET`,
`BRABO_SERVICE_TOKEN`, `CREDENTIALS_MASTER_KEY` e `SECRET_KEY_BASE` tinham
default de desenvolvimento em `docker/docker-compose.prod.yml`, que roda com
`NODE_ENV=production` — o mesmo padrão que o
[ADR 0059](../adr/0059-segredo-do-state-de-oauth-sem-default.md) fechara para
o `GIT_OAUTH_STATE_SECRET`, pelo mesmo motivo: o valor é público, está neste
repositório.

O receio registrado abaixo — que cada um merecia decisão própria — não
apontava para quatro DECISÕES diferentes, só para três checagens em lugares
diferentes: `passphraseAtual()` (`auth-key-material.ts`),
`tokenDeServicoAtual()` (`service-token.ts`) e o construtor de
`EnvelopeEncryptionService`, cada um com a MESMA regra do
`resolveOauthStateSecret()` (ausente/exemplo/curto derruba o boot em
produção). `CREDENTIALS_MASTER_KEY` recusar o BOOT não é o mesmo problema que
temia — não mexe em rotação nenhuma, essa continua existindo via
`CREDENTIALS_MASTER_KEY_PREVIOUS` + `rewrap-deks.ts`; a checagem só impede que
a chave de exemplo chegue a produção. `SECRET_KEY_BASE` já tinha o `raise`
certo no `runtime.exs` — o defeito real era o compose mascará-lo com um
fallback público, e a correção foi só remover esse fallback, sem tocar
Elixir nenhum.

---

## Backlog anterior

Itens que já existiam antes desta rodada. Não são defeitos, são decisões de
produto adiadas — por isso sem prioridade aqui.

| item | onde foi decidido |
|---|---|
| Budget por área | corte da Fase 8; **a um passo** — `agent_areas` passou a existir na FASE 14d ([ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md)), a tabela que faltava |
| Dev Lead e áreas via `module_map` | **saiu do backlog**: ADR 0053, implementado pela FASE 14d |
| Handoff manual a agente à escolha | — |
| MFA, login social, OIDC, federação | [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) |
| SMTP real no MailSender | hoje é log-only |
| Deploy (`DEPLOY_ENABLED` + Environments) | o gate `operavel` já está declarado como `planned` |
| Volta da `rc`/`rcfix` | [ADR 0030](../adr/0030-politica-de-branches-mecanizada.md) |
| Modo community do approval-ladder | vira mudança de `aprovacao_humana` no registro de gates (ADR 0054, PR #145) |
| "N agentes online" no dashboard | — |
| Preferência de moeda com taxa manual | — |
| Reativar a Anamnese (`ANAMNESE_ENABLED=true`) | pausada por decisão do usuário em 2026-08-10 — "hoje ele não está trazendo dados de muito valor" ([RN-115](../business-rules.md#rn-115)). Nenhum dado apagado (hipóteses, perfis de proficiência, patches de instrução seguem intactos e visíveis); a pausa é só do CAMINHO de rodada nova, aguardando um refinamento futuro do que a Anamnese deriva antes de religar |
| Reativar o Psicólogo (`PSYCHOLOGIST_ENABLED=true`) | pausado por decisão do usuário em 2026-08-10, mesmo motivo e mesmo padrão da Anamnese acima ([RN-117](../business-rules.md#rn-117)). Nenhum dado apagado (análises e hipóteses já emitidas seguem intactas e visíveis); a pausa é só do CAMINHO de rodada nova (automática e sob demanda) |

## Backlog do modelo de time (ADR 0085) — AUDITORIA FECHADA

Saída da auditoria `fluxo.yml` × código
([auditoria-fluxo-vs-codigo.md](auditoria-fluxo-vs-codigo.md)). Eram itens
declarados no modelo (`docs/fluxo.yml`) sobre papéis já **ativos** — não
esperavam nenhum papel `proposto`/`planned` ativar primeiro. As seis ondas
do plano fecharam, e esta tabela fica **vazia**: o último item (B4, o PO
ler `metricas-de-produto`) fechou com a RN-407, sem ADR novo — mesmo padrão
já estabelecido pela RN-164 (leitura de agente escopada ao projeto, sem
efeito externo). O documento da auditoria tem o plano de ondas completo,
com custo e critério de verificação por item, para quem quiser o histórico.

**Fechados desde a auditoria** (não removidos da referência original, só desta
tabela de pendências): gate `implementavel` (B3, ADR 0090); `docs/gates.yml`
desatualizado em `paralelismo-autorizado` (A1/B5, corrigido junto com A3–A5/A8
— citações de RN e rótulos errados em `fluxo.yml`); deployment frequency e lead
time reais via `analise:funil` (parte de B7, ADR 0089) — o resto de B7 (MTTR,
change failure rate) não fechou: continua declarado como lacuna PERMANENTE em
`fluxo.yml` (papel `delivery-metricas`), não pendência de engenharia; delegação
Dev Lead → dev (B1) e RN-160 sem revalidação no backend (A6/B6) — Onda 2 da
auditoria, ADR 0094, RN-404/405; gate `necessidade-validada` (B2) — Onda 6
(última) da auditoria, ADR 0095, RN-406; **métricas de produto → PO (B4)** —
o relatório (`analise:funil`, ADR 0089) já existia, faltava só o PO LER
`metricas-de-produto`; fechado com a ferramenta `listar_metricas_de_produto`
e as funções puras extraídas para `apps/api/src/application/services/funil-metrics.ts`
(RN-407) — última pendência da tabela, encerrando a auditoria.

## O que esta triagem NÃO faz

Não corrige nada. A disciplina que vem valendo desde a Fase 10 continua: cada
achado espera a fase que o endereça, e corrigir fora dela apaga a evidência de
por que ele existia.

E não inventa prioridade onde não há dado: os itens do backlog anterior não
receberam P1/P2/P3 porque a decisão deles é de produto, não de engenharia — e
palpite vestido de classificação seria pior que a lista crua.

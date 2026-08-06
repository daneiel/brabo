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
| B — Engine em provider remoto | N | **P1** | G | alto — a 13b não fecha como escrita |
| ~~F — Fronteira e teto do executor~~ | ~~S, U~~ | **FEITA** | — | RN-074 e RN-075; ADR 0055 aceito |
| C — A UI não pode mentir sobre agentes | C, I, H, L, G | P2 | M | médio |
| D — Wizard diz a verdade e tem saída | D, E, F | P2 | P | baixo |
| G — O desfecho de falha diz a verdade | P, Q (+ T) | P2 | P | médio — apaga a causa raiz |
| H — Estado de sessão não mente | V | P2 | M | médio — envenena toda medição |
| E — Qualidade do que os agentes produzem | K, R, J | P3 | M | baixo |
| — avulso | promotion-check sem spec | P3 | P | baixo |

**Cobertura: 19 de 19.** As letras de fase (A–H) e as de achado (B–V) colidem
por herança das duas listas; onde houver ambiguidade o texto diz "achado".

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

## Fase B — Engine em provider remoto (P1)

**N** — `get_local_repo_path/1` devolve `{:error, {:unsupported_provider, "github"}}`
para tudo que não é `local`. Cinco call sites dependem dele: worktree do dev,
executor de terminal, o diff que QA e SecOps leem, e o contexto de projeto.

A assimetria é a chave: a **api** fala GitHub por HTTP (criou o repo, commitou,
criou as branches); o **engine** trabalha no sistema de arquivos e só conhece
bare repo local. Projeto no GitHub faz a metade conversacional e o bootstrap,
mas não a metade de construção.

Custo **G**: exige clone, credencial dentro do engine e push — feature com ADR.

**Depende da Fase A?** Não tecnicamente, mas fazer B antes de A é pagar o caro
para continuar esbarrando no barato: o agente chegaria ao worktree remoto e
morreria no mesmo teto de iterações.

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

## Fase C — A UI não pode mentir sobre agentes (P2)

Cinco itens com a mesma raiz: a tela conta uma história diferente da do event
log.

| item | o que a tela faz |
|---|---|
| **C** | a bolha ao vivo vem rotulada com o **modelo**; o agente só aparece quando o evento persistido chega — e a mensagem fica duplicada até o reload |
| **I** | trocar o modelo da sessão reescreve retroativamente o rótulo de ações antigas |
| **H** | os eventos do bootstrap aparecem todos como "atividade em system" |
| **L** | o botão do rodapé continua "Estou pronto para produzir" depois do handoff |
| **G** | o convite do Criativo não aparece em projeto criado, porque o fio já tem os cards do bootstrap |

**C** é o mais grave dos cinco e foi apontado por você durante a execução: quem
fala é o agente, o modelo é detalhe de execução.

**Risco de esperar: médio.** Não corrompe dado, mas ensina errado — quem usa o
produto aprende a desconfiar da tela, e aí para de reportar defeito de verdade.

## Fase D — Wizard diz a verdade e tem saída (P2, custo P)

Três itens do mesmo passo do produto: o wizard afirma coisas erradas e não
oferece saída quando falha.

| item | o que é |
|---|---|
| **D** | `Proteger branches` falha em repo privado no plano gratuito, e o wizard **avisa isso antes**. A única ação oferecida depois é "Tentar novamente", que vai falhar sempre |
| **E** | o preview do repositório mente: `NewProjectWizard.tsx:331` tem `repo: brabo/{slug}` hardcoded, e o owner real vem do PAT. O erro chega à tela de **confirmação** |
| **F** | o passo "Política de branches" lista `rc` nas permanentes e `rc ← qa` na cascata; a política vigente tem só `dev`/`qa`/`main` |

Pequenos e isolados; podem entrar como carona de qualquer fase de UI.

## Fase G — O desfecho de falha diz a verdade (P2, custo P)

A mesma regra do CLAUDE.md violada três vezes: todo desfecho de falha registra a
ORIGEM (`infra | modelo | código | política`), nunca diagnóstico por eliminação.

| item | o que é |
|---|---|
| **P** | `dev.blocked` com `origin: null` numa falha cuja origem era `código` |
| **Q** | `agent.error` com `"origem indeterminada"`, que não é uma das quatro |
| **T** | recorrência: `dev.blocked` com `"indeterminada"` numa falha cuja origem era `modelo` — um status HTTP do provider, nomeado pelo próprio campo `diagnosis` na mesma linha |

Custo **P** porque não é mecanismo novo: os desfechos já carregam `diagnosis`
com a causa. O que falta é derivar a origem dela em vez de desistir — e falhar
o teste quando o valor não for uma das quatro.

**Risco de esperar: médio.** Não quebra nada hoje, mas apaga a causa raiz de
tudo que vier depois: quem triar a próxima rodada lê "indeterminada" e recomeça
a investigação do zero.

## Fase H — Estado de sessão não mente (P2)

**V** — a sessão `1f94de49` consta `closed` desde 23:34:42 e a execução seguiu
até 00:56. A UI diz "não é possível enviar mensagens" e ao mesmo tempo renderiza
cards de aprovação que funcionam: aprovar numa sessão fechada executa comando de
verdade.

Contraria a máquina de estados declarada no CLAUDE.md, em que `closed` é
terminal. **Risco de esperar: médio** — envenena toda métrica por sessão
(duração, custo, "quantas terminaram bem"), que é exatamente o instrumento que a
FASE 13b existe para construir.

## Fase E — Qualidade do que os agentes produzem (P3)

| item | o que acontece |
|---|---|
| **K** | rodar o Criativo duas vezes no mesmo projeto deixou 10 regras, 5 órfãs — sem dedupe nem aviso |
| **R** | o PO gerou duas histórias cobrindo o mesmo endpoint |
| **J** | o Psicólogo roda em sessão recém-aberta com as hipóteses da anterior e o log vazio, tenta citar eventos inexistentes e desiste |

São problemas de prompt e de validação de artefato, não de mecanismo. **J** tem
o consolo de que a validação de evidência segurou a invenção — o desperdício é
de dinheiro, não de verdade.

## Avulso

**`promotion-check` sem spec própria** — é check required, ao contrário de
`pr-police` e `approval-ladder` que têm teste. Encontrado ao escrever o registro
de gates (FASE 15a, PR #145). Custo P.

---

## Backlog anterior

Itens que já existiam antes desta rodada. Não são defeitos, são decisões de
produto adiadas — por isso sem prioridade aqui.

| item | onde foi decidido |
|---|---|
| Budget por área | corte da Fase 8; o aparato de áreas saiu do backlog com o [ADR 0053](../adr/0053-dev-lead-e-paralelismo-autorizado.md) |
| Dev Lead e áreas via `module_map` | **saiu do backlog**: ADR 0053, implementado pela FASE 14d |
| Handoff manual a agente à escolha | — |
| MFA, login social, OIDC, federação | [ADR 0031](../adr/0031-auth-first-party-argon2id-e-rotacao-de-refresh.md) |
| SMTP real no MailSender | hoje é log-only |
| Deploy (`DEPLOY_ENABLED` + Environments) | o gate `operavel` já está declarado como `planned` |
| Volta da `rc`/`rcfix` | [ADR 0030](../adr/0030-politica-de-branches-mecanizada.md) |
| Modo community do approval-ladder | vira mudança de `aprovacao_humana` no registro de gates (ADR 0054, PR #145) |
| "N agentes online" no dashboard | — |
| Preferência de moeda com taxa manual | — |
| FASE 15b — painel lendo o registro de gates | metade restante da FASE 15 |

## O que esta triagem NÃO faz

Não corrige nada. A disciplina que vem valendo desde a Fase 10 continua: cada
achado espera a fase que o endereça, e corrigir fora dela apaga a evidência de
por que ele existia.

E não inventa prioridade onde não há dado: os itens do backlog anterior não
receberam P1/P2/P3 porque a decisão deles é de produto, não de engenharia — e
palpite vestido de classificação seria pior que a lista crua.

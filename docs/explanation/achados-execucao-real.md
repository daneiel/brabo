# Achados da execução real da esteira

> Levantado numa sessão de execução conduzida pelo navegador em **2026-08-05**,
> com modelo de API (não local) e provider de git de verdade. É o insumo da
> triagem da FASE 13c: cada item tem arquivo:linha ou evento que o comprova, e
> nenhum foi corrigido "de passagem" — os que foram fechados têm PR nomeada.


Projeto CRIADO (não adotado) no GitHub via wizard. Repo real: `daneiel/hello-api`,
privado. Sessão do wizard: `f15b0cc9`. Sessão saudável: `36abf7e7`.

## Corrigidos durante a execução (bloqueavam)

1. **Medidor não media** (PR #136, mergeada) — `db.execute` destruturado como
   array + agente lido do ator do evento em vez do payload.
2. **`llm_turn_stream` sem `receive_timeout`** (PR #137, mergeada) — caía nos
   15s default do Req; os 4 agentes conversacionais só passam por ali.
3. **`ApprovalCard` derrubava a tela da sessão** (a commitar) — `ActionType` do
   web era subconjunto do backend; `ACTION_ICON[actionType]` → `undefined` para
   `git_repo_create`/`git_branch_create`/`git_branch_protect`, que é o que TODO
   projeto criado num provider gera. O "fallback genérico" existia só no
   comentário. Só não aparecia em projeto ADOTADO (sem bootstrap).

## Abertos — para a triagem da 13c

### A. Sessão do provisionamento nasce sem processo no engine (GRAVE)
`CreateSessionUseCase` é o único lugar que emite `session.created` no outbox.
Criam sessão direto no repositório, pulando isso:
- `apps/api/src/application/use-cases/git/provision-repository.use-case.ts:112` e `:121`
- `apps/api/src/application/use-cases/git/adopt-repository.use-case.ts:176`
- `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts:156`
  ← esta é a sessão em que os DEV AGENTS rodam

Efeito: engine nunca sabe que a sessão existe → `REFUSED JOIN` eterno, sem
canal, sem atualização ao vivo, sem heartbeat, e a sessão **nunca fecha**
(fica `active` para sempre). A UI só reclama no console.

Prova por contraste:
| sessão | `session.created` | `engine.session_states` | canal |
|---|---|---|---|
| wizard `f15b0cc9` | não | vazio | `REFUSED JOIN` |
| rota normal `36abf7e7` | sim | `active` | `JOINED` |

### B. Modelo de start (DECISÃO DO USUÁRIO)
Sessão sempre nasce no default do workspace (`llama3.2:1b`, local) — o ADR 0020
proíbe 7B/1B local no passo semântico, e foi preciso trocar à mão nas duas
sessões. Pedido: modelo de start configurável, herdando o do **Criativo** neste
cenário, porque ele é sempre a porta de entrada do projeto.

### C. Quem fala é o modelo, não o agente (DEFEITO, apontado pelo usuário)
A bolha transmitida ao vivo vem rotulada com o nome do MODELO
("DeepSeek V4 Flash Latest"); só quando o evento persistido chega é que aparece
o agente (`po`). Efeitos: o nome errado aparece primeiro, e a mensagem fica
DUPLICADA na tela (bolha do stream + bolha do evento). O stream não é
reconciliado com o evento persistido.

### D. Passo impossível trava o wizard sem saída
`Proteger branches` falha em repo privado no plano gratuito — o próprio wizard
AVISA isso antes. Mas a única ação oferecida depois é "Tentar novamente", que
vai falhar sempre. Falta reconhecer e seguir.

### E. Preview do repositório mente
`apps/web/src/routes/NewProjectWizard.tsx:331` tem `repo: brabo/{slug}`
hardcoded. O owner real vem do PAT (`createForAuthenticatedUser`), ou seja
`daneiel/hello-api`. O erro chega até a tela de CONFIRMAÇÃO.

### F. Wizard anuncia `rc`
Passo "Política de branches" lista `rc` nas permanentes e `rc ← qa` na cascata.
A política vigente tem só `dev`/`qa`/`main`; a volta da `rc` está no backlog do
ADR 0030.

### G. Convite do Criativo não aparece em projeto criado
O empty-state "A vez é sua" só renderiza com fio vazio. Em projeto criado o fio
já tem os cards do bootstrap, então o usuário não recebe convite nenhum.

### H. Feed de atividade genérico
Os 10 eventos do bootstrap aparecem todos como "atividade em system", sem dizer
o que aconteceu.

### I. Card de ação mostra o modelo ATUAL da sessão
Trocar o modelo da sessão reescreve retroativamente o rótulo dos cards de ações
antigas. O `token_usage` congela o preço certo; é só a tela.

### J. Psicólogo roda em sessão vazia
Na sessão `b2fceb9e`, recém-aberta: recebeu as hipóteses da sessão anterior com
o log da nova (vazio), tentou citar `seq 60-78` inexistentes, teve a evidência
rejeitada 2x e desistiu (`psychologist.analysis_failed`). A validação segurou a
invenção — mas rodar análise em sessão sem evento é gasto à toa.

### K. Regra de negócio duplicada não é deduplicada
Rodar o Criativo duas vezes no mesmo projeto deixou 10 regras, 5 órfãs
("descoberta — sem história"). Efeito do meu roteiro, não do produto, mas
mostra que não há dedupe nem aviso.

### L. Botão do rodapé fica obsoleto
Continua "Estou pronto para produzir" depois que o fio já passou ao PO.

## Funcionou como projetado (registrar também)
- RN-059: `agent.error` durável, com `origem: infra`, agente falando no fio e
  voltando a `idle` (visto 2x nos timeouts de 15s).
- Validação de evidência do Psicólogo rejeitando event ids inventados.
- Bootstrap de Gitflow no GitHub: 4/5 passos, repo real com `main`/`dev`/`qa`.
- Pipeline de proposed_action: 6 ações do bootstrap, auto-aprovadas pela política.
- 12c: promoção manual como default, `story_promotion_proposed` como proposta.
- Rastreabilidade regra ↔ história, separando coberta de descoberta.
- Progresso ao vivo do bootstrap, com a falha mostrando a mensagem do GitHub.

### M. O ARQUITETO É CEGO AO PRÓPRIO module_map (P1 — a falha da rodada)
Sessão `36abf7e7`, seq 80-131. O Arquiteto emitiu o mapa (módulos `saudacao` e
`api_http`) e em seguida **não conseguiu relê-lo**. Não há ferramenta para ler o
module_map vigente, e a recusa do `assign_story_modules` não devolve os nomes
válidos. Resultado: força bruta.

18+ chutes: `api`, `core`, `http`, `greeting`, `domain`, `web`, `hello-api`,
`hello`, `greeting-api`, `saudacao` (acertou por sorte), `app`, `server`,
`publico`, `public-api`, `api-publica`, …

Nas próprias palavras dele (seq 94, 99, 124):
> "os nomes que tentei (`api`, `core`) não batem. Vou **descobrir os nomes
> válidos testando candidatos plausíveis**"
> "Preciso **descobrir os nomes reais** dos 2 módulos. Vou **testar candidatos
> adicionais**."

Três consequências, em ordem de gravidade:

1. **Dado errado, declarado certo.** As 4 histórias ficaram em `["saudacao"]`,
   inclusive a do ENDPOINT. `api_http` ficou sem história nenhuma. E o desfecho
   (seq 130) afirma: "Todas as 4 histórias foram vinculadas com sucesso aos
   módulos." O log termina com uma mentira confiante.
2. **Quebra a execução a jusante.** `activate-execution` sobe um dev agent por
   MÓDULO. Com tudo em `saudacao`, o módulo `api_http` não recebe agente e a
   arquitetura desenhada não é a que será construída.
3. **Nenhum `tool.result` é gravado** para `assign_story_modules`. O laço inteiro
   é invisível no event log — só dá para inferir pelos `tool.call` repetidos.

Custo do laço: 9 chamadas de LLM do arquiteto, 27.804 in / 8.012 out.
Total da sessão: 7.271 micros (US$ 0,007) — barato só porque é modelo flash.

O laço do module_map (PR #135) era SINTOMA disto: o Arquiteto reemitia o mapa
justamente para tentar fixar nomes que ele não conseguia ler. O #135 fechou a
corrupção de dado; a cegueira continua.

## Execução (projeto 17229425, sessão de execução dbb84ce8) — 2026-08-05

### N. A METADE DE EXECUÇÃO SÓ FUNCIONA COM PROVIDER `local` (P1, bloqueia a 13b)
`Engine.Projects.ProjectRepository.get_local_repo_path/1` devolve
`{:error, {:unsupported_provider, "github"}}` para qualquer provider que não
seja `local`. Está documentado como corte de escopo no próprio moduledoc:

> "Só suporta o provider 'local' (github/gitlab remotos ficam fora de escopo do
> executor de terminal por ora)"
> — `apps/engine/lib/engine/projects/project_repository.ex:25-27`

Cinco call sites dependem dele:
- `lib/engine/dev/worktree_manager.ex:20` — worktree do dev agent
- `lib/engine/actions/terminal_executor.ex:39` — execução de comando
- `lib/engine/gates/diff.ex:17` — o diff que QA e SecOps leem
- `lib/engine/harness/project_context.ex:30` — contexto de projeto

Efeito observado: ativei a execução no projeto GitHub, os 3 dev agents subiram,
pegaram uma task cada e os 3 foram bloqueados no mesmo segundo com
`falha ao preparar o worktree`.

A assimetria é a chave: a **api** fala GitHub por HTTP (foi ela que criou o
repo, commitou o template e criou dev/qa). O **engine** trabalha no sistema de
arquivos e só conhece bare repo local. Então projeto no GitHub faz a metade
CONVERSACIONAL (Criativo, PO, Arquiteto) e o bootstrap, mas não a metade de
CONSTRUÇÃO.

Consequência para a FASE 13b: o roteiro do CLAUDE.md ("projeto ADOTADO do fork
via GithubProvider remoto, DevAgent real, dev implementa → PR remota → gates")
**não é executável hoje**. Não é bug de passagem: suportar remoto exige clone,
credencial dentro do engine e push — feature com ADR.

### O. Dev agent nasce no modelo local (mesma raiz do achado B)
Os três dev agents subiram com `Llama 3.2 1B (local)`, herdado do default do
workspace. O ADR 0020 proíbe modelo local pequeno no passo semântico, e dev
agent escrevendo código é o passo semântico mais caro que existe.

### P. Evento de bloqueio sem origem
`{"origin": null, "reason": "falha ao preparar o worktree", "diagnosis":
"{:unsupported_provider, \"github\"}"}`. O CLAUDE.md exige que todo desfecho de
falha registre a ORIGEM (infra | modelo | código | política). Aqui é `código`
(limite conhecido do produto) e veio `null`. O diagnóstico salvou o dia, mas a
regra não foi cumprida.

### Q. `agent.error` com "origem indeterminada"
No Criativo, turno abortado: o fio mostrou `falha · origem indeterminada`.
RN-059 funcionou (erro durável, agente falou, retomada limpa), mas
"indeterminada" não é uma das quatro origens — é diagnóstico por eliminação,
que o ADR 0020 proíbe.

### R. PO gerou histórias sobrepostas
"Endpoint público de saudação determinística" e "Endpoint público GET /hello que
responde saudação imediata" cobrem o mesmo endpoint. Sem dedupe nem aviso.

## Confirmado em produção nesta rodada
- **RN-066** (cegueira do Arquiteto): 4 chamadas de `assign_story_modules` em vez
  de 18, zero nome inventado, 1 module_map em vez de 4, cada história no módulo
  semanticamente certo. Custo da sessão caiu de 7.271 para 3.259 micros.
- **RN-067** (sessão sem processo): a sessão de execução `dbb84ce8` aparece em
  `sessions` E em `engine.session_states` — antes a de `activate-execution`
  nascia órfã.

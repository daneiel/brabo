# Brabo — Plataforma de engenharia orquestrada por agentes

## O que é
Sistema que gerencia o ciclo completo de uma aplicação: provisionamento de
repositório, Gitflow, agentes de IA especializados (Criativo, PO, Arquiteto,
Devs, Infra, QA, SecOps, Psicólogo, Anamnese), controle de custos de token
e pipeline de aprovação de ações com autoridade final do usuário.

## Como este arquivo está dividido

O conteúdo de sessão passou de 150 mil caracteres num arquivo só, e foi partido
por SEÇÃO em `.claude/contexto/`. As partes são IMPORTADAS abaixo, então
continuam sendo lidas em toda sessão, na mesma ordem de antes. Ao editar,
mexa na parte da seção; regra nova entra na parte do assunto, nunca aqui.

O Claude Code AVISA quando os arquivos de instrução somam mais de 150 mil
caracteres, e o que é lido em toda sessão estava em 218 mil. Por isso duas
coisas saíram do import sem perder uma palavra:
- `.claude/contexto/historico.md` é ÍNDICE para localizar a narrativa de cada
  fase, não regra: leia-o sob demanda, ao procurar onde uma fase está contada.
- Os blocos que só valem para uma área moram em `.claude/rules/`, com `paths:`
  no cabeçalho, e o Claude Code os carrega quando a sessão LÊ arquivo daquela
  área: `runner.md` (o `apps/runner`), `broker-e-containers.md` (o broker, a
  `DockerPort` e o corte da FASE 25b) e `ci-e-cadeia-de-suprimentos.md` (CI/CD,
  pin por SHA/digest, assinatura e o `install-e2e.yml`). Quem vai mexer nessas
  áreas por outro caminho (um script, um workflow citado de longe) LÊ a regra
  antes.

@.claude/contexto/estado-atual.md

@.claude/contexto/stack.md

@.claude/contexto/convencoes-repositorio-e-dominio.md

@.claude/contexto/convencoes-agentes-e-telas.md

## Documentação é parte da definição de pronto (permanente)
- Ao alterar código, consulte docs/.docmap.yml e atualize os docs
  mapeados NA MESMA mudança, mostrando o diff da doc junto com o do
  código. Não pergunte se deve fazer — faça.
- Fonte de verdade do Markdown: docs/ na raiz. NUNCA crie website/docs/
  — o site lê de docs/ via path.
- Arquivos generated: true no docmap são gerados por pnpm docs:generate
  — nunca editados à mão (o próximo build sobrescreve). Se o gerador
  marcar algo como "sem descrição acima", é lacuna real: escreva a
  descrição na prosa.
- Mudança de comportamento observável → entrada em CHANGELOG.md
  (Unreleased).
- Mudança estrutural (fronteira de camada, banco, modelo de
  consistência, dependência pesada) → ADR novo com o próximo número.
  ADR aceito NUNCA é editado: o novo referencia o antigo.
- Regra de negócio nova → RN-XXX com arquivo:linha e o teste que a cobre,
  em docs/business-rules.md — EXCETO as duas famílias que saíram dele por
  TAMANHO (não por assunto): custo/orçamento/metering vai em
  docs/business-rules/custo.md e auth first-party em
  docs/business-rules/autenticacao.md. As três contam para a mesma numeração
  (nunca reinicie por arquivo) e para a mesma contagem, que o docs:check afere
  somando os três por glob. Âncora `{#rn-NNN}` é o contrato: ela não muda
  quando uma RN muda de arquivo, e link de fora aponta para o arquivo que a
  hospeda hoje. Cabeçalho de RN sem ela, ou com outro número, REPROVA o
  `docs:check` — nos três arquivos e nas traduções pt-BR deles
  (`scripts/docs/ancoras-de-rn.mjs`, AT-230): o `docs:build` não pega, porque
  sem âncora o Docusaurus gera um id pelo título e compila.
- TODA mudança verifica se ESTE arquivo — com as partes que ele importa de
  `.claude/contexto/` — precisa mudar: Stack, Convenções, "O que NÃO fazer"
  e o estado das fases. Não pergunte se deve: verifique.
  O gatilho é o mesmo do docmap, e o motivo é que este arquivo e as partes
  são os únicos documentos lidos em TODA sessão: desatualizados, eles não são
  neutros, eles ensinam errado. Têm regra `warn` no docmap (não `block`,
  porque não moram sob docs/ e o checker valida glob e link dentro de docs/ —
  promover sem estender o checker criaria regra que se burla com
  `docs-not-needed`); tocar qualquer um deles satisfaz a regra. Parte nova
  entra no import daqui, no `docs_alternativos` da regra `claude-md` e, se
  tiver frase contada, em `scripts/docs/contagens-do-codigo.mjs`. O teto é a
  SOMA do que é lido em toda sessão — este arquivo, as partes importadas e os
  `CLAUDE.md` do usuário —, que não passa de 150 mil caracteres (o aviso do
  Claude Code, medido com `wc -m`, nunca `wc -c`). Crescendo, o que só vale
  para uma área vira regra de caminho em `.claude/rules/` (com `paths:` e
  entrada no `docs_alternativos`), e índice que só serve para localizar sai do
  import.
- A documentação publica um site por branch permanente, e o CAMINHO nomeia o
  AMBIENTE, não a branch (ADR 0073): `main` → `/brabo/prd/`, `qa` → `/brabo/qa/`,
  `dev` → `/brabo/dev/`, com a raiz sendo o índice gerado por
  `scripts/docs/landing.mjs`. O mapa branch→caminho existe num ponto por
  processo (o passo do `docs-deploy.yml`, `DEGRAUS` no `docusaurus.config.ts` e
  no `landing.mjs`) — nunca interpole `$GITHUB_REF_NAME` num caminho.
- A versão anunciada em PROSA é verificada por `pnpm docs:check` em DOIS
  arquivos, contra o primeiro `## vX.Y.Z` do CHANGELOG: `README.md` e
  `docs/intro.md` (a primeira página do site). Quem escreve os dois é
  `scripts/ci/readme-version.ts`, no mesmo commit do corte do CHANGELOG —
  cobrar o que o gerador não escreve faria todo release nascer vermelho numa
  PR do bot. Frase alterada sem ajustar o padrão reprova como `CEGO`, de
  propósito.
- Frase ancorada num lugar do CÓDIGO entra em
  `verificarFrasesAncoradasNoCodigo` (`scripts/docs/generate.mjs`) — mesma
  tabela-por-frase das contagens, só que o esperado é DERIVADO do artefato e
  não é um número. Hoje são seis: a escada da esteira no `description` do
  `branching-policy.md`, derivada de `ESCADA` em `scripts/ci/pr-police.ts`
  (NUNCA de `PROTECTED_BRANCHES`, que tem `rc` de propósito), e as duas frases
  de `db:generate` (`README.md` e `docs/getting-started.md`), derivadas de
  `apps/api/src/db/schema.ts` ser ou não barrel; e, desde a AT-123, as três
  frases de QUANTAS imagens o produto publica (`THIRD_PARTY_NOTICES.md`,
  `docs/runbook.md`, `docs/reference/brb.md`), derivadas de `ALVOS` em
  `scripts/ci/images-manifest.ts`. Consequência prática: mudar a
  escada ou desfazer o barrel reprova o `docs:check` até a prosa acompanhar.
  Padrão que para de casar reprova como `CEGO`, e a FONTE sumir também.
  CONTAGEM em prosa cuja fonte é um lugar do código (overrides, perguntas do
  golden-set, operações do contrato de git e da `DockerPort`, abas, tabelas,
  tipos de ação, serviços do compose…) entra em
  `scripts/docs/contagens-do-codigo.mjs` (AT-123) — uma linha por FRASE, um
  extrator por fonte, cada extrator provado por MUTAÇÃO no `.spec.ts` ao lado.
  Número que muda a cada PR (arquivos por app) é DATADO, não derivado.
  As contagens de ADR/RN, o próximo ADR e o recuo de `docs/adr/temas.yml` são
  reescritos pelo `pnpm docs:generate` (AT-399); o `docs:check` só reprova o
  arquivo commitado desatualizado.
  Irmã em `block` desde a AT-122 (nasceu `warn` na AT-096):
  `verificarRefsComSimbolo` confere, nos três arquivos
  de RN, toda ref `` `caminho:N` (`símbolo` `` — e a continuação `` `:N` (`símbolo` ``,
  que herda o caminho do MESMO item — contra o código, ±3 linhas. Só esse
  padrão: ref sem símbolo, par por `/` e símbolo que não é identificador ficam
  de FORA, de propósito (aferição barulhenta é desligada no primeiro mês).
  REPROVA a ref que não bate e a que não resolve a um arquivo só, e ZERO refs
  extraídas é `CEGO` (`veredito` em `refs-com-simbolo.mjs`, provado por
  mutação no spec ao lado). O `warn` não segurou a deriva: a lista zerou em
  26/09 e voltou a 140 em cinco dias. As traduções pt-BR das RNs NÃO são
  aferidas. Ao escrever RN nova, cite `caminho:N` (`símbolo`) — é o que a
  torna conferível. Desde a AT-399 o `pnpm docs:generate` reancora a ref cujo
  símbolo tem ocorrência mais próxima ÚNICA a até 40 linhas
  (`DISTANCIA_MAXIMA_DE_REANCORA`); PR que desloca código citado por RN roda o
  gerador e commita. Ref cujo símbolo sumiu, moveu mais de 40 linhas ou empata
  entre duas ocorrências segue relida pelo símbolo, à mão, nunca por um número
  antigo. NÃO alargue a janela
  para o vermelho sumir, nem estreite o padrão para esconder ref real.
- O runbook termina com a tabela `procedure | anchor | verification |
  schedule` dos procedimentos de OPERAÇÃO (AT-193, EP-015), e o `docs:check` a
  confere em `block` (`scripts/docs/procedimentos-do-runbook.mjs`, provado por
  mutação no spec ao lado): arquivo citado em `verification` que não está no
  git, `make <alvo>` que o `Makefile` não tem, célula vazia ou "see below",
  âncora que não é `{#id}` explícito de cabeçalho, e workflow cujo `on:` não
  tem o gatilho que a classe do segmento afirma (`weekly` → `schedule:`,
  `every PR` → `pull_request`, `every tag` → `push: tags`; `manual` não cita
  workflow). Sem prova, a célula começa com `**None**` — DECLARA, nunca fica
  vazia. Procedimento de operação novo no runbook ganha linha ali; renomear um
  spec ou tirar o `schedule:` de um workflow citado reprova o PR que o fez. Só
  o runbook em inglês tem a tabela: a tradução pt-BR está atrás (AT-209) e uma
  segunda cópia sem conferência seria a cópia que a tabela existe para
  substituir.
- O índice de ADR é agrupado por TEMA, e o tema mora FORA do ADR (ADR 0202,
  AT-137): `docs/adr/temas.yml` tem a lista fechada (15 temas) e UM tema por
  ADR. ADR novo ganha a linha dele ali e a linha do índice na seção do tema, em
  ordem numérica, no MESMO PR — o `docs:check`
  (`scripts/docs/temas-de-adr.mjs`, `block`) reprova ADR sem tema, tema fora
  da lista ou sem ADR, e linha na seção errada. O índice é CONFERIDO, nunca
  gerado (as frases são curadas). Tema novo é mudança da lista, justificada no
  PR; passar de 15 exige ADR.
- Variável de ambiente tem ESCOPO no inventário gerado — `produto` (o que o
  operador põe no `.env`) ou `ferramenta` (só CI e quem desenvolve) —, e a
  fonte nova nasce com o dele. Fonte que mora direto numa pasta precisa de
  DOIS globs: `**/` no pathspec do git exige pelo menos um nível de diretório,
  e um inventário que nasce vazio não avisa, passa verde. As fontes moram em
  `scripts/docs/fontes-de-env.mjs`, provadas contra a árvore real pelo spec ao
  lado, e em `e2e/` o `.spec.ts` NÃO é filtrado: ali o spec É o código que lê
  o ambiente (AT-124). Os `deploy/k8s/*.sh` são fonte `ferramenta` desde a
  AT-212, casados SÓ pela expansão com default (`${X:-…}`): `${X}` puro é
  variável do próprio script. E o ⚠️ é PORTÃO desde a AT-211, nas DUAS espécies de
  fonte: o `docs:check` reprova toda variável sem descrição mesmo com o bloco
  regenerado (antes, regenerado, o ⚠️ ficava commitado e passava), nomeando a
  variável, o arquivo que a lê e a seção de `configuration.md` onde escrever
  (`scripts/docs/inventario-de-env.mjs`, provado por mutação no spec ao lado).
  Um `**TODO(humano):**` na linha que cita a variável NÃO reprova, de
  propósito: é lacuna DECLARADA, e reprová-lo empurraria quem não sabe a
  resposta a inventar uma. O ⚠️ do inventário de EVENTOS segue sem reprovar.
- Antes de finalizar: pnpm docs:check e pnpm docs:build verdes (glob
  morto, gerado fora de dia e link quebrado reprovam).
- Nunca inventar conteúdo de doc: sem informação suficiente, use
  > **TODO(humano):** <pergunta específica>.
- Diagramas em Mermaid no próprio Markdown. Nunca imagem de diagrama.
- O mecanismo inteiro está explicado em
  docs/explanation/documentation-workflow.md — leia antes de desligar
  qualquer peça dele.

## O que NÃO fazer
- Não usar Redis (filas ficam no Postgres via Oban)
- Login social (GitHub/GitLab) deixou de ser proibido e está
  IMPLEMENTADO (ADR 0084, PROGRAMA 28/Onda 5, frente I) — a proibição
  foi revogada só para essa capacidade, por decisão explícita do dono
  do produto. O que continua valendo do backlog do ADR 0031: não
  implementar MFA, OIDC provider (a api virar provedor) nem federação
  genérica
- Dev Lead, áreas dinâmicas via module_map e o aparato genérico de
  áreas (agent_areas) deixaram de ser proibidos e estão IMPLEMENTADOS
  (ADR 0053 aceito, FASE 14d). O que continua valendo é o resto da
  regra: não abra área nova de passagem — área nova é decisão de
  produto, com ADR
- Não versionar à mão: toda tag nasce de workflow
- Não instalar libs sem justificar no plano
- Não refatorar código de fase concluída sem pedido explícito
- Não ativar modelo descoberto automaticamente: curadoria manual
  sempre (ADR 0042)
- Não corrigir de passagem os achados que seguem ABERTOS em
  docs/explanation/achados-execucao-real.md — corrigir fora da fase que os
  endereça apaga a evidência de por que existiam. Os 19 achados do
  dogfooding fecharam (19 de 19, ver a FASE 13c); o que resta aberto é da
  execução real e NÃO é bug a corrigir, é decisão de produto: Z/AD (o
  allowlist de verbos não converge — verbo, forma e invocação são espaços
  distintos) e AE (o agente de QA tenta consertar o código que julga,
  contra o próprio prompt, contido por duas barreiras independentes)
- (FASE 15 — CONCLUÍDA) O congelamento de gates valeu enquanto a fase
  corria — nenhum gate NOVO, nenhuma mudança de comportamento de gate
  existente — e terminou sem exceção nenhuma: a fase só DECLAROU e MEDIU
  o que já existia. Segue valendo a regra permanente de que gate novo é
  decisão de produto, com ADR
- (FASE 13 — CONCLUÍDA) O congelamento valeu enquanto a fase corria, e
  vale registrar como terminou, porque a regra funcionou: quatro exceções,
  todas pelo MESMO critério — só o que impedia a própria medição de
  acontecer. Fase F (achados S e U), achado W, achado Y e achado AB. As
  correções de INSTRUMENTO (o script da validação, o Noop, o medidor) não
  precisaram de exceção, e a distinção entre instrumento e produto se
  provou útil o tempo todo. O que a disciplina evitou está registrado: a
  nona execução podia ter passado liberando `bash` no allowlist, e isso
  teria destruído a garantia para fazer o teste passar

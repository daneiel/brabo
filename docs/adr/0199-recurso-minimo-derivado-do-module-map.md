# 0199 — O recurso mínimo do container é derivado do `module_map`: cada módulo declara o seu, e a Infra sobe com a soma

## Status

**Accepted.** 2026-10-01 (AT-261, história HS-065, épico EP-030, rodada 36;
decisão do dono em 01/10: *"o recurso mínimo é derivado do `module_map` — o que
o Arquiteto declara por módulo —, não um preset fixo por stack"*). Muda o
schema do artefato `artifact.module_map` (Fase 3b) e o que a execução de
`container_start` faz com `resources` omitido, referenciando sem editá-los o
[ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)
(recursos com teto no artefato de imagem), o
[ADR 0130](0130-broker-de-container.md) (`pidsLimit` na spec do broker), o
[ADR 0131](0131-roteamento-de-modulos-para-infra.md) (o roteamento do
Arquiteto), o [ADR 0133](0133-infra-elege-imagem-do-roteamento.md) (a Infra
elege) e o [ADR 0190](0190-a-infra-sobe-o-container-no-aceite.md) (a subida do
servidor no aceite, que usava "recursos padrão").

## Context

Medido em `dev` em 2026-10-01, antes de mudar:

- `RECURSOS_PADRAO = {cpus 2, memoryMb 4096, pidsLimit 512}` e o teto
  `RECURSOS_MAXIMOS = {8, 16384, 4096}` em
  `apps/api/src/domain/containers/project-container.ts`. Campo de `resources`
  omitido virava o padrão em `validarDecisaoDeImagem`; acima do teto, recusa.
  Não havia noção de MÍNIMO.
- A subida do servidor no aceite (`subir_no_aceite/2`, ADR 0190) manda
  `resources: %{}` sempre, então todo container subido por ela recebia o
  padrão. O container real do uso de 29/09 tinha `Mem=4 GiB`, `NanoCpus=2e9`,
  `Pids=512` — o padrão.
- O `module_map` tinha `{name, stack, responsibility, dependsOn}` por módulo
  (`ModuleNode` em `domain/architecture/module-graph.ts`, a coluna JSONB
  `module_maps.modules`, a ferramenta `create_module_map` do engine) e nenhum
  campo de recurso. O roteamento (`artifact.module_routing`) e a imagem
  também não. "Mínimo compatível" não era derivável do dado existente.
- Um projeto tem UM container: `project_id UNIQUE` em `project_containers`.

## Decision

1. **O `module_map` ganha `resources` por módulo.** Opcional no artefato (mapas
   antigos não o têm; nenhuma migration — é um campo do JSON), com os TRÊS
   números da spec do broker: `cpus`, `memoryMb`, `pidsLimit`. Significa o que
   AQUELE módulo precisa sozinho dentro do container. A ferramenta
   `create_module_map` passa a pedi-lo (`required` no schema do item, com os
   três campos obrigatórios dentro). A api valida na criação do mapa: os três
   ou nenhum (declaração pela metade é 400 — completar o campo faltante com o
   padrão seria inventar o número), cada um positivo e no teto do container.
2. **O mínimo é a SOMA entre módulos, não o máximo.** Todos os módulos moram no
   mesmo container ao mesmo tempo: o dev agent de cada um trabalha ali, em
   paralelo quando a área paraleliza, e o servidor de dev de um não desliga
   para o do outro rodar. O máximo só seria verdade se nunca houvesse dois de
   pé, e o erro dele é OOM-kill no meio de um comando, não recusa legível. A
   soma que passa do teto é recusada JÁ na criação do mapa (400 ao Arquiteto,
   que é quem pode corrigir), e de novo, como defesa, na subida.
3. **Módulo sem declaração conta com o padrão de hoje como PISO.** Nunca se
   inventa número para ele: o único que existe é o que ele recebe hoje, o
   padrão do container. Então, havendo módulo sem declaração, o mínimo é o
   MAIOR entre a soma dos declarados e `RECURSOS_PADRAO`, campo a campo; só
   com todos declarados o mínimo fica abaixo do padrão. Mapa sem declaração
   nenhuma — todo mapa anterior a este ADR — dá exatamente o padrão, e o
   comportamento dele não muda. O piso por CONTAINER, e não "padrão por
   módulo somado", é de propósito: somar 2 cpus por módulo não declarado
   faria um mapa antigo de cinco módulos passar do teto e parar de subir.
4. **Quem deriva é a api, na execução de `container_start`.**
   `ExecuteContainerStartUseCase` lê o `module_map` vigente (o mesmo que o
   roteamento candidatou), deriva o mínimo e resolve os recursos campo a
   campo: OMITIDO vira o mínimo; ABAIXO do mínimo é `failed` nomeado (sem
   gravar decisão nem subir); acima vale até o teto, conferido como sempre por
   `validarDecisaoDeImagem`. Sem `module_map` vigente, o mínimo é o padrão.
   O engine NÃO deriva: a subida do servidor segue mandando `resources` vazio,
   e o rationale dela diz que os recursos são o mínimo derivado — uma régua só,
   em TypeScript, nunca uma segunda cópia da soma em Elixir.
5. **O `rationale` do artefato diz de onde veio cada número.** A decisão que
   `DecidirImagemDoProjetoUseCase` grava (`artifact.project_image`,
   `decidedBy: 'infra-lead'`) ganha a frase "Recursos mínimos (RN-683): …",
   com os módulos somados, os que NÃO declararam (nomeados) e a versão do
   mapa. Quem audita o container lê por que ele tem aqueles números.

## Consequences

- A subida do servidor (ADR 0190) passa a subir com o MENOR recurso elegível:
  um projeto todo declarado pode ficar abaixo do padrão de 2 cpus/4 GiB/512
  pids, que era o desperdício que a AT-261 mediu.
- O Arquiteto passa a declarar recurso por módulo, e um modelo pode errar o
  número. Errar PARA CIMA custa máquina e é auditável no `rationale`; errar
  para cima do teto é 400 com motivo; errar para BAIXO é o risco que sobra, e
  é do mesmo calibre do que o Arquiteto já decidia ao escolher a imagem. O
  número é DECLARADO, não medido — medir consumo real do container é outra
  frente, não tomada aqui.
- O Infra Lead pede ACIMA do mínimo quando quiser (até o teto), nunca abaixo.
  A recusa abaixo do mínimo acontece na EXECUÇÃO: uma proposta `pending` com
  recurso abaixo do mínimo só falha quando aprovada, com o motivo no
  `executionResult`. Recusar já ao propor exigiria ler o mapa no
  `ProposeActionUseCase`, e não foi feito aqui.
- `choose_project_image` (o Arquiteto decidindo a imagem do zero, RN-105) NÃO
  muda: ali o Arquiteto escolhe os recursos dele mesmo, e o pedido do dono foi
  sobre a escolha da Infra. A subida pelo runner (`container_start_via_runner`)
  também não: ela sobe a imagem já decidida, com os recursos gravados nela.
- O teto continua o mesmo, e nenhum outro se move.
- A soma de frações de CPU é arredondada a três casas, para o artefato não
  gravar `0.30000000000000004`.

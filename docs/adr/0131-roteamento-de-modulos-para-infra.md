# 0131 — O Arquiteto roteia módulos para infra: ele CANDIDATA, a Infra ELEGE

## Context

O Arquiteto já tem seis ferramentas (`create_module_map`,
`assign_story_modules`, `choose_project_image`, `create_c4_diagram`,
`propose_adr`, `emit_insight`) e uma decisão de imagem — `choose_project_image`
(ADR 0065) — que é **por projeto**: uma imagem só, para o container do
projeto inteiro. O plano de execução em container real (ADR 0128/0130) pede
mais granularidade: um projeto com módulos de stack diferente (um serviço
Node, um worker Python) não cabe numa imagem só quando cada módulo precisa
subir separadamente.

A pergunta de desenho não é "qual imagem", é "quem decide o quê". O Arquiteto
já enxerga a arquitetura (é ele quem escreveu o `module_map`), mas ele não
enxerga o parque de imagens já em uso, custo de manter mais uma variante, nem
as convenções operacionais que a Infra segue — essas são competências da
Infra, não da Arquitetura. Dar ao Arquiteto o poder de FIXAR a imagem de cada
módulo (como `choose_project_image` fixa a do projeto) empurraria uma decisão
operacional para quem só tem o lado de design.

## Decision

**O Arquiteto candidata; a Infra elege.** Esta entrega é só a metade do
Arquiteto: uma ferramenta nova, `route_modules_to_infra`, que produz uma
LISTA — um item `{modulo, imagemCandidata, porque}` por módulo do
`module_map` vigente — e a grava como `artifact.module_routing`, ao lado de
`artifact.module_map`/`artifact.project_image`/`artifact.c4_diagram` (mesmo
desenho sem tabela do ADR 0065, estendido aqui: o evento É o artefato). A
metade que ELEGE (o Infra Lead lendo esta lista e decidindo, com
`proposed_action` própria) é um PR separado — o roteamento existe e é
auditável antes de a Infra ter ferramenta para consumi-lo, o mesmo tipo de
sequenciamento que já valeu para `module_map` chegar antes de
`create_c4_diagram` precisar dele.

**`:direct`, fora do `@registry` global — não é `proposed_action`.** Rotear
não tem efeito externo: não sobe container, não muda nada fora do event log.
É decisão INTERNA de arquitetura, do mesmo calibre de `choose_project_image`
e `create_c4_diagram`, que também são `:direct`. Transformar isto em
`proposed_action` colocaria uma decisão de rascunho (que a Infra ainda vai
revisar) na mesma fila que aprova `git push`.

**A imagem candidata passa pela MESMA validação de `choose_project_image`,
por item.** `validarDecisaoDeImagem` (`domain/containers/project-container.ts`)
já sabe recusar imagem sem tag/digest, `latest`, e `rationale` curto —
reimplementar essa regra por módulo criaria duas versões dela para
divergirem. O domínio novo (`domain/architecture/module-routing.ts`) só
acrescenta o que é PRÓPRIO da lista: não pode vir vazia (não é uma decisão),
não pode repetir módulo (ambíguo — qual das duas imagens vale?), e cada
`modulo` citado precisa existir no `module_map` vigente do projeto (mesma
checagem de `assign_story_modules`/`missingModules`, e pelo mesmo motivo: a
recusa lista os nomes VÁLIDOS, para não obrigar o modelo a adivinhar).

**Sem module_map, não há o que rotear — recusado, não inventado.** A
ferramenta só faz sentido depois de `create_module_map`; o `build_kickoff/1`
do `ArquitetoServer` (o único lugar de onde o modelo aprende a ORDEM das
ferramentas) passa a listar `route_modules_to_infra` como passo 4, logo
depois do module_map. Chamar sem module_map vigente é recusado com o mesmo
texto de `create_c4_diagram` — "defina o module_map antes" — em vez de rotear
contra um mapa vazio ou inventado.

## Consequences

**Nada sobe container ainda.** Esta entrega não muda o portão RN-105, não
mexe em `RegistrarTransicaoDeContainerUseCase`, não introduz
`proposed_action` nova. O que existe depois dela: uma lista auditável de
candidaturas, lida por humano no event log — a Infra ainda não tem ferramenta
para agir sobre ela (PR seguinte).

**A imagem candidata pode divergir da imagem do projeto
(`choose_project_image`).** De propósito: um módulo pode justificar uma
imagem diferente da que o Arquiteto fixou para o projeto como um todo — é
exatamente a granularidade que esta entrega existe para abrir. Reconciliar as
duas (ou aposentar `choose_project_image` em favor do roteamento por módulo)
é decisão de produto à parte, não tomada aqui.

**O `EstadoDoRoteamento`/`GetModuleRoutingUseCase` seguem o mesmo molde de
`GetC4DiagramUseCase`** — leitura sem tabela, vigente por maior `version` com
desempate por `seq`. Existir como caso de uso separado (em vez de inline no
de escrita) é o que dá versionamento correto sem duplicar a lógica de
"qual é o vigente" — o mesmo motivo de `DecidirImagemDoProjetoUseCase` usar
`ObterContainerDoProjetoUseCase`.

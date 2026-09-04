# 0029 — Sincronização contínua da documentação

## Contexto

O repositório chegou à v0.1.0 com 28 ADRs, um `CLAUDE.md` extenso e seis
runbooks — e sem nenhum documento que explicasse o sistema como um todo. Não é
falta de escrita: é que documentação de conjunto não nasce de decisão pontual,
e ADR não substitui mapa.

A missão de documentação produziu esse conjunto. O problema seguinte é mais
difícil que o primeiro: **documentação não morre por falta de escrita inicial,
morre por drift**. O código muda, a doc fica, e chega o dia em que ela descreve
um sistema que não existe mais. A partir daí ninguém confia em página nenhuma,
inclusive nas corretas.

O reconhecimento inicial mediu o tamanho do risco neste repositório:

- 96 commits em um único mês, com o `apps/api/src/db/schema.ts` alterado 23
  vezes — o arquivo mais volátil do projeto;
- 89 variáveis de ambiente, 64 identificadores de evento, 110 rotas HTTP e 13
  tipos de ação, todos como string livre no código, sem união de tipos que
  force alguém a atualizar uma lista;
- um `.docmap.yml` já existente cujos globs **oito** apontavam para caminhos
  inexistentes (`apps/api/drizzle/**`, `k8s/**`, `helm/**`), herdados de uma
  estrutura de diretórios anterior.

O último item é o mais instrutivo. Um glob que não casa com nada não falha —
ele simplesmente nunca dispara. A regra existe no arquivo, dá a impressão de
cobertura, e não protege nada. Um mapa de responsabilidade sem validação
degrada em silêncio exatamente como a documentação que ele deveria proteger.

## Decisão

Instalar mecanismo, não boa intenção, em três níveis de confiabilidade
decrescente: **gerar > verificar > lembrar**.

### 1. Gerar, onde a lista é o conteúdo

`docs/reference/scripts.md` sai inteiro de `pnpm docs:generate`, extraído dos
`package.json` e dos alvos anotados do `Makefile`. Não há prosa a preservar,
então não há motivo para alguém manter a lista à mão.

### 2. Verificar, onde a prosa vale mais que a lista

`configuration.md` e `events.md` são escritos à mão — a coluna "quando dá
errado" e o "quando este evento acontece" são o valor real, e nenhum script
escreve isso. Mas a **lista** precisa estar completa.

A solução é um bloco entre `<!-- BEGIN:GENERATED:<id> -->` e
`<!-- END:GENERATED:<id> -->` dentro do arquivo escrito à mão. O bloco é o
inventário mecânico; o texto em volta é a explicação. O inventário marca o que
existe no código e não tem descrição na prosa.

Isso encontrou dois tipos de evento reais na primeira execução —
`agent.response` e `tool.result`, este último emitido pelo hook
`Engine.Harness.Hooks.EventLog` — que a extração manual tinha perdido.

### 3. Lembrar, onde julgamento humano é necessário

O `docs/.docmap.yml` liga caminhos de código aos documentos que dependem deles,
com severidade `block` ou `warn`. Um script cruza o diff do PR com o mapa e
cobra o que não foi atualizado.

Quatro decisões dentro desta:

**O mapa é validado no CI.** Glob morto reprova, antes de qualquer outra
verificação. Um mapa quebrado faz todo o resto mentir.

**O escape hatch é obrigatório.** Label `docs-not-needed` ou linha
`docs-not-needed: <motivo>` no corpo do PR liberam o check. Sem saída legítima,
o hábito que se forma é burlar — um commit de enfeite na doc só para o gate
passar — e aí o mecanismo passa a mentir, que é pior do que não existir.

**Falso-positivo é defeito, não ruído aceitável.** A primeira versão do
verificador de variáveis acusou sete itens que estavam documentados sob a
abreviação `POSTGRES_HOST` / `_USER` / `_PASSWORD`. O verificador foi ensinado
a expandir a abreviação. Um check que erra treina quem lê a ignorá-lo.

**O build do site é o gate mais barato.** `onBrokenLinks`, `onBrokenAnchors` e
`onBrokenMarkdownLinks` em `throw`: mover um arquivo sem corrigir quem aponta
para ele derruba o CI em vez de virar 404 em produção.

### 4. Auditoria periódica, para o que o PR não pega

O drift check pega doc que ficou **errada** num PR. Doc que ficou **velha** sem
ninguém encostar não dispara nada. Uma auditoria mensal reporta página parada
cujo código correspondente mudou depois, `TODO(humano)` pendentes, referências
`arquivo:linha` que não resolvem, e ADRs em `proposed` há mais de 60 dias —
sempre na mesma issue, atualizada. Issue nova todo mês vira spam, e spam é
desligado.

### 5. Fonte única, site que só lê

O Markdown vive em `docs/` na raiz. O site Docusaurus em `website/` lê de lá via
`path: '../docs'` e **nunca** existe `website/docs/`. Conteúdo duplicado é
conteúdo que diverge.

## Consequências

**O PR fica mais caro.** Tocar `apps/api/src/domain/**` sem atualizar
`business-rules.md` reprova. É o custo pretendido: a alternativa é a doc
apodrecer, e o custo disso aparece meses depois, disperso e maior.

**O mapa precisa de manutenção.** Diretório renomeado deixa glob morto — agora
o CI acusa, mas alguém tem que corrigir. É trabalho novo, pequeno e visível, em
troca de trabalho velho, grande e invisível.

**Os avisos vão errar às vezes.** O mapa trabalha por caminho de arquivo, não
por semântica: um refactor que renomeia variáveis internas dispara
`dominio-e-regras` sem mudar nenhuma regra. O escape hatch existe para isso. Se
a mesma regra for dispensada três vezes na mesma semana, o problema é a regra:
estreite o glob ou baixe a severidade.

**O mecanismo não verifica se o texto está correto.** Ele verifica se o texto
foi *revisado* quando o código mudou, e se as listas estão completas. Uma frase
factualmente errada que ninguém tocou passa em todos os checks. Para isso
existe leitura humana e o slash command `/sync-docs`.

**GitHub Pages exige repositório público ou plano Enterprise.** O deploy do site
vai falhar enquanto o repositório for privado. O job de build em PR — que é o
que carrega o valor de gate — funciona nos dois casos.

**Duas dependências novas na raiz**, `yaml` e `picomatch`, ambas de
desenvolvimento e cobertas pela exceção pré-aprovada do tooling de documentação.

O mecanismo inteiro está explicado em
[`docs/explanation/documentation-workflow.md`](../explanation/documentation-workflow.md),
incluindo o que fazer quando ele reclamar injustamente. Mecanismo que ninguém
entende é mecanismo que alguém desliga.

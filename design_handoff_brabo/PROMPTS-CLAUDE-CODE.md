# Prompts para o Claude Code

Sequência de quatro prompts. A ideia central: **separar leitura de escrita**. Os
dois primeiros prompts não alteram nenhum arquivo — só produzem entendimento e
plano. Isso é o que evita o Claude Code sair reescrevendo o repositório com base
em suposições.

Antes de começar, coloque esta pasta na raiz do repositório (ou aponte o caminho
nos prompts).

---

## Prompt 1 — Levantamento (não escreve código)

```
Leia, nesta ordem:
- design_handoff_brabo/README.md
- design_handoff_brabo/tokens.css
- design_handoff_brabo/CHECKLIST-CONFRONTO.md
- as capturas em design_handoff_brabo/screenshots/

Depois mapeie o repositório ATUAL: stack, estrutura de pastas, sistema de
estilos, biblioteca de componentes, roteamento, camada de dados e onde vive
qualquer navegação existente.

Não altere nenhum arquivo. Produza um relatório com:
1. Stack e convenções que a implementação deve seguir (com exemplos de arquivos
   reais do repo que servem de modelo).
2. Para cada item do CHECKLIST-CONFRONTO.md: existe / divergente / ausente, com
   caminho do arquivo e uma linha explicando a divergência.
3. Os 5 maiores riscos de retrabalho, ou seja, onde o design conflita com uma
   decisão já tomada no código.
4. Perguntas que você precisa que eu responda antes de planejar.
```

Responda as perguntas do item 4 antes de seguir. Esse ida-e-volta é onde o plano
fica bom.

---

## Prompt 2 — Plano (não escreve código)

```
Com base no relatório, escreva um plano de implementação em
design_handoff_brabo/PLANO.md. Regras:

- Fatie em PRs pequenos e mergeáveis, na ordem da seção "Ordem sugerida de
  implementação" do README. Comece por tokens/tema, depois shell de navegação,
  depois telas.
- Cada PR: objetivo em uma frase, arquivos a criar/alterar, o que NÃO entra,
  critério de aceite verificável, e a linha do CHECKLIST-CONFRONTO que ele fecha.
- Marque explicitamente o que é refactor do código existente e o que é código
  novo. Refactor e feature nunca no mesmo PR.
- Liste os dados que o backend precisa entregar (seção 6 do checklist) e, para
  cada um, se o endpoint já existe, precisa mudar, ou não existe.
- Aponte onde você vai reaproveitar componentes que já existem no repo em vez de
  criar novos.

Não escreva código ainda. Quando terminar, me mostre o plano e pare.
```

---

## Prompt 3 — Fundação

```
Execute o PR 1 do PLANO.md: tokens e tema.

- Porte design_handoff_brabo/tokens.css para o sistema de estilos do repo,
  mantendo os nomes dos tokens.
- Aplique data-theme no elemento raiz, com dark como padrão, persistido em
  localStorage['brabo.theme'] e aplicado antes do primeiro paint.
- Substitua hex soltos por tokens nos componentes que já existem.
- Nenhuma mudança visual não intencional: se um componente existente muda de
  aparência, me avise em vez de decidir sozinho.

Ao final, liste o que ficou fora e por quê.
```

---

## Prompt 4 — Por tela (repetir)

```
Execute o PR <n> do PLANO.md: <nome da tela>.

Referências: design_handoff_brabo/designs/<arquivo>.dc.html (comportamento e
medidas exatas) e a captura correspondente em screenshots/.

Regras:
- Use os componentes e padrões do repo; não introduza biblioteca nova sem me
  perguntar.
- Trate os HTML do pacote como referência de design, não como código a copiar.
- Dados: use a camada de dados existente. Onde o endpoint não existir, crie um
  mock tipado com o shape descrito na seção 6 do checklist e marque com TODO.
- Ao final, rode lint e testes, e me mostre um diff resumido por arquivo.
```

---

## O que faz diferença na prática

**Peça o relatório antes do plano, e o plano antes do código.** Três turnos de
leitura custam pouco e removem quase todo o retrabalho.

**Exija caminhos de arquivo em cada afirmação.** "Isso já existe" sem caminho é
suposição; com caminho é fato verificável.

**Um PR por seção do checklist.** Cada PR fecha linhas específicas do
CHECKLIST-CONFRONTO.md — assim o progresso é medível e a revisão é pequena.

**Nunca misture refactor e feature.** Tokenizar cores existentes e construir a
tela nova são dois PRs, sempre.

**Dê ao Claude Code permissão explícita para perguntar.** A frase "me avise em
vez de decidir sozinho" muda o comportamento em decisões ambíguas.

**Aponte o arquivo-modelo do próprio repo.** "Siga o padrão de
`src/features/billing/BillingPage.tsx`" produz resultado melhor do que qualquer
descrição de convenção em prosa.

**Sirva os protótipos, não só leia.** `npx serve design_handoff_brabo/designs`
faz a navegação entre telas funcionar — o comportamento do shell (colapso,
persistência de aba, auto-recolhimento no Código) só se entende navegando.

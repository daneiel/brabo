# ADR 0108 — No modo `runner`, o projeto nasce ao clicar em "Navegar pasta...", não só na confirmação

- **Status:** Aceito
- **Data:** 2026-08-22
- **Contexto:** fecha a lacuna que o [ADR 0107](0107-navegacao-de-pasta-local-via-o-runner.md) já tinha declarado, na própria seção de Consequências
- **Estende (sem editar):** [ADR 0104](0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md), [ADR 0107](0107-navegacao-de-pasta-local-via-o-runner.md)

## Contexto {#context}

O ADR 0107 entregou a navegação de pasta local via o Runner, mas declarou
explicitamente, na seção de Consequências, uma lacuna arquitetural aceita: o
ticket do canal Phoenix (`terminal:<projectId>`) é emitido POR PROJETO, e na
tela de criação (`NewProjectWizard.tsx`) o projeto só nasce no passo de
confirmação (`handleConfirm`) — então o botão "Navegar pasta..." do passo
"Onde o código vai morar" não tinha a que ancorar o ticket, e caía sempre no
estado declarado ("disponível depois que o projeto existir"). O próprio ADR
0107 listou as duas saídas possíveis: "(a) um modo de ticket/canal para o
Runner não ancorado em projeto, ou (b) o projeto ser criado mais cedo no
fluxo do assistente (antes da confirmação)" — e adiou a escolha para "uma
entrega futura que o dono do produto priorizar".

Esta é essa entrega, testada ao vivo pelo dono do produto criando um projeto
real: sem conseguir navegar pastas na tela de criação, ele foi forçado a
digitar o caminho de memória — exatamente o atrito que o ADR 0107 existia
para eliminar, só que a lacuna ficou justamente onde a navegação faria mais
diferença.

A opção escolhida foi a (b), não a (a): um modo de ticket sem projeto mudaria
o contrato do canal (`Engine.Runners.Registry`, hoje chaveado por
`projectId`) para toda a superfície do Runner — exec, PTY e navegação — só
para resolver um caso de uso que já tem saída mais barata: o próprio ADR 0104
já estabelece que `createProject` no modo `runner` é uma operação LEVE (só a
linha do projeto — sem repositório remoto, sem bootstrap do Gitflow) e que o
`workspacePath` nesse modo é **provisório por desenho**: o runner real, ao
conectar, SOBRESCREVE o caminho com o que ele informa do host (RN-423). Criar
o projeto mais cedo não introduz uma segunda fonte de verdade sobre o
caminho — o runner continua sendo a única.

## Decisão {#decision}

**Escopo: só `execution_mode = 'runner'`.** O modo `mounted` continua com
`projectId: null` no passo do workspace, intocado — ali a validação de disco
roda DENTRO do container da api, no momento da criação (RN-422/RN-170), e
criar cedo com um caminho ainda não digitado devolveria a mensagem de recusa
(que ensina a montar a pasta) num momento em que o usuário nem começou a
pensar no caminho. `runner` não tem esse problema: a criação nesse modo só
valida a parte LÉXICA do caminho (ADR 0104, item 2), nunca toca o disco.

1. **`NewProjectWizard.tsx` cria o projeto ao clicar em "Navegar pasta..."**,
   não mais só na confirmação — mas só quando o modo é `runner`. Se o campo
   de caminho ainda estiver vazio, ele usa um marcador lexicamente válido e
   claramente provisório (`/workspace-a-confirmar`) em vez de bloquear o
   clique — o runner real sobrescreve esse valor ao conectar (RN-423), então
   o marcador nunca acaba sendo a verdade sobre o caminho, só destrava a
   navegação.
2. **Reuso por RETRATO de identidade, não por "já criei algum projeto
   antes".** O retrato guarda só `name`/`externalId`/`adotando` — os campos
   que decidem QUAL projeto está sendo criado —, nunca `caminhoLocal`,
   porque todo o propósito de navegar é justamente REFINAR o caminho depois
   que um projeto já existe: incluí-lo no retrato invalidaria o reuso a cada
   clique. Enquanto a identidade não muda, um segundo clique em "Navegar
   pasta..." e a confirmação final REUSAM o mesmo projeto; mudar o nome (ou
   voltar e trocar o repositório adotado) invalida o retrato, e a próxima
   navegação cria outro.
3. **`handleConfirm` reusa o projeto criado durante a navegação, quando o
   retrato ainda bate** — nunca chama `createProject` de novo para o mesmo
   clique em "Provisionar"/"Ver o plano". Duas linhas para o mesmo projeto
   seriam um defeito, não uma funcionalidade.

## Consequências {#consequences}

- **Um projeto órfão "não provisionado", se o assistente for fechado sem
  terminar.** Clicar em "Navegar pasta..." e fechar o assistente sem chegar
  a "Provisionar" deixa uma linha criada, sem repositório e sem bootstrap.
  Esse é o efeito colateral aceito, e o motivo de aceitá-lo é que **ele não é
  um estado NOVO**: qualquer criação interrompida hoje — a aba fechada entre
  a confirmação e o carregamento da tela de provisionamento, por exemplo — já
  produz o mesmo resultado. O produto não tem hoje mecanismo de limpeza de
  projetos órfãos (nem para esse caso preexistente), e este ADR não cria um —
  só deixa de ser um caso mais raro, porque a criação agora acontece num
  passo anterior do fluxo. Se um mecanismo de limpeza vier a existir, ele
  resolve os dois casos com a mesma regra.
- **`UpdateProjectDto` continua sem `executionMode`/`workspacePath`.** A
  constatação do ADR 0104 (que converter entre modos um projeto EXISTENTE não
  é um PATCH trivial) não muda aqui — esta entrega não introduz edição
  nenhuma, só antecipa o momento da PRIMEIRA escrita.
- **`FolderBrowserModal` ganha um segundo motivo para receber um `projectId`
  não nulo antes da confirmação**, mas o contrato do componente não muda: ele
  continua sem saber SE o projeto que recebeu é final ou provisório — quem
  decide isso é o assistente, no retrato.
- **Este ADR NÃO reabre a decisão (a) do ADR 0107** (ticket sem projeto): ela
  continua não existindo, e continua não sendo necessária — a superfície de
  exec e PTY do Runner segue exigindo um projeto real, como sempre exigiu.

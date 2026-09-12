# 0155 — A primeira conta nasce no terminal, e o agente local sobe pareado

## Status

**Proposed.** Segunda das duas decisões da
[FASE 30](../explanation/fase-30-runner-por-maquina.md). Depende do
[ADR 0154](0154-chave-de-dispositivo-de-maquina.md): sem identidade de máquina,
não há o que registrar aqui.

## Context

O `install.sh` termina com o compose de pé e o binário do runner no disco. A
pessoa abre o navegador e encontra uma tela de login numa instalação onde
**ninguém existe**.

E o caminho de sair dali está quebrado numa instalação nova. Medido:

- o `.env` que o instalador gera não tem **nenhuma** variável de e-mail
  (`install.sh`, o heredoc que grava as onze chaves);
- `MAIL_TRANSPORT` cai no default `log` (`docker/docker-compose.install.yml:200`),
  e o compose diz no comentário ao lado que *"o comportamento continua log-only
  mesmo aqui"*;
- o registro exige verificar e-mail, e o docblock de
  `apps/api/src/scripts/provisionar-usuario.ts` já registra a consequência com
  todas as letras: *"o fluxo normal de registro exige verificar e-mail — que
  com o `MailSender` log-only não fecha sozinho"*.

Ou seja: quem instala pela linha única se cadastra, não recebe nada, e a única
saída é ir pescar o link em `docker compose logs api`. Uma instalação que
termina dizendo "Pronto" e não deixa ninguém entrar.

`provisionarUsuario` existe exatamente para esse buraco — cria um usuário com
senha **já verificada** — e hoje tem dois chamadores, o seed de demonstração e
o smoke. Nenhum deles é a instalação de verdade.

## Decision

**O instalador cria a primeira conta, com consentimento explícito no terminal,
e sobe o agente local já pareado.**

### 1. Só a PRIMEIRA conta, e só quando não há nenhuma

O passo roda quando a instalação não tem usuário algum. Havendo qualquer um, o
instalador **não oferece** — não é um criador de contas, é o fechamento de uma
instalação nova. Numa migração (RN-530) os usuários vêm no restore, e o passo
se cala pelo mesmo critério.

A rota é interna e autenticada por `BRABO_SERVICE_TOKEN` — o mesmo segredo que
o instalador acabou de gerar e escrever no `.env`, com modo 600 —, e recusa se
já existir usuário. Não nasce rota pública de "criar o primeiro owner": uma
rota pública que cria owner é uma corrida entre quem instalou e quem escaneou a
porta.

### 2. Sem verificação de e-mail, e o motivo é o que autoriza

A conta nasce verificada, por `provisionarUsuario`. Isso não afrouxa o
registro normal, que fica byte a byte: o que a verificação de e-mail prova é
*"esta pessoa controla esta caixa"*, e quem está rodando o instalador já provou
algo mais forte — **controla a máquina**, o `.env` com os cinco segredos e o
daemon do Docker. Exigir dela a prova mais fraca, por um canal que a instalação
sabe estar desligado, é teatro.

O instalador **diz** isso na saída, em vez de deixar a pessoa descobrir que sua
conta é diferente das outras.

### 3. O consentimento é explícito, e sem TTY o passo não acontece

Mesma régua da RN-511 e do `consentir-base.mjs`: o passo **pergunta** e-mail e
senha, e sem terminal interativo **relata** em vez de decidir. Não existe
caminho em que uma conta nasça com senha escolhida pelo script — nem gerada,
nem default.

A senha é lida sem eco e confirmada. Recusa mínima (comprimento) é a mesma do
domínio, chamada pelo mesmo código; o instalador não carrega uma segunda
régua de senha, que divergiria.

### 4. A chave de máquina é registrada ali, e o serviço sobe com ela

Com a conta criada, o instalador registra uma chave de dispositivo de máquina
(ADR 0154), grava a privada com o `kid` dentro (RN-475, o defeito que fez o
modo automático nunca autenticar) e instala o serviço — a unit **por máquina**
do ADR 0154 ponto 4.

O par é gerado **na máquina**; a privada nunca viaja. É o mesmo desenho do
navegador (ADR 0118), pelo mesmo motivo, e mantém verdadeira a frase que a
RN-519 usa para recusar a visão de `maintainer`: *"a privada de uma chave de
dispositivo nunca sai do navegador"* — passa a ser "nunca sai da máquina".

### 5. O serviço sobe sem projeto, e isso é o estado normal

O agente instalado consulta `GET runner/projects` (ADR 0154 ponto 3) e não
encontra nada, porque ainda não há projeto. Ele **espera**, e isso não é erro:
não emite falha, não sai com código diferente de zero, e `service status` diz
"de pé, nenhum projeto em modo runner" — um dos quatro estados que a RN-518 já
distingue, e não um quinto.

Quando a pessoa criar o primeiro projeto em modo `runner` na web, o agente já
está lá. É esse o "linkar a pasta depois" que a fase persegue, e ele acontece
por `workspace_create` (RN-532), sem ninguém voltar ao terminal.

## O que este ADR recusa explicitamente

- **Criar conta quando já existe uma.** Ver o ponto 1.
- **Rota pública de primeiro owner.** Ver o ponto 1.
- **Senha gerada pelo script, ou default.** Ver o ponto 3. Um instalador que
  escolhe senha produz instalações com a mesma senha.
- **Afrouxar a verificação de e-mail do registro normal.** O ponto 2 cria um
  caminho para um caso nomeado; não mexe no outro.
- **Ligar SMTP sozinho.** O instalador não pergunta servidor de e-mail e não
  grava `MAIL_*`: `MAIL_TRANSPORT=log` continua o default declarado, aqui como
  em produção. O que ele faz é parar de **depender** dele para a instalação
  fechar.
- **Pedir credencial de LLM.** Está fora: a instalação termina utilizável, e a
  chave de provider é decisão de quem vai gastar (RN-058).

## Consequences

- **A instalação de uma linha passa a fechar de verdade**: termina com conta,
  login possível e agente local de pé. Hoje termina com um login que ninguém
  consegue atravessar sem ler log de container.
- **O instalador passa a manejar uma senha.** Ela é lida sem eco, usada e
  descartada — nunca gravada no `.env`, nunca no marcador, nunca no log. O
  marcador (`$XDG_STATE_HOME/brabo/`) ganha o **e-mail** do owner criado, que é
  identificação e não segredo, e nada mais.
- **Um segundo caminho de criação de usuário passa a existir em produção.** Ele
  é estreito (primeira conta, rota interna, service token) e some assim que a
  instalação tem gente — mas é uma superfície nova, e está declarada.
- **`provisionarUsuario` ganha um terceiro chamador**, e o primeiro que não é
  automação de teste. O docblock dele diz hoje que existe para seed e smoke;
  passa a dizer também para a instalação.
- **A FASE 29 fica coerente consigo mesma.** Ela recusou o instalador de uma
  linha *"enquanto os artefatos não forem assinados"* e assinou antes de
  instalar; esta fase fecha a outra ponta — instalar não é entregar bytes, é
  deixar utilizável.

# 0213 — O entregável roda na máquina do usuário pelo compose da Infra

## Status

**Accepted.** 2026-10-11 (AT-517; decisões do dono de 11/10: "pelo compose da
Infra", sem porta publicada no broker). Regras em RN-851..855. Referencia, sem
editar, o [ADR 0130](0130-broker-de-container.md), o
[ADR 0190](0190-a-infra-sobe-o-container-no-aceite.md) e o
[ADR 0199](0199-recurso-minimo-derivado-do-module-map.md).

## Context

No fim de uma execução o usuário tinha código mergeado e nenhuma forma
declarada de vê-lo rodando. O que foi medido:

- O `docker-compose.yml` que a Infra abria na PR era "de desenvolvimento":
  subia o ambiente, não o APP, e o prompt do Infra Lead dizia que o container
  do projeto não sobe por ele.
- A imagem decidida em `artifact.project_image` não chegava à Infra quando ela
  escrevia o compose, então o `FROM` do Dockerfile do módulo era um palpite.
- A porta padrão do app (3000) colide com a do Brabo na mesma máquina.
- O container do projeto não tem Docker (contenção do ADR 0130), então nada
  dentro do Brabo pode rodar `docker compose up` para provar o compose.
- As rotas do entregável já são documentadas no README pelo dev
  ([RN-850](../business-rules.md#rn-850)), e o QA já sobe processos em
  background e encerra o grupo ([RN-817](../business-rules.md#rn-817)), mas
  nada amarrava uma URL ao que o usuário abre.

## Decision

1. **O caminho é o compose da Infra**, rodado pelo usuário no repositório
   entregue. O broker NÃO publica porta: a contenção do ADR 0130 fica intacta.
2. **O compose sobe o APP** (RN-851): `build` do Dockerfile do módulo com
   `FROM` igual à imagem de `artifact.project_image`, porta do host
   `${APP_PORT:-8080}:<porta interna>` (8080 está livre ao lado das portas do
   Brabo: 3000, 4000, 5173, 5432, 7474, 7687, 8088, 11434), volume para dados
   persistentes e `env_file` com `.env.example` commitado — nunca `.env`.
3. **A Infra escreve a seção "Rodar na sua máquina" do README**, na PR dela. O
   dev segue com "Rotas HTTP" (RN-850) e acrescenta a URL do Swagger ou da
   página quando a cria.
4. **`propose_infra_pr` ganha o campo OBRIGATÓRIO `run`**, validado no engine e
   na api:
   - `command`: string não vazia, até 300 caracteres (ex.:
     `cp .env.example .env && docker compose up --build`);
   - `urls`: 1 a 5 itens `{ label, url, kind }`, `label` até 60 caracteres,
     `kind` ∈ `api_docs` | `web`, `url` começando com `http://localhost:` ou
     `http://127.0.0.1:`;
   - `envExample`: boolean — quando `true`, o `.env.example` está entre os
     `files` da PR.
5. **A api emite `artifact.run_instructions`** (RN-852) ao executar
   `open_infra_pr` com sucesso: versionado, sem tabela, o vigente substitui —
   o desenho de `artifact.project_image` —, payload
   `{ command, urls, envExample, prUrl }`, lido por
   `GET /projects/:projectId/infra-artifacts` (ou GET dedicado se aquele não
   servir).
6. **O dev expõe o que se abre** (RN-853), sem amarrar stack: módulo HTTP serve
   `/openapi.json` (OpenAPI 3) e `/docs` (UI Swagger); com rede `none` ou sem o
   pacote, `/docs` é uma página HTML que carrega o `swagger-ui` de CDN — quem
   baixa é o navegador do usuário, não o container. Módulo web serve a página
   inicial. A cláusula só entra quando a tarefa toca entrypoint ou rotas.
7. **O QA prova DENTRO do container** (RN-854): sobe o app pelo comando do
   README em background, bate em `localhost:<porta interna>/openapi.json` e
   `/docs` (`curl`, `wget` ou `node -e fetch`) e encerra o grupo de processos
   (RN-817). O `docker compose up` real é OBSERVAÇÃO ("provado só na máquina do
   usuário"), nunca item do plano.
8. **A Visão geral ganha o cartão "Rodar na sua máquina"** (RN-855): o comando
   com botão de copiar e as URLs clicáveis, com o texto "declarado pela Infra,
   não verificado na sua máquina" ([RN-468](../business-rules.md#rn-468)) —
   nunca verde.

## Consequences

- Custo de token: o payload `run`, a seção do README e a cláusula do dev e do
  QA são texto a mais em turnos que já existiam; nenhum turno novo.
- Lacuna declarada: o `docker compose up` real nunca roda dentro do Brabo. O
  que o QA prova é o app respondendo dentro do container; porta do host,
  volume e build pelo compose ficam provados só na máquina do usuário, e a
  tela diz isso.
- O que NÃO muda: a contenção do ADR 0130 e do broker (sem porta publicada,
  sem socket no container, rede `internal`), a subida automática do
  [ADR 0190](0190-a-infra-sobe-o-container-no-aceite.md) e os recursos
  derivados do `module_map` do
  [ADR 0199](0199-recurso-minimo-derivado-do-module-map.md). A evidência de
  que o ponto de entrada sobe ([RN-813](../business-rules.md#rn-813)) e a rota
  HTTP no README ([RN-846](../business-rules.md#rn-846)) seguem valendo; este
  ADR acrescenta a URL que se abre, não troca a prova.

## Alternatives considered

- **Porta publicada pelo broker** para o usuário abrir o app do container do
  projeto. Recusada por decisão do dono: abriria a primeira porta do container
  do projeto para o host e mudaria a contenção do ADR 0130.
- **A tela lê o README ou o compose do repositório** para montar o cartão.
  Recusada: seria parsear prosa e YAML no cliente, sem contrato; o payload
  `run` validado e o artefato versionado dão o mesmo dado com forma fixa.

# ADR 0246 — Anexos do chat: bytes no Postgres, referência no evento, visão por capability

- **Status:** aceito
- **Data:** 2026-11-03
- **Referencia:** os ADRs [0041](0041-base-openai-compativel-e-contrato-de-llm-providers.md) (capability sem prova é `false`), [0113](0113-pasta-local-anexada-via-navegador-vira-chunks-scope-local.md) (upload JSON, "rejeitar, nunca truncar") e [0152](0152-backup-de-volumes-contra-compose.md) (o que entra no backup). Nenhum deles é editado.

## Contexto

AT-715 (EP-031): nenhum chat de agente aceita arquivo. O dono respondeu às 11 perguntas do levantamento em 02/11: texto/código e imagem; 5 MB por imagem, 512 KB por texto, 4 por mensagem; Postgres; vive com a sessão; a imagem vai ao LLM só no turno em que chegou; todo `viewer` vê; sem antivírus; chat sem agente fora. O event log é append-only, então os bytes não podem morar nele.

## Decisão

1. **Bytes no Postgres.** Tabela `chat_attachments` (`bytea`, FK `cascade` para projeto e sessão), sem UPDATE. O `pg_dump` do backup já a cobre e o RBAC é o do projeto. Nada vai a disco nem ao worktree, então não há contenção de caminho nova (RN-092/095).
2. **Referência no evento.** O `chat.message` grava `anexos: [{id, nome, mime, tamanho}]` e o engine recebe a mesma lista; os bytes só saem do banco quando a api monta a chamada ao provider (lane L2) ou quando alguém lê o anexo.
3. **Visão por capability.** O contrato multimodal e a capability `vision` (`false` sem smoke real, ADR 0041) são da lane L2; esta lane só fixa o armazenamento e as rotas.
4. **Quem vê.** Todo `viewer` do projeto, o mesmo alcance do `GET .../events`. Alheio é 404.
5. **JSON com base64, não multipart.** 5 MB viram ~6,7 MB, dentro do corpo de 10 MB, sem `multer` nem parser novo; é o molde do upload do RAG.
6. **Tipo pelos bytes.** Assinatura para png/jpeg/gif/webp; texto é UTF-8 válido sem NUL. SVG não é imagem aceita (cairia como texto e é servido `nosniff`/`attachment`).

## Consequências

- **Lacuna declarada: sem antivírus.** Os bytes nunca executam (ficam em `bytea` e saem com `nosniff` e `attachment`), mas ninguém os varre; ClamAV seria serviço novo e decisão do dono. Registrada em `docs/security-surface.md`.
- O `pg_dump` cresce com os anexos; medir depois (retenção é a vida da sessão, sem purga).
- O corpo JSON de upload de 10 MB é teto da rota, e cada pedido carrega o arquivo inteiro em memória.

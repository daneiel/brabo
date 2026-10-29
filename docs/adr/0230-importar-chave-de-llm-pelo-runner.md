# ADR 0230 — O runner importa a chave de API de LLM que o usuário já tem na máquina

## Status

**Accepted.** 2026-10-29 (AT-611, EP-026, decisões do dono de 29/10). Tema: `runner`.
Complementa, sem editá-los, o [0158](0158-o-id-da-chave-mestra-gravado-no-envelope.md) (envelope com
`key_id`), o [0154](0154-chave-de-dispositivo-de-maquina.md) (chave de dispositivo de
máquina) e o [0050](0050-credencial-sempre-cifrada-verificacao-explicita.md) (guardar e verificar são
dois assuntos).

## Contexto

O usuário que já usa Claude Code, Codex, OpenCode, Kilo Code CLI ou Hermes tem chaves de
API de LLM no disco da própria máquina, e hoje digita cada uma de novo na tela de
credenciais. A api roda em container e não alcança esse disco; quem alcança é o
`brabo-runner`. Importar é um efeito sobre segredo, então precisa de consentimento
explícito por chave e nunca acontece em silêncio.

## Decisão

1. **Só chave de API.** Token OAuth de assinatura (Claude Pro/Max, ChatGPT/Codex, Copilot)
   NÃO é importado: os termos dos fornecedores o vinculam ao cliente oficial, e usá-lo em
   outro produto arrisca a conta do dono. O comando lista o que achou como "login por
   assinatura, não importável — crie uma chave de API" e diz o motivo.
2. **A leitura é só do runner interativo** (`brabo-runner credentials import`, TTY
   obrigatório, escolha por item). A api nunca lê o disco do usuário.
3. **Rota `POST /runner/llm-credentials`**, `@RequirePatAuth()` + `PatAuthGuard`, que
   delega ao MESMO `UpsertUserCredentialUseCase` (envelope com `key_id`) para o usuário
   dono da credencial. Como a rota não tem `:projectId`, o guard recusa com 403 toda
   credencial amarrada a projeto; todo PAT é de projeto, então na prática só a chave de
   dispositivo de MÁQUINA entra. É a primeira rota em que credencial de máquina escreve
   segredo de usuário.
4. **Nunca sobrescreve sem confirmação:** credencial existente do provider sem
   `substituir: true` é 409 `credencial_existente`, sem tocar a existente.
5. **O valor nunca vai a log, URL, evento, exceção nem resposta.** O log de auditoria leva
   provider e `origem` (ferramenta e caminho); a resposta é `{ provider, substituida }`.
6. A rota só guarda (ADR 0050); o teste de conexão é ação separada
   (`POST /users/me/credentials/:provider/test`), a cargo do cliente.
7. Keychain do macOS fica para uma fatia própria.

## Consequências

- Um dispositivo de máquina comprometido passa a poder gravar (e, com `substituir`,
  trocar) chave de LLM do dono. O teto é a revogação da chave (ADR 0201) e o 409 como
  padrão.
- Quem importa vê na tela de credenciais a mesma linha de qualquer credencial.
- Ferramenta nova a importar é leitor novo no runner, sem mudar a rota.

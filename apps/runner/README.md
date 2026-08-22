# @brabo/runner

CLI que executa, na máquina do próprio usuário, os comandos que os agentes do
[Brabo](https://github.com/daneiel/brabo) propõem e que o pipeline de
aprovação do produto já aprovou. Não decide política nenhuma — só executa o
que chega pelo canal já aprovado, conectado ao engine por um canal Phoenix
autenticado por ticket de uso único.

Ele existe para projetos no modo `runner` (ADR 0104): a pasta do código
continua na máquina do usuário, sem bind-mount nenhum — é este CLI, rodando
com os privilégios de quem o executa, que confirma o caminho de verdade e
executa os comandos aprovados.

## Instalação

```sh
npm install -g @brabo/runner
```

## Uso

```sh
brabo-runner --project <projectId> --dir <caminho-absoluto> --token brb_... [--api-url <url>]
```

- `--project`: o id do projeto no Brabo, com `execution_mode` = `runner`.
- `--dir`: a pasta absoluta onde o código do projeto vive nesta máquina.
- `--token`: um Personal Access Token (`brb_…`), gerado em **Configurações do
  projeto → Tokens de acesso**. Também pode vir pela variável de ambiente
  `BRABO_ACCOUNT_TOKEN` — nunca é gravado em disco por este CLI.
- `--api-url`: default `http://localhost:3000`, ou a variável de ambiente
  `BRABO_API_URL`.

## Segurança

A fronteira de segurança do runner **não é sandboxing** — é a composição de
três coisas: autenticação (o Personal Access Token da sua conta), o pipeline
de aprovação de sempre (todo comando de agente continua nascendo uma ação
proposta, sujeita à política do projeto) e o seu consentimento em rodar este
binário na própria máquina, com os seus privilégios.

## Mais

Documentação completa, incluindo a decisão de arquitetura por trás do runner
local, em [ADR 0103](https://github.com/daneiel/brabo/blob/main/docs/adr/0103-runner-local-execucao-na-maquina-do-usuario.md),
[ADR 0104](https://github.com/daneiel/brabo/blob/main/docs/adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
e [ADR 0105](https://github.com/daneiel/brabo/blob/main/docs/adr/0105-personal-access-token-do-runner-escopado-por-construcao.md).

## Licença

MIT

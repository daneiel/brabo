# ADR 0240 — O motivo de controle inerte pode morar num "?" ativo na página de Containers

- **Status:** aceito
- **Data:** 2026-11-02
- **Revisa:** o [ADR 0064](0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md), só na regra "o motivo de controle inerte é dito em TEXTO visível", e só para a página de Containers.

## Contexto

O ADR 0064 manda dizer o motivo de um controle inerte em texto, porque `title`
e tooltip em elemento `disabled` não abrem. Na página de Containers cada linha
empilhava até quatro frases ("Nunca provisionado…", "Sem imagem decidida…", o
broker…) embaixo de três botões de ícone, e o dono (prévia v6, 02/11) preferiu
uma linha limpa. O que o ADR 0064 protege é o motivo ficar ACESSÍVEL, não que
ele ocupe a célula.

## Decisão

1. Em `AcoesDoContainer.tsx` os motivos de inércia por linha vão para UM `Ajuda`
   ("?"), com o assunto "Por que as ações estão indisponíveis", ao lado dos
   botões. O "?" é um botão ATIVO (não `disabled`): abre no clique, no teclado e
   no hover, e por isso o motivo continua alcançável com os botões desabilitados.
   Sem motivo, não há "?".
2. O motivo de PAPEL continua dito uma vez, em texto, no topo da página.
3. A exceção vale SÓ para Containers. Em qualquer outra tela o motivo de
   controle inerte segue em texto visível (por exemplo, a sugestão "Estou
   pronto" do composer).

## Consequências

- `design/COMPONENTS.md`, seção "Ajuda", registra a exceção e o seu limite.
- Estender a outra página exige novo ADR, não uma releitura deste.

# ADR 0239 — CSP `frame-src` local para o Web preview do entregável

- **Status:** aceito
- **Data:** 2026-11-02
- **Revisa:** o CSP do `docker/web/nginx.conf` (herdado do [ADR 0058](0058-csp-fechado-na-api-e-escopo-de-projeto-contido.md)), só no que toca quadros.

## Contexto

A AT-685 mostra o entregável do projeto, rodando na máquina de quem usa, num
`iframe` dentro do Brabo. Sem `frame-src`, o CSP cai em `default-src 'self'` e
o navegador bloqueia o quadro.

## Decisão

1. O CSP do nginx do web ganha `frame-src http://localhost:* http://127.0.0.1:*`.
   Nada de `https:` nem de domínio externo.
2. O componente só aceita URL que passa em `urlLocalSegura`; URL externa é
   recusada e a tela diz o motivo em texto.
3. O `sandbox` do quadro é mínimo: `allow-scripts allow-same-origin`. Os dois
   juntos só são seguros porque a origem do quadro (`localhost:<porta>`) difere
   da do Brabo: o quadro não alcança DOM, cookie nem storage do Brabo.
   `allow-forms`, `allow-popups` e `allow-top-navigation` ficam de fora.
4. `frame-ancestors 'none'` e `X-Frame-Options: DENY` não mudam: continuam
   proibindo que OUTROS emoldurem o Brabo.

## Consequências

- Risco residual: a página local emoldurada roda código arbitrário do próprio
  projeto do usuário, na máquina dele, com a origem dela. Se o Brabo for
  servido em `localhost` na MESMA porta do entregável, a isenção de origem some;
  por isso o entregável não pode ocupar a porta do Brabo.
- Instalação com Brabo em servidor remoto verá o `iframe` apontar para o
  `localhost` do navegador, não do servidor; é a semântica pretendida.

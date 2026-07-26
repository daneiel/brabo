// Entrada de ESTILOS do design-sync (não exporta nada de propósito).
//
// Existe para puxar tokens e fontes pelo grafo de módulos do esbuild, que é o
// único caminho que garante ordem correta no CSS emitido. As alternativas
// falham: `cfg.cssEntry` é inlinado no FIM de `_ds_bundle.css`, e `@import` de
// CSS depois de qualquer regra é ignorado pelo browser; `cfg.tokensGlob` só
// funciona dentro de um `tokensPkg`, que este repo não tem.
//
// Ordem importa: fontes primeiro, para o `@import` remoto sair no topo do
// arquivo emitido.
import './fonts.css';
// A folha global de verdade, referenciada e não copiada — ela importa
// design/tokens.css e define as regras de `body` que dão tipografia e cor base.
// Uma cópia inline aqui apodreceria no primeiro ajuste da app.
import '../apps/web/src/index.css';

/**
 * Faixa de tradução (AT-550, ADR 0216 item 6) — swizzle em modo WRAP.
 *
 * Num locale que não é o pt-BR, `metadata.source` diz de onde a página veio:
 * `@site/docs/...` é o FALLBACK (a fonte em português, sem tradução neste
 * locale); `@site/i18n/<locale>/...` é a tradução. Para a tradução, o
 * `traducao.json` (gerado por `pnpm docs:generate`) diz se a fonte mudou
 * depois do `traducao_de`. Página em dia não ganha faixa.
 */
import React, { type ReactNode } from 'react';
import Content from '@theme-original/DocItem/Content';
import type ContentType from '@theme/DocItem/Content';
import type { WrapperProps } from '@docusaurus/types';
import { useDoc } from '@docusaurus/plugin-content-docs/client';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Translate from '@docusaurus/Translate';
import traducao from '@site/src/data/traducao.json';

type Props = WrapperProps<typeof ContentType>;
type Estado = { defasada: boolean; data: string | null };

function Faixa({ children }: { children: ReactNode }) {
  return (
    <div className="alert alert--warning margin-bottom--md" role="note" data-faixa-de-traducao="">
      {children}
    </div>
  );
}

export default function ContentWrapper(props: Props): ReactNode {
  const { metadata } = useDoc();
  const {
    i18n: { currentLocale, defaultLocale },
  } = useDocusaurusContext();
  let faixa: ReactNode = null;
  if (currentLocale !== defaultLocale) {
    const source = metadata.source;
    const prefixo = `@site/i18n/${currentLocale}/docusaurus-plugin-content-docs/current/`;
    if (source.startsWith('@site/docs/')) {
      faixa = (
        <Faixa>
          <Translate id="traducao.faixa.naoTraduzida">
            Esta página ainda não foi traduzida; você está lendo o original em português.
          </Translate>
        </Faixa>
      );
    } else if (source.startsWith(prefixo)) {
      const rel = source.slice(prefixo.length);
      const estado = (traducao as Record<string, Record<string, Estado>>)[currentLocale]?.[rel];
      if (estado?.defasada) {
        faixa = (
          <Faixa>
            <Translate id="traducao.faixa.defasada" values={{ data: estado.data ?? '?' }}>
              {'Tradução de {data}; o original mudou depois.'}
            </Translate>
          </Faixa>
        );
      }
    }
  }
  return (
    <>
      {faixa}
      <Content {...props} />
    </>
  );
}

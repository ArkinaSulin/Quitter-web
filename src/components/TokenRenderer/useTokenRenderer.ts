// src/components/TokenRenderer/useTokenRenderer.ts
'use client';

import { useState, useCallback, useEffect } from 'react';
import { TokenRenderer, TokenRendererProps } from './TokenRenderer';

export function useTokenRenderer(props: Omit<TokenRendererProps, 'onRender'>) {
  const [dataURL, setDataURL] = useState<string | null>(null);

  const handleRender = useCallback((url: string) => {
    setDataURL(url);
  }, []);

  const renderComponent = useCallback(() => {
    return <TokenRenderer {...props} onRender={handleRender} />;
  }, [props]);

  return {
    dataURL,
    renderComponent,
  };
}
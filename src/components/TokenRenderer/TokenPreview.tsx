// src/components/TokenRenderer/TokenPreview.tsx
'use client';

import { useState, useEffect } from 'react';
import { TokenRenderer, TokenRendererProps } from './TokenRenderer';

interface TokenPreviewProps extends Omit<TokenRendererProps, 'onRender'> {
  onDataURL?: (dataURL: string) => void;
}

export function TokenPreview(props: TokenPreviewProps) {
  const [dataURL, setDataURL] = useState<string | null>(null);

  const handleRender = (url: string) => {
    setDataURL(url);
    if (props.onDataURL) {
      props.onDataURL(url);
    }
  };

  return <TokenRenderer {...props} onRender={handleRender} />;
}
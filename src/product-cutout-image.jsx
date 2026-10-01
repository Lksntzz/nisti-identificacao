import React, { useEffect, useState } from 'react';
import { useTreatedProductImage } from './mural-transparent-image.js';

export default function ProductCutoutImage({
  src,
  alt = '',
  className = '',
  loading = 'lazy',
  fetchPriority = 'auto',
  referrerPolicy = 'no-referrer',
  fallback = null,
  onError,
  ...props
}) {
  const originalSrc = String(src || '').trim();
  const normalized = originalSrc.replace(/^\/api\/images\/(\d+)/, '/api/product-images/$1');
  const treatedSrc = useTreatedProductImage(normalized, Boolean(normalized));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [treatedSrc]);

  if (!normalized || failed) return fallback;

  return (
    <img
      {...props}
      className={className}
      src={treatedSrc || normalized}
      alt={alt}
      loading={loading}
      fetchPriority={fetchPriority}
      referrerPolicy={referrerPolicy}
      decoding="async"
      onError={event => {
        setFailed(true);
        onError?.(event);
      }}
    />
  );
}

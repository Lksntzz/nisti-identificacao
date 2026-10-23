import React from 'react';
import { useTreatedProductImage } from '../mural-transparent-image.js';

export const EMPTY_POST = {
  kind: 'notice', title: '', subtitle: '', body: '', badge: 'NOVO', badge_tone: 'success',
  product_id: '', collection_id: '', notice_level: 'info', featured: false, priority: 0,
  published_at: '', expires_at: ''
};


export function AdminMuralIcon({ name, size = 22 }) {
  const common = {
    width:size, height:size, viewBox:'0 0 24 24', fill:'none',
    stroke:'currentColor', strokeWidth:1.9, strokeLinecap:'round', strokeLinejoin:'round',
    className: `mural-admin-icon-svg mural-admin-icon-svg-${name}`,
    'aria-hidden':true
  };
  if (name === 'product') return <svg {...common}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.4 7.7 7.6 4.2 7.6-4.2M12 12v9"/></svg>;
  if (name === 'collection') return <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg>;
  if (name === 'notice') return <svg {...common}><path d="M4 13V9l12-5v14L4 13Z"/><path d="M16 8h2.5A2.5 2.5 0 0 1 21 10.5v1A2.5 2.5 0 0 1 18.5 14H16M6 13l1.5 6h4L10 14"/></svg>;
  if (name === 'sparkles') return <svg {...common}><path d="m12 3 1.35 4.15L17.5 8.5l-4.15 1.35L12 14l-1.35-4.15L6.5 8.5l4.15-1.35L12 3Z"/><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/></svg>;
  if (name === 'refresh') return <svg {...common}><path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/></svg>;
  if (name === 'check') return <svg {...common}><path d="m5 12 4 4L19 6"/></svg>;
  if (name === 'trash') return <svg {...common}><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>;
  if (name === 'image') return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/></svg>;
  if (name === 'back') return <svg {...common}><path d="m15 18-6-6 6-6"/></svg>;
  if (name === 'document') return <svg {...common}><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/></svg>;
  if (name === 'search') return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>;
  if (name === 'sliders') return <svg {...common}><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M8 15v4"/></svg>;
  if (name === 'more') return <svg {...common}><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>;
  if (name === 'calendar') return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>;
  if (name === 'user') return <svg {...common}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>;
  if (name === 'home') return <svg {...common}><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></svg>;
  if (name === 'chevron') return <svg {...common}><path d="m9 18 6-6-6-6"/></svg>;
  if (name === 'eye') return <svg {...common}><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.7"/></svg>;
  if (name === 'upload') return <svg {...common}><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 14v5h14v-5"/></svg>;
  if (name === 'clock') return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>;
  if (name === 'info') return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/></svg>;
  if (name === 'close') return <svg {...common}><path d="m7 7 10 10M17 7 7 17"/></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>;
}

export async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(data?.error || `Erro ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function requestBlob(path, options = {}) {
  const response = await fetch(path, { credentials:'same-origin', cache:'no-store', ...options });
  const type=response.headers.get('content-type')||'';
  if(!response.ok){
    const data=type.includes('application/json')?await response.json().catch(()=>({})):{};
    throw new Error(data?.error||`Erro ${response.status}`);
  }
  const blob=await response.blob();
  if(blob.type!=='image/png'||blob.size<1)throw new Error('O Canva não retornou um PNG válido.');
  return blob;
}

function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function TransparentMuralProductImage({ src, alt = '', className = '', draggable = false, ariaHidden = false }) {
  const displaySrc = useTreatedProductImage(src, Boolean(src));
  if (!displaySrc) return null;
  return (
    <img
      src={displaySrc}
      alt={alt}
      className={`${className} mural-product-transparent`.trim()}
      draggable={draggable}
      aria-hidden={ariaHidden ? 'true' : undefined}
    />
  );
}

export function postForm(row) {
  const source = row ?? EMPTY_POST;
  return {
    ...EMPTY_POST, ...source,
    product_id: source.product_id || '',
    collection_id: source.collection_id || '',
    featured: Boolean(source.featured),
    published_at: toLocalInput(source.published_at),
    expires_at: toLocalInput(source.expires_at)
  };
}

export async function compressImage(file) {
  if (!file || file.size <= 0) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 5 * 1024 * 1024) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const type = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  const blob = await new Promise(resolve => canvas.toBlob(resolve, type, .86));
  if (!blob) throw new Error('Não foi possível preparar a imagem.');
  return new File([blob], file.name, { type });
}

export function Status({ value }) {
  const labels = { draft: 'Rascunho', published: 'Publicado', archived: 'Arquivado' };
  return <span className={`mural-admin-status ${value}`}><i aria-hidden="true" />{labels[value] || value}</span>;
}


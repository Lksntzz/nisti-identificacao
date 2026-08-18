const originalFetch = window.fetch.bind(window);
let currentSuggestions = [];
let renderTimer = null;

function requestPath(input) {
  try {
    const raw = typeof input === 'string' ? input : input?.url;
    return new URL(raw, location.href).pathname;
  } catch {
    return '';
  }
}

function clearSuggestions() {
  currentSuggestions = [];
  document.querySelector('.unmatched-suggestions')?.remove();
  if (renderTimer) {
    clearTimeout(renderTimer);
    renderTimer = null;
  }
}

function card(suggestion) {
  const article = document.createElement('article');
  article.className = 'unmatched-suggestion-card';

  const media = document.createElement('div');
  media.className = 'unmatched-suggestion-media';
  if (suggestion.image_url) {
    const image = document.createElement('img');
    image.src = suggestion.image_url;
    image.alt = `Possível capa ${suggestion.capa_code || ''}`.trim();
    image.loading = 'eager';
    media.appendChild(image);
  }

  const copy = document.createElement('div');
  copy.className = 'unmatched-suggestion-copy';

  const label = document.createElement('span');
  label.textContent = 'POSSÍVEL CAPA';
  copy.appendChild(label);

  const code = document.createElement('strong');
  code.textContent = suggestion.capa_code || '—';
  copy.appendChild(code);

  if (suggestion.sku) {
    const sku = document.createElement('small');
    sku.textContent = suggestion.sku;
    copy.appendChild(sku);
  }

  article.append(media, copy);
  return article;
}

function renderSuggestions(attempt = 0) {
  document.querySelector('.unmatched-suggestions')?.remove();
  if (!currentSuggestions.length) return;

  const errorCard = document.querySelector('.general .status.error');
  if (!errorCard) {
    if (attempt < 30) renderTimer = setTimeout(() => renderSuggestions(attempt + 1), 50);
    return;
  }

  const section = document.createElement('section');
  section.className = 'unmatched-suggestions';
  section.setAttribute('aria-label', 'Capas visualmente semelhantes não confirmadas');

  const head = document.createElement('div');
  head.className = 'unmatched-suggestions-head';
  const title = document.createElement('h3');
  title.textContent = 'Talvez seja uma destas capas';
  const text = document.createElement('p');
  text.textContent = 'O sistema não confirmou nenhuma capa com segurança. Estas referências são apenas as mais parecidas e não contam como identificação automática.';
  head.append(title, text);

  const grid = document.createElement('div');
  grid.className = 'unmatched-suggestions-grid';
  currentSuggestions.slice(0, 3).forEach(item => grid.appendChild(card(item)));

  const note = document.createElement('div');
  note.className = 'unmatched-suggestions-note';
  note.textContent = 'Compare visualmente. Se nenhuma for a capa correta, fotografe novamente.';

  section.append(head, grid, note);
  errorCard.insertAdjacentElement('afterend', section);
}

window.fetch = async function nistiFetchWithSuggestions(input, init) {
  const path = requestPath(input);
  if (path === '/api/identify-candidates') clearSuggestions();

  const response = await originalFetch(input, init);

  if (path === '/api/identify-confirm') {
    if (response.ok) {
      clearSuggestions();
    } else if (response.status === 422) {
      const data = await response.clone().json().catch(() => null);
      if (Array.isArray(data?.suggestions) && data.suggestions.length && data.suggestions_are_unconfirmed === true) {
        currentSuggestions = data.suggestions;
        renderSuggestions();
      } else {
        clearSuggestions();
      }
    } else {
      clearSuggestions();
    }
  }

  return response;
};

document.addEventListener('change', event => {
  if (event.target?.matches?.('.camera input[type="file"]')) clearSuggestions();
});

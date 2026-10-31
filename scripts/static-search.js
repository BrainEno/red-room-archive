// Search the build-time public index locally; no server or private data is involved.
(async () => {
  const query = new URLSearchParams(location.search).get('q')?.trim().slice(0, 120) || '';
  if (!query) return;
  const input = document.querySelector('#q');
  const section = document.querySelector('main .listing');
  if (!input || !section) return;
  input.value = query;
  const chinese = document.documentElement.lang === 'zh-CN';
  const status = document.createElement('p');
  status.className = 'article-intro'; status.setAttribute('role', 'status');
  section.append(status);
  try {
    const basePath = document.documentElement.dataset?.basePath || '';
    const response = await fetch(`${basePath}/static-search.json`);
    if (!response.ok) throw new Error('index unavailable');
    const index = await response.json();
    const terms = query.toLowerCase().split(/\s+/);
    const results = index[chinese ? 'zh-CN' : 'en'].map((article) => {
      const fields = [[article.title, 5], [article.searchTags.join(' '), 3], [article.excerpt, 2], [article.text, 1]];
      const score = terms.reduce((sum, term) => {
        const best = Math.max(0, ...fields.filter(([value]) => value.toLowerCase().includes(term)).map(([, weight]) => weight));
        return sum === -1 || !best ? -1 : sum + best;
      }, 0);
      return { article, score };
    }).filter((item) => item.score >= 0).sort((a, b) => b.score - a.score);
    status.textContent = chinese ? `“${query}” — ${results.length} 条结果` : `${results.length} results for “${query}”`;
    if (!results.length) return;
    const list = document.createElement('ol'); list.className = 'article-list';
    for (const { article } of results.slice(0, 30)) {
      const li = document.createElement('li');
      const link = document.createElement('a'); link.className = 'article-entry'; link.href = article.href;
      const date = document.createElement('time'); date.className = 'article-date'; date.textContent = article.date.slice(0, 10);
      const copy = document.createElement('span'); copy.className = 'article-copy';
      const title = document.createElement('span'); title.className = 'article-title'; title.textContent = article.title; copy.append(title);
      if (article.excerpt) { const excerpt = document.createElement('span'); excerpt.className = 'article-excerpt'; excerpt.textContent = article.excerpt; copy.append(excerpt); }
      if (article.tags.length) { const tags = document.createElement('span'); tags.className = 'article-tags'; tags.textContent = article.tags.join(' / '); copy.append(tags); }
      const arrow = document.createElement('span'); arrow.className = 'article-arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '↗';
      link.append(date, copy, arrow); li.append(link); list.append(li);
    }
    const resultsSection = document.createElement('section'); resultsSection.className = 'results'; resultsSection.append(list); section.append(resultsSection);
  } catch {
    status.textContent = chinese ? '搜索暂时不可用。' : 'Search is temporarily unavailable.';
  }
})();

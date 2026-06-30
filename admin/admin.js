'use strict';

(function () {
  const searchInput = document.getElementById('search');
  const statusEl = document.getElementById('status');
  const resultsEl = document.getElementById('results');

  // ---- Live feed elements ----
  const feedSection = document.getElementById('feed-section');
  const feedStatus = document.getElementById('feed-status');
  const feedResults = document.getElementById('feed-results');
  const feedLive = document.getElementById('feed-live');
  const pager = document.getElementById('pager');
  const pagerInfo = document.getElementById('pager-info');
  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');

  const POLL_MS = 4000;

  let debounce = null;
  let lastQuery = '';

  // Feed state.
  let feedPage = 1;
  let pollTimer = null;
  let seenIds = null; // null until the first load, so we don't flash everything.

  // ---- Search ----
  searchInput.addEventListener('input', function () {
    clearTimeout(debounce);
    debounce = setTimeout(runSearch, 220);
  });

  async function runSearch() {
    const q = searchInput.value.trim();
    lastQuery = q;

    // Empty query: hand the screen back to the live feed.
    if (!q) {
      statusEl.textContent = 'Start typing to search.';
      resultsEl.innerHTML = '';
      showFeed();
      return;
    }

    // While searching, hide the feed and pause polling.
    hideFeed();
    statusEl.textContent = 'Searching…';

    try {
      const res = await fetch('/api/admin/search?q=' + encodeURIComponent(q));
      if (!res.ok) {
        statusEl.textContent = 'Search failed (' + res.status + '). Try again.';
        return;
      }
      const data = await res.json();
      // Ignore stale responses if the user kept typing.
      if (q !== lastQuery) return;
      render(data.results || [], q);
    } catch (err) {
      statusEl.textContent = 'Could not reach the server. Check the connection.';
    }
  }

  function render(results, query) {
    if (!results.length) {
      statusEl.textContent = '';
      resultsEl.innerHTML =
        '<div class="empty">No signed waiver found for <strong>"' +
        escapeHtml(query) +
        '"</strong>.<br/>Double-check the spelling, or have them sign one now.</div>';
      return;
    }

    statusEl.textContent =
      results.length + (results.length === 1 ? ' match' : ' matches') + ' found.';

    resultsEl.innerHTML = results.map((r) => card(r, query, false)).join('');
  }

  function signedWhen(r) {
    return r.created_at ? formatDateTime(r.created_at) : formatDate(r.signed_date);
  }

  // ---- Live feed (paginated, newest first) ----
  function showFeed() {
    feedSection.hidden = false;
    feedPage = 1;
    loadFeed(true);
    startPolling();
  }

  function hideFeed() {
    feedSection.hidden = true;
    stopPolling();
  }

  function startPolling() {
    stopPolling();
    // Only the newest page auto-refreshes; older pages are for browsing history.
    pollTimer = setInterval(function () {
      if (feedPage === 1 && !searchInput.value.trim()) loadFeed(false);
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function loadFeed(showLoading) {
    if (showLoading) feedStatus.textContent = 'Loading…';
    try {
      const res = await fetch('/api/admin/list?page=' + feedPage);
      if (!res.ok) {
        feedStatus.textContent = 'Could not load recent sign-ins (' + res.status + ').';
        return;
      }
      const data = await res.json();
      renderFeed(data);
    } catch (err) {
      feedStatus.textContent = 'Could not reach the server. Check the connection.';
    }
  }

  function renderFeed(data) {
    const results = data.results || [];
    const total = data.total || 0;
    const totalPages = data.totalPages || 1;
    feedPage = data.page || 1;

    if (!total) {
      feedStatus.textContent = 'No waivers signed yet. New sign-ins will appear here automatically.';
      feedResults.innerHTML = '';
      pager.hidden = true;
      seenIds = new Set();
      return;
    }

    feedStatus.textContent =
      total + (total === 1 ? ' waiver' : ' waivers') + ' on file — newest first.';

    // Figure out which cards are brand-new since the last render (page 1 only),
    // so we can briefly highlight live arrivals at the booth.
    const firstLoad = seenIds === null;
    const currentIds = results.map((r) => r.id);
    const isNew = {};
    if (!firstLoad && feedPage === 1) {
      currentIds.forEach((id) => {
        if (!seenIds.has(id)) isNew[id] = true;
      });
    }

    feedResults.innerHTML = results.map((r) => card(r, '', isNew[r.id])).join('');

    // Track seen ids (accumulate, so paging back and forth doesn't re-flash).
    if (firstLoad) seenIds = new Set();
    currentIds.forEach((id) => seenIds.add(id));

    // Pager.
    pager.hidden = totalPages <= 1;
    pagerInfo.textContent = 'Page ' + feedPage + ' of ' + totalPages;
    prevBtn.disabled = feedPage <= 1;
    nextBtn.disabled = feedPage >= totalPages;

    // Live indicator dims when you're browsing older pages.
    feedLive.classList.toggle('paused', feedPage !== 1);
    feedLive.textContent = feedPage === 1 ? '● Live' : '● Paused';
  }

  prevBtn.addEventListener('click', function () {
    if (feedPage > 1) {
      feedPage -= 1;
      loadFeed(true);
    }
  });

  nextBtn.addEventListener('click', function () {
    feedPage += 1;
    loadFeed(true);
  });

  // ---- Shared card rendering ----
  function card(r, query, isNew) {
    const minorsHtml = r.minors.length
      ? r.minors
          .map(function (name) {
            const matched = query && name.toLowerCase().includes(query.toLowerCase());
            return (
              '<span class="minor-tag' + (matched ? ' match' : '') + '">' +
              highlight(name, query) +
              '</span>'
            );
          })
          .join('')
      : '<span class="minor-tag none">No children listed</span>';

    return (
      '<div class="card' + (isNew ? ' card-new' : '') + '">' +
      '<div class="card-head">' +
      '<p class="card-name">' + highlight(r.adult_name, query) + '</p>' +
      '<span class="badge">✓ Waiver on file</span>' +
      '</div>' +
      '<p class="card-meta">Signed ' + signedWhen(r) + '</p>' +
      '<div class="minor-tags">' + minorsHtml + '</div>' +
      '<div class="card-actions">' +
      '<a class="view-pdf" href="/admin/pdf/' + encodeURIComponent(r.pdf_filename) +
      '" target="_blank" rel="noopener">View signed PDF</a>' +
      '<button type="button" class="delete-waiver" data-id="' + r.id +
      '" data-name="' + escapeHtml(r.adult_name) +
      '" title="Remove this record so the parent can sign a corrected waiver">' +
      'Delete &amp; re-sign</button>' +
      '</div>' +
      '</div>'
    );
  }

  // Delete a waiver (delegated from both the feed and search result lists), then
  // refresh whichever view is showing. The parent can then sign a fresh waiver.
  function onCardClick(e) {
    const btn = e.target.closest('.delete-waiver');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const name = btn.getAttribute('data-name') || 'this person';
    const ok = window.confirm(
      'Delete the waiver for ' + name + '?\n\n' +
      'This permanently removes the record and its PDF so they can sign a ' +
      'corrected one. This cannot be undone.'
    );
    if (ok) removeWaiver(id, btn);
  }

  async function removeWaiver(id, btn) {
    btn.disabled = true;
    btn.textContent = 'Deleting…';
    try {
      const res = await fetch('/api/admin/waiver/' + encodeURIComponent(id), { method: 'DELETE' });
      if (!res.ok) {
        btn.disabled = false;
        btn.innerHTML = 'Delete &amp; re-sign';
        window.alert('Could not delete that waiver (' + res.status + '). Please try again.');
        return;
      }
      // Refresh the active view so the deleted card disappears.
      if (searchInput.value.trim()) {
        runSearch();
      } else {
        loadFeed(false);
      }
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = 'Delete &amp; re-sign';
      window.alert('Could not reach the server. Check the connection and try again.');
    }
  }

  feedResults.addEventListener('click', onCardClick);
  resultsEl.addEventListener('click', onCardClick);

  function formatDate(iso) {
    // iso is YYYY-MM-DD; render without timezone surprises.
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!parts) return iso || '';
    const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function formatDateTime(stamp) {
    // created_at is "YYYY-MM-DD HH:MM:SS" in UTC; show date + time in local time.
    const d = new Date(String(stamp).replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return String(stamp);
    const date = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return date + ' at ' + time;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function highlight(text, query) {
    const safe = escapeHtml(text);
    if (!query) return safe;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return safe;
    // Highlight against the escaped string by re-finding within the original.
    const before = escapeHtml(text.slice(0, idx));
    const mid = escapeHtml(text.slice(idx, idx + query.length));
    const after = escapeHtml(text.slice(idx + query.length));
    return before + '<span class="match-hl">' + mid + '</span>' + after;
  }

  // Kick off the live feed on load.
  showFeed();
})();

/* ============================================================
   Comments — frontend behavior
   ------------------------------------------------------------
   Production path (Netlify):
     The form has data-netlify="true". On submit, Netlify
     captures the entry and you'll see it in the Netlify UI
     under Forms. No backend code needed.

   Spam protection — switch on later:
     1. Cloudflare Turnstile widget (free, no PII):
        - Add site key to <div class="cf-turnstile" data-sitekey="...">
          inside the form (slot already in HTML, commented out).
        - Add the Turnstile script tag in tracking.html <head>.
        - Verify token server-side via a Netlify Function
          (or Cloudflare Worker if you ever move hosting).
     2. As a simpler interim: enable Netlify's built-in
        honeypot or hCaptcha in netlify.toml — already wired.

   For local preview (file:// or netlify dev without the form
   service), this script falls back to client-side rendering so
   you can see the UX without round-tripping the network.
   ============================================================ */

(function () {
  const form = document.getElementById('comments-form');
  const list = document.getElementById('comments-list');
  if (!form || !list) return;

  const LS_KEY = 'verendrye:comments:demo';

  // Render any locally-stored demo comments so the page isn't empty in dev
  renderStored();

  form.addEventListener('submit', (e) => {
    // If we're hosted on Netlify, let the native form post happen.
    // Otherwise, intercept and store locally so the demo works offline.
    const onNetlify = location.hostname.endsWith('netlify.app')
                    || location.hostname.endsWith('netlify.live')
                    || document.body.dataset.netlify === 'live';

    if (onNetlify) return; // Netlify handles it

    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.name || !data.message) return;

    const entry = {
      name: String(data.name).slice(0, 60),
      message: String(data.message).slice(0, 800),
      at: new Date().toISOString(),
    };

    const stored = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    stored.unshift(entry);
    localStorage.setItem(LS_KEY, JSON.stringify(stored.slice(0, 50)));

    form.reset();
    renderStored();

    const note = form.querySelector('.comments__note');
    if (note) {
      const prev = note.innerHTML;
      note.innerHTML = '<strong>Saved locally (demo mode).</strong> Once deployed to Netlify your comment will be posted for real.';
      setTimeout(() => { note.innerHTML = prev; }, 4500);
    }
  });

  function renderStored() {
    const stored = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    list.innerHTML = stored.map(c => `
      <article class="comment">
        <div class="comment__head">
          <span class="comment__author">${escapeHtml(c.name)}</span>
          <span class="comment__date">${formatDate(c.at)}</span>
        </div>
        <p class="comment__body">${escapeHtml(c.message)}</p>
      </article>
    `).join('');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return ''; }
  }
})();

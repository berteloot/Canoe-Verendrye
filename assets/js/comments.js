/* ============================================================
   Comments — frontend behavior
   ------------------------------------------------------------
   Production path:
     POST to the Cloudflare Worker at comments-api.berteloot.org.
     The Worker verifies the Turnstile token, checks the secret
     code, and forwards the message to the Garmin inReach.
     See worker/index.js.

   Local preview (file:// or any host that isn't the live site):
     Falls back to localStorage so the UX is still visible.
   ============================================================ */

(function () {
  const form = document.getElementById('comments-form');
  const list = document.getElementById('comments-list');
  if (!form || !list) return;

  const LS_KEY = 'verendrye:comments:demo';
  const ENDPOINT = 'https://comments-api.berteloot.org/';
  const note = document.getElementById('comments-note') || form.querySelector('.comments__note');
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalNoteHtml = note ? note.innerHTML : '';

  // Render obfuscated email addresses.
  document.querySelectorAll('.js-email').forEach(el => {
    const u = el.dataset.u, d = el.dataset.d;
    if (!u || !d) return;
    const a = document.createElement('a');
    a.href = 'mailto:' + u + '@' + d;
    a.textContent = u + '@' + d;
    el.replaceWith(a);
  });

  renderStored();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.name || !data.message) return;

    const isLive = location.hostname.endsWith('berteloot.org');

    if (!isLive) {
      // Local preview: store + render locally.
      saveLocal({
        name: String(data.name).slice(0, 60),
        message: String(data.message).slice(0, 800),
        at: new Date().toISOString(),
      });
      form.reset();
      flashNote('<strong>Saved locally (preview mode).</strong> On the live site this forwards to the Garmin.');
      return;
    }

    // Production: post to Worker.
    if (!data['cf-turnstile-response']) {
      flashNote('<strong>Captcha not ready.</strong> Please wait a moment and try again.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        form.reset();
        if (window.turnstile) window.turnstile.reset();
        flashNote('<strong>On its way.</strong> Your message is headed to the Garmin via satellite.');
      } else {
        if (window.turnstile) window.turnstile.reset();
        if (body.error === 'invalid_code' || body.error === 'missing_code') {
          flashNote('<strong>Wrong code.</strong> Don\'t have it? Email <a href="mailto:pierre@nytromarketing.com">pierre@nytromarketing.com</a> and Pierre will pass your message along.');
        } else if (body.error === 'captcha_failed') {
          flashNote('<strong>Security check failed.</strong> The form has been refreshed — please try again.');
        } else {
          flashNote(`<strong>Couldn\'t send (${body.error || res.status}).</strong> Try again or email <a href="mailto:pierre@nytromarketing.com">pierre@nytromarketing.com</a>.`);
        }
      }
    } catch (err) {
      flashNote("<strong>Network error.</strong> Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  });

  function saveLocal(entry) {
    const stored = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    stored.unshift(entry);
    localStorage.setItem(LS_KEY, JSON.stringify(stored.slice(0, 50)));
    renderStored();
  }

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

  function setBusy(busy) {
    if (!submitBtn) return;
    submitBtn.disabled = busy;
    submitBtn.textContent = busy ? 'Sending…' : 'Send →';
  }

  function flashNote(html) {
    if (!note) return;
    note.innerHTML = html;
    clearTimeout(flashNote._t);
    flashNote._t = setTimeout(() => { note.innerHTML = originalNoteHtml; }, 6000);
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

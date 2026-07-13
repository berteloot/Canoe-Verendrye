/* ============================================================
   Contact form — frontend behavior
   ------------------------------------------------------------
   Posts to the Cloudflare Worker at comments-api.berteloot.org.
   The Worker verifies the Turnstile token and emails the message
   to Stan via Resend. See worker/index.js.

   A honeypot field ("bot-field") catches naive bots. Turnstile
   runs execute-on-submit so the token is always fresh.
   ============================================================ */

(function () {
  const form = document.getElementById('contact-form');
  if (!form) return;

  const ENDPOINT = 'https://comments-api.berteloot.org/';
  const note = document.getElementById('contact-note') || form.querySelector('.comments__note');
  const submitBtn = form.querySelector('button[type="submit"]');
  const successPanel = document.getElementById('contact-success');
  const originalNoteHtml = note ? note.innerHTML : '';

  // Turnstile execute-on-submit: pendingData holds form values while we wait
  // for a fresh token from Cloudflare (avoids expired-token errors).
  let pendingData = null;

  window.onTurnstileToken = async function (token) {
    if (!pendingData) return;
    const data = Object.assign({}, pendingData, { 'cf-turnstile-response': token });
    pendingData = null;
    await doPost(data);
  };

  window.onTurnstileError = function () {
    pendingData = null;
    setBusy(false);
    flashNote('<strong>Security check failed.</strong> Try refreshing the page.');
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.name || !data.message) return;

    setBusy(true);
    pendingData = data;

    if (window.turnstile) {
      // Execute triggers the challenge and fires onTurnstileToken with a fresh token.
      window.turnstile.execute('.cf-turnstile');
    } else {
      // Turnstile script not loaded yet (or blocked). Don't silently no-op —
      // tell the visitor to try again rather than submitting a token-less request.
      pendingData = null;
      setBusy(false);
      flashNote('<strong>Security check still loading.</strong> Give it a second, then press Send again.');
    }
  });

  async function doPost(data) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        if (window.turnstile) window.turnstile.reset('.cf-turnstile');
        form.reset();
        if (successPanel) {
          // Replace the form with a persistent confirmation so it can't read as "nothing happened".
          form.hidden = true;
          successPanel.hidden = false;
          successPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          flashNote('<strong>Message sent.</strong> Thanks for writing. Stan will read it and reply if you left an email.');
        }
      } else {
        if (window.turnstile) window.turnstile.reset('.cf-turnstile');
        if (body.error === 'captcha_failed' || body.error === 'missing_captcha') {
          flashNote('<strong>Security check failed.</strong> Please refresh the page and try again.');
        } else if (body.error === 'invalid_email') {
          flashNote('<strong>That email looks off.</strong> Fix it, or leave it blank to send without a reply address.');
        } else {
          flashNote(`<strong>Couldn't send (${body.error || res.status}).</strong> Please try again in a moment.`);
        }
      }
    } catch (err) {
      flashNote('<strong>Network error.</strong> Check your connection and try again.');
    } finally {
      setBusy(false);
    }
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
    flashNote._t = setTimeout(() => { note.innerHTML = originalNoteHtml; }, 8000);
  }
})();

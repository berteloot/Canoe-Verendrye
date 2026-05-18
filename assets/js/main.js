/* Mobile nav toggle + active link highlighting + EN/FR language toggle */

(function () {
  const toggle = document.querySelector('.nav__toggle');
  const links  = document.querySelector('.nav__links');

  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  // Mark current page in nav
  const here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav__links a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === here || (here === '' && href === 'index.html')) {
      a.classList.add('is-active');
    }
  });
})();

/* ---------- Language toggle ---------------------------------
   Drives Google Translate via the `googtrans` cookie so we can
   keep our own EN/FR button instead of Google's dropdown. The
   hidden #google_translate_element below reads the cookie on
   page load and translates the DOM if it's set to `/en/fr`.
   ------------------------------------------------------------ */

function vCanoeReadLang() {
  const m = document.cookie.match(/googtrans=\/en\/(fr|en)/);
  return m ? m[1] : 'en';
}

function vCanoeSetLang(lang) {
  const host = location.hostname;
  const value = `googtrans=/en/${lang}; path=/`;
  document.cookie = value;
  if (host) {
    document.cookie = `${value}; domain=${host}`;
    document.cookie = `${value}; domain=.${host}`;
  }
  location.reload();
}

(function () {
  const buttons = document.querySelectorAll('.lang-toggle button');
  if (!buttons.length) return;

  const current = vCanoeReadLang();
  buttons.forEach(b => {
    if (b.dataset.lang === current) b.classList.add('is-active');
    b.addEventListener('click', () => {
      if (b.dataset.lang === current) return;
      vCanoeSetLang(b.dataset.lang);
    });
  });
})();

/* Google Translate widget init (called by the loader script) */
function googleTranslateElementInit() {
  /* eslint-disable no-undef */
  new google.translate.TranslateElement({
    pageLanguage: 'en',
    includedLanguages: 'fr,en',
    autoDisplay: false,
    layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
  }, 'google_translate_element');
}

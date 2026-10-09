(function (w) {
  'use strict';
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const formatPrice = (n) => 'Rs. ' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const discountPercent = (orig, disc) => Math.round((1 - disc / orig) * 100);
  const titleCase = (s) => s.trim().toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());
  const offerMessage = (title) => 'Hi මට ' + titleCase(title) + ' එක ගන්න ආවෙ';
  const VIP_MESSAGE = 'Hi මට VIP එක BUY කරන්න ඕනි';
  const telegramLink = (base, msg) => base + '?text=' + encodeURIComponent(msg);
  const formatDate = (d) =>
    new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  function offerCard(o, opts) {
    opts = opts || {};
    const card = el('article', 'offer-card');
    card.append(el('h3', 'badge', o.title));
    const prices = el('div', 'prices');
    prices.append(el('s', 'old-price', formatPrice(o.original_price)));
    prices.append(el('strong', 'new-price', formatPrice(o.discounted_price)));
    prices.append(el('span', 'pct', discountPercent(o.original_price, o.discounted_price) + '% OFF'));
    card.append(prices);
    if (o.description) card.append(el('p', 'offer-desc', o.description));
    if (o.expires_date) {
      const soon = o.expires_at && o.expires_at - Date.now() < 72 * 3600 * 1000;
      card.append(el('p', 'expiry' + (soon ? ' soon' : ''), (soon ? 'Ending soon · ' : '') + 'Offer ends ' + formatDate(o.expires_date)));
    }
    let buy;
    if (opts.preview || !opts.adminUrl) {
      buy = el('span', 'btn btn-glow btn-block', o.button_text || 'Buy Now');
      buy.setAttribute('aria-disabled', 'true');
    } else {
      buy = el('a', 'btn btn-glow btn-block', o.button_text || 'Buy Now');
      buy.href = telegramLink(opts.adminUrl, offerMessage(o.title));
      buy.target = '_blank';
      buy.rel = 'noopener noreferrer';
    }
    card.append(buy);
    return card;
  }

  function toast(msg, type) {
    const host = document.querySelector('dialog[open]') || document.body;
    let box = host.querySelector(':scope > .toasts');
    if (!box) { box = el('div', 'toasts'); box.setAttribute('aria-live', 'polite'); host.append(box); }
    const t = el('div', 'toast ' + (type || 'ok'), msg);
    t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    box.append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => { t.remove(); if (!box.children.length) box.remove(); }, 300); }, 3800);
  }

  // Backdrop click closes <dialog>
  function dialogBackdropClose(d) {
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  }

  w.HV = { el, formatPrice, discountPercent, titleCase, offerMessage, VIP_MESSAGE, telegramLink, offerCard, toast, dialogBackdropClose };
})(window);

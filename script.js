(function () {
  'use strict';
  const { el, formatPrice, telegramLink, VIP_MESSAGE, offerCard, dialogBackdropClose } = window.HV;
  const $ = (id) => document.getElementById(id);
  const vip = $('vipDialog');
  let adminUrl = 'https://t.me/HAMBAWAVIP';
  let lastData = null;

  document.getElementById('year').textContent = new Date().getFullYear();
  dialogBackdropClose(vip);
  vip.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => vip.close()));
  $('btnBuyVip').addEventListener('click', () => vip.showModal());

  function render(data) {
    const s = data.settings;
    adminUrl = s.admin_url;
    document.title = s.site_title + ' — Premium Media Membership';
    ['brandName', 'heroBrand', 'footBrand', 'vipTitle'].forEach((id) => { $(id).textContent = s.site_title; });
    $('btnMain').href = $('footMain').href = s.main_group_url;
    $('btnContact').href = $('footContact').href = s.admin_url;
    $('btnContact').textContent = s.contact_label;
    $('vipPrice').textContent = formatPrice(s.default_price);
    $('vipBuy').href = telegramLink(s.admin_url, VIP_MESSAGE);

    const ann = $('announce');
    ann.hidden = !s.announcement;
    ann.textContent = s.announcement || '';

    $('offers').hidden = !s.offers_visible;
    $('btnOffers').hidden = !s.offers_visible;

    const grid = $('offerGrid');
    grid.replaceChildren();
    const now = Date.now();
    const live = data.offers.filter((o) => !o.expires_at || o.expires_at > now); // never show expired
    if (!live.length) {
      const empty = el('div', 'empty glass');
      empty.append(el('h3', null, 'No active offers right now'));
      empty.append(el('p', null, 'New offers are posted here as soon as they go live. You can still get the lifetime membership with BUY VIP.'));
      grid.append(empty);
      return;
    }
    live.forEach((o) => grid.append(offerCard(o, { adminUrl })));
  }

  async function load(showError) {
    try {
      const r = await fetch('/api/public', { cache: 'no-store' });
      if (!r.ok) throw new Error('bad status');
      lastData = await r.json();
      render(lastData);
    } catch (e) {
      if (!showError && lastData) return; // keep what is on screen
      const grid = $('offerGrid');
      grid.replaceChildren();
      const box = el('div', 'empty glass');
      box.append(el('h3', null, 'Could not load offers'));
      box.append(el('p', null, 'Check your connection and try again.'));
      const b = el('button', 'btn btn-ghost', 'Try again');
      b.type = 'button';
      b.addEventListener('click', () => { grid.replaceChildren(el('div', 'loading', 'Loading offers…')); load(true); });
      box.append(b);
      grid.append(box);
    }
  }

  load(true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(false); });
  setInterval(() => { if (!document.hidden) load(false); }, 60000);
})();

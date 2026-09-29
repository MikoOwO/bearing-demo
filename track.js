/*
 * Bearing demo — suivi d'usage envoyé à Supabase (table public.events, insertion seule).
 * Ne modifie pas le comportement de la démo : tout est observé depuis l'extérieur
 * (écouteurs en phase de capture, MutationObserver, IntersectionObserver).
 */
(() => {
  const SUPABASE_URL = 'https://nrjgyqistgulfpeycoyp.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_VTf9Z88VdCHhZWjosj0I_Q_ibTjvLj5';
  const ENDPOINT = SUPABASE_URL + '/rest/v1/events';
  const IDLE_AFTER_MS = 60000;   // sans interaction pendant 60 s = inactif, le chrono s'arrête
  const TICK_MS = 15000;         // les chronos en cours sont vidés toutes les 15 s
  const FLUSH_MS = 5000;

  // ---------- Identité ----------
  const store = (s, k, v) => { try { if (v === undefined) return s.getItem(k); s.setItem(k, v); } catch (_) {} return null; };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      }));

  const params = new URLSearchParams(location.search);
  const urlTag = (params.get('f') || params.get('ref') || '').trim().slice(0, 100);
  if (urlTag) store(localStorage, 'bearing_tag', urlTag);
  const founderTag = urlTag || store(localStorage, 'bearing_tag') || null;

  let visitorId = store(localStorage, 'bearing_vid');
  const returning = !!visitorId;
  if (!visitorId) { visitorId = uuid(); store(localStorage, 'bearing_vid', visitorId); }
  const visitNumber = (parseInt(store(localStorage, 'bearing_visits') || '0', 10) || 0) + 1;

  let sessionId = store(sessionStorage, 'bearing_sid');
  const newSession = !sessionId;
  if (!sessionId) { sessionId = uuid(); store(sessionStorage, 'bearing_sid', sessionId); store(localStorage, 'bearing_visits', String(visitNumber)); }

  // ---------- Envoi ----------
  let queue = [];
  const dashboardEl = document.getElementById('dashboard');
  const currentPage = () => (dashboardEl && !dashboardEl.hidden ? 'dashboard' : 'landing');

  function track(type, fields = {}) {
    queue.push({
      session_id: sessionId,
      visitor_id: visitorId,
      founder_tag: founderTag,
      event_type: type,
      page: fields.page || currentPage(),
      target: fields.target != null ? String(fields.target).slice(0, 200) : null,
      duration_ms: fields.duration_ms != null ? Math.min(3600000, Math.max(0, Math.round(fields.duration_ms))) : null,
      props: fields.props || {},
      client_ts: new Date().toISOString(),
    });
    if (queue.length >= 20) flush();
  }

  function flush(useKeepalive) {
    if (!queue.length) return;
    const batch = queue; queue = [];
    fetch(ENDPOINT, {
      method: 'POST',
      keepalive: !!useKeepalive,
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(batch),
    }).catch(() => { if (!useKeepalive) queue = batch.concat(queue).slice(-200); });
  }
  setInterval(() => flush(false), FLUSH_MS);

  // ---------- Chronos (temps actif uniquement : onglet visible et utilisateur non inactif) ----------
  // Une clé = "kind|page|zone". Elle est "désirée" tant que la zone est affichée ;
  // le temps ne court que si l'utilisateur est engagé.
  const wanted = new Map();   // key -> {kind, page, area}
  const running = new Map();  // key -> start (performance.now)
  let engaged = document.visibilityState === 'visible';
  let lastInput = performance.now();

  const keyOf = (kind, page, area) => kind + '|' + page + '|' + area;
  function emitChunk(key, now) {
    const start = running.get(key); const w = wanted.get(key);
    if (start == null || !w) return;
    const ms = now - start;
    if (ms >= 300) track('time', { page: w.page, target: w.area, duration_ms: ms, props: { kind: w.kind } });
  }
  function want(kind, page, area) {
    const key = keyOf(kind, page, area);
    if (wanted.has(key)) return;
    wanted.set(key, { kind, page, area });
    if (engaged) running.set(key, performance.now());
  }
  function unwant(kind, page, area) {
    const key = keyOf(kind, page, area);
    if (!wanted.has(key)) return;
    emitChunk(key, performance.now());
    running.delete(key); wanted.delete(key);
  }
  function unwantKind(kind, page) {
    [...wanted.values()].filter(w => w.kind === kind && (!page || w.page === page))
      .forEach(w => unwant(w.kind, w.page, w.area));
  }
  function setEngaged(on) {
    if (on === engaged) return;
    const now = performance.now();
    if (on) wanted.forEach((_, key) => running.set(key, now));
    else { running.forEach((_, key) => emitChunk(key, now)); running.clear(); }
    engaged = on;
  }
  setInterval(() => {
    const now = performance.now();
    if (engaged && now - lastInput > IDLE_AFTER_MS) { setEngaged(false); track('idle', { props: { after_s: IDLE_AFTER_MS / 1000 } }); return; }
    running.forEach((_, key) => { emitChunk(key, now); running.set(key, now); });
  }, TICK_MS);

  const onInput = () => {
    lastInput = performance.now();
    if (!engaged && document.visibilityState === 'visible') setEngaged(true);
  };
  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove', 'scroll'].forEach(t =>
    document.addEventListener(t, onInput, { capture: true, passive: true }));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      setEngaged(false); track('tab_hidden'); flush(true);
    } else { lastInput = performance.now(); setEngaged(true); track('tab_visible'); }
  });
  window.addEventListener('pagehide', () => { setEngaged(false); track('page_leave'); flush(true); });

  // ---------- Démarrage de session ----------
  const w = window.innerWidth;
  if (newSession) {
    track('session_start', { props: {
      visit_number: visitNumber, returning,
      referrer: document.referrer || null,
      utm_source: params.get('utm_source'), utm_medium: params.get('utm_medium'), utm_campaign: params.get('utm_campaign'),
      device: w < 700 ? 'mobile' : w < 1100 ? 'tablet' : 'desktop',
      viewport: w + 'x' + window.innerHeight,
      screen: screen.width + 'x' + screen.height,
      lang: navigator.language, tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ua: navigator.userAgent.slice(0, 300),
    } });
  } else {
    track('page_reload');
  }

  // ---------- Pages (landing <-> dashboard) ----------
  let page = null;
  function setPage(p) {
    if (p === page) return;
    if (page) { unwant('page', page, page); unwantKind('section', page); }
    page = p;
    track('page_view', { page: p });
    want('page', p, p);
    observeSections(p);
  }
  if (dashboardEl) new MutationObserver(() => setPage(currentPage()))
    .observe(dashboardEl, { attributes: true, attributeFilter: ['hidden'] });

  // ---------- Sections visibles ----------
  const scrollers = { landing: document.getElementById('app'), dashboard: document.getElementById('dashMain') };
  const sectionName = el => el.id || (el.className && String(el.className).split(' ')[0]) || el.tagName.toLowerCase();
  const sectionSelectors = {
    landing: '#app > * > section, #app > section, #app footer',
    dashboard: '#dashMain section[id], #dashMain .dash-bottom-grid > section:not([id])',
  };
  let sectionObserver = null;
  function observeSections(p) {
    if (sectionObserver) sectionObserver.disconnect();
    if (!('IntersectionObserver' in window)) return;
    const root = scrollers[p] || null;
    sectionObserver = new IntersectionObserver(entries => {
      entries.forEach(en => {
        const rootH = en.rootBounds ? en.rootBounds.height : window.innerHeight;
        const visible = en.isIntersecting && (en.intersectionRatio >= 0.5 || en.intersectionRect.height >= rootH * 0.5);
        const area = en.target.dataset.trackName;
        if (visible) want('section', p, area); else unwant('section', p, area);
      });
    }, { root, threshold: [0, 0.25, 0.5, 0.75, 1] });
    document.querySelectorAll(sectionSelectors[p]).forEach(el => {
      el.dataset.trackName = el.dataset.trackName || (el.id ? el.id : sectionName(el) === 'dash-panel' ? 'scenarioPanel' : sectionName(el));
      sectionObserver.observe(el);
    });
  }

  // ---------- Profondeur de scroll ----------
  const depthSeen = { landing: 0, dashboard: 0 };
  Object.entries(scrollers).forEach(([p, el]) => {
    if (!el) return;
    el.addEventListener('scroll', () => {
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;
      const pct = Math.round((el.scrollTop / max) * 100);
      [25, 50, 75, 100].forEach(m => {
        if (pct >= m - 1 && depthSeen[p] < m) { depthSeen[p] = m; track('scroll_depth', { page: p, target: m + '%', props: { depth: m } }); }
      });
    }, { passive: true });
  });

  // ---------- Clics ----------
  const INTERACTIVE = 'button, a, input, select, textarea, label, summary, [role="button"], [data-dash-target], [data-scroll], [data-access]';
  const labelOf = el => {
    const txt = (el.getAttribute('aria-label') || el.textContent || (el.tagName === 'INPUT' && /checkbox|radio/.test(el.type) ? (el.checked ? 'checked' : 'unchecked') : el.value) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return el.id ? (txt ? el.id + ' · ' + txt : el.id) : (txt || el.tagName.toLowerCase());
  };
  const areaOf = el => {
    const s = el.closest('[data-track-name], section[id], header, nav, aside, footer, .access-modal, .data-modal, .tour-pop');
    if (!s) return null;
    return s.dataset.trackName || s.id || sectionName(s);
  };
  let lastClick = { key: '', t: 0, n: 0 };
  let lastAccessSource = null;

  document.addEventListener('click', e => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const el = t.closest(INTERACTIVE);
    const now = performance.now();
    const key = el ? labelOf(el) : areaOf(t) + '/' + t.tagName;
    if (key === lastClick.key && now - lastClick.t < 800) lastClick.n++; else lastClick.n = 1;
    lastClick.key = key; lastClick.t = now;
    if (lastClick.n === 3) track('rage_click', { target: key, props: { area: areaOf(t) } });

    if (el) {
      const props = { area: areaOf(el), tag: el.tagName.toLowerCase() };
      if (el.dataset.dashTarget) props.nav_to = el.dataset.dashTarget;
      if (el.dataset.scroll) props.scroll_to = el.dataset.scroll;
      if (el.hasAttribute('data-access')) { props.cta = 'get_early_access'; lastAccessSource = props.area; }
      if (el.id === 'tourNext' || el.id === 'tourSkip') {
        const stepTxt = (document.getElementById('tourCount') || {}).textContent || '';
        const step = parseInt(stepTxt, 10) || null;
        props.step = step;
        if (el.id === 'tourSkip') track('tour_skip', { props: { step } });
        else if (/finish/i.test(el.textContent)) track('tour_complete', { props: { step } });
      }
      if (el.id === 'restartTour') track('tour_restart');
      if (el.id === 'addDataBtn' && !el.disabled) track('add_data_click');
      track('click', { target: labelOf(el), props });
    } else {
      // Clic sur un élément non cliquable (KPI, graphique…) : signal de curiosité ou de confusion.
      track('dead_click', { target: (t.closest('[class]') ? String(t.closest('[class]').className).split(' ')[0] : t.tagName.toLowerCase()), props: { area: areaOf(t) } });
    }
  }, true);

  // Clic sur un bouton désactivé (« Add my data » avant consentement).
  document.addEventListener('pointerdown', e => {
    const b = e.target instanceof Element ? e.target.closest('button[disabled]') : null;
    if (b) track('disabled_click', { target: labelOf(b), props: { area: areaOf(b) } });
  }, true);

  // Copier du texte = intérêt fort pour un contenu.
  document.addEventListener('copy', () => {
    const s = String(window.getSelection() || '').trim().slice(0, 150);
    if (s) track('copy_text', { target: s });
  });

  // ---------- Formulaire d'accès ----------
  const form = document.getElementById('accessForm');
  const touched = new Set();
  let submitted = false;
  if (form) {
    form.addEventListener('focusin', e => {
      const n = e.target && e.target.name; if (!n || touched.has(n)) return;
      touched.add(n); track('field_focus', { target: n });
    });
    form.addEventListener('change', e => {
      const f = e.target; if (!f || !f.name) return;
      track('field_change', { target: f.name, props: f.tagName === 'SELECT' ? { value: f.value } : { filled: !!f.value } });
    });
    form.addEventListener('invalid', e => track('form_invalid', { target: e.target.name }), true);
    form.addEventListener('submit', () => {
      submitted = true;
      const fd = new FormData(form);
      const v = k => String(fd.get(k) || '').trim().slice(0, 200);
      track('form_submit', { props: { email: v('email'), company: v('company'), role: v('role'), last_raise: v('raise'), source: lastAccessSource } });
      flush(false);
    }, true);
  }

  // ---------- Modales ----------
  function watchModal(id, name, onClose) {
    const m = document.getElementById(id); if (!m) return;
    let open = m.classList.contains('open');
    let openedAt = 0, openedOn = null;
    new MutationObserver(() => {
      const now = m.classList.contains('open');
      if (now === open) return;
      open = now;
      if (now) { openedAt = performance.now(); openedOn = currentPage(); track('modal_open', { page: openedOn, target: name, props: { source: name === 'access_form' ? lastAccessSource : null } }); want('modal', openedOn, name); }
      else { unwant('modal', openedOn, name); track('modal_close', { page: openedOn, target: name, duration_ms: performance.now() - openedAt }); if (onClose) onClose(); }
    }).observe(m, { attributes: true, attributeFilter: ['class'] });
  }
  watchModal('accessModal', 'access_form', () => {
    const filled = form ? [...form.elements].filter(f => f.name && f.value).map(f => f.name) : [];
    if (!submitted && filled.length) track('form_abandon', { props: { fields_filled: filled } });
    touched.clear(); submitted = false;
  });
  watchModal('dataModal', 'add_data_thanks');

  // ---------- Tour guidé ----------
  const pop = document.getElementById('tourPop');
  const countEl = document.getElementById('tourCount');
  let tourStepShown = null;
  function syncTour() {
    const on = pop && pop.classList.contains('on');
    const step = on ? parseInt((countEl && countEl.textContent) || '', 10) || null : null;
    if (step === tourStepShown) return;
    if (tourStepShown != null) unwant('tour_step', 'dashboard', 'step_' + tourStepShown);
    tourStepShown = step;
    if (step != null) {
      const title = (document.getElementById('tourTitle') || {}).textContent || '';
      track('tour_step', { target: 'step_' + step, props: { step, title } });
      want('tour_step', 'dashboard', 'step_' + step);
    }
  }
  if (pop) new MutationObserver(syncTour).observe(pop, { attributes: true, attributeFilter: ['class'] });
  if (countEl) new MutationObserver(syncTour).observe(countEl, { childList: true, characterData: true, subtree: true });

  // ---------- Consentement données ----------
  const consent = document.getElementById('dataConsent');
  if (consent) consent.addEventListener('change', () => track('consent_toggle', { props: { checked: consent.checked } }));

  setPage(currentPage());
})();

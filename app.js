'use strict';

/* ============================================================
   Pixel Market — Telegram Mini App для продажи цифровых товаров
   Моушен: сплэш, параллакс, FLIP-фильтрация, shared-element,
   «полёт» в корзину, пружинные шторки, конфетти.
   ============================================================ */

const tg = window.Telegram?.WebApp;
const inTG = Boolean(tg?.initData);
const tgv = (v) => inTG && tg.isVersionAtLeast(v);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const rootStyle = getComputedStyle(document.documentElement);
const SPRING = rootStyle.getPropertyValue('--spring').trim() || 'cubic-bezier(.34,1.4,.64,1)';
const BOUNCE = rootStyle.getPropertyValue('--bounce').trim() || 'cubic-bezier(.34,1.8,.64,1)';
const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';
const EASE_IN = 'cubic-bezier(.55,0,.75,.2)';

const CART_KEY = 'pixel-market-cart';

const CATEGORIES = [
  { id: 'all', label: 'Все', emoji: '✨' },
  { id: 'courses', label: 'Курсы', emoji: '🎓' },
  { id: 'software', label: 'Софт', emoji: '💻' },
  { id: 'design', label: 'Дизайн', emoji: '🎨' },
  { id: 'games', label: 'Игры', emoji: '🎮' },
  { id: 'books', label: 'Книги', emoji: '📚' },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

const PROMOS = [
  { title: 'Осенняя распродажа', text: 'До −40% на онлайн-курсы', emoji: '🍂', c1: '#f97316', c2: '#db2777', cat: 'courses' },
  { title: 'Новое для дизайнеров', text: 'Пресеты, иконки и шрифты', emoji: '🎨', c1: '#7c3aed', c2: '#06b6d4', cat: 'design' },
  { title: 'Оплата звёздами', text: 'Мгновенная выдача прямо в чат', emoji: '⭐', c1: '#eab308', c2: '#f97316', cat: 'all' },
];

const state = {
  products: [],
  byId: new Map(),
  category: 'all',
  query: '',
  cart: new Map(), // id -> qty
  view: 'home', // home | product | cart | success
  current: null, // товар, открытый в шторке
  busy: false,
};

/* ---------- утилиты ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = (n) => n.toLocaleString('ru-RU');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settled = (a) => a.finished.catch(() => {});

function anim(el, frames, opts = {}) {
  return el.animate(frames, reduceMotion ? { ...opts, duration: 0, delay: 0 } : opts);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const haptic = {
  tap: () => inTG && tg.HapticFeedback.impactOccurred('light'),
  medium: () => inTG && tg.HapticFeedback.impactOccurred('medium'),
  select: () => inTG && tg.HapticFeedback.selectionChanged(),
  ok: () => inTG && tg.HapticFeedback.notificationOccurred('success'),
  error: () => inTG && tg.HapticFeedback.notificationOccurred('error'),
};

/* ---------- тема ---------- */
function applyTheme() {
  const scheme = inTG ? tg.colorScheme : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = scheme;
  if (tgv('6.1')) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    tg.setHeaderColor(bg);
    tg.setBackgroundColor(bg);
    if (tgv('7.10')) tg.setBottomBarColor(bg);
  }
}

/* ---------- данные ---------- */
async function loadProducts() {
  const res = await fetch('products.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify([...state.cart])); } catch { /* приватный режим */ }
}

function restoreCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    for (const [id, qty] of saved) if (state.byId.has(id) && qty > 0) state.cart.set(id, Math.min(qty, 10));
  } catch { /* битые данные — начинаем с пустой корзины */ }
}

function cartTotals() {
  let count = 0, total = 0;
  for (const [id, qty] of state.cart) {
    count += qty;
    total += state.byId.get(id).price * qty;
  }
  return { count, total };
}

/* ---------- приветствие ---------- */
function greet() {
  const name = inTG ? tg.initDataUnsafe?.user?.first_name : '';
  $('#helloHint').textContent = name ? `Привет, ${name} 👋` : 'Привет 👋';
}

/* ---------- сплэш и вступление ---------- */
async function hideSplash() {
  const splash = $('#splash');
  const logo = $('.splash-logo', splash);
  anim(logo, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: 500, easing: EASE_IN, fill: 'forwards' });
  await settled(anim(splash, [{ opacity: 1 }, { opacity: 0 }], { duration: 450, delay: 120, easing: 'ease', fill: 'forwards' }));
  splash.remove();
}

function introAnimation() {
  $$('[data-intro]').forEach((el, i) => {
    anim(el, [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }],
      { duration: 700, delay: i * 90, easing: EASE_OUT, fill: 'backwards' });
  });
  anim($('.topbar-row'), [{ opacity: 0, transform: 'translateY(-12px)' }, { opacity: 1, transform: 'none' }],
    { duration: 600, easing: EASE_OUT, fill: 'backwards' });
}

/* ---------- шапка: прогресс скролла в --sp ---------- */
function setupScroll() {
  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      document.documentElement.style.setProperty('--sp', Math.min(1, scrollY / 110).toFixed(3));
    });
  }, { passive: true });
}

/* ---------- поиск ---------- */
function setupSearch() {
  const toggle = $('#searchToggle'), box = $('#search'), input = $('#searchInput');
  toggle.addEventListener('click', () => {
    const open = !box.classList.contains('open');
    box.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    haptic.tap();
    if (open) setTimeout(() => input.focus(), 150);
    else {
      input.value = '';
      input.blur();
      if (state.query) { state.query = ''; renderGrid(); }
    }
  });
  input.addEventListener('input', debounce(() => { state.query = input.value; renderGrid(); }, 180));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
}

/* ---------- промо-карусель с параллаксом ---------- */
function renderPromos() {
  const track = $('#promoTrack'), dots = $('#promoDots');
  track.innerHTML = PROMOS.map((p) => `
    <button class="promo" data-cat="${p.cat}" style="--c1:${p.c1};--c2:${p.c2}">
      <i class="promo-ring"></i><i class="promo-ring r2"></i>
      <div class="promo-text"><b>${esc(p.title)}</b><span>${esc(p.text)}</span></div>
      <div class="promo-emoji">${p.emoji}</div>
    </button>`).join('');
  dots.innerHTML = PROMOS.map(() => '<i></i>').join('');

  const slides = $$('.promo', track), dotEls = $$('i', dots);
  let index = 0, ticking = false, pausedUntil = 0;

  const update = () => {
    ticking = false;
    const step = slides.length > 1 ? slides[1].offsetLeft - slides[0].offsetLeft : 1;
    let best = Infinity;
    slides.forEach((s, i) => {
      const o = (s.offsetLeft - slides[0].offsetLeft - track.scrollLeft) / step;
      s.style.setProperty('--o', o.toFixed(3));
      s.style.setProperty('--ao', Math.min(1, Math.abs(o)).toFixed(3));
      if (Math.abs(o) < best) { best = Math.abs(o); index = i; }
    });
    dotEls.forEach((d, i) => d.classList.toggle('on', i === index));
  };

  track.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  track.addEventListener('pointerdown', () => { pausedUntil = Date.now() + 8000; });
  track.addEventListener('click', (e) => {
    const promo = e.target.closest('.promo');
    if (!promo) return;
    haptic.tap();
    setCategory(promo.dataset.cat);
    $('#chips').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  });
  update();

  if (!reduceMotion) {
    setInterval(() => {
      if (Date.now() < pausedUntil || document.hidden || state.view !== 'home') return;
      const next = slides[(index + 1) % slides.length];
      track.scrollTo({ left: next.offsetLeft - slides[0].offsetLeft, behavior: 'smooth' });
    }, 4500);
  }
}

/* ---------- категории со «скользящей» подложкой ---------- */
function renderChips() {
  const wrap = $('#chips');
  wrap.insertAdjacentHTML('beforeend', CATEGORIES.map((c) =>
    `<button class="chip" data-cat="${c.id}"><span>${c.emoji}</span>${esc(c.label)}</button>`).join(''));
  wrap.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) setCategory(chip.dataset.cat);
  });
  moveChipIndicator(false);
  document.fonts?.ready.then(() => moveChipIndicator(false));
  addEventListener('resize', () => moveChipIndicator(false));
}

function moveChipIndicator(animated = true) {
  const active = $(`.chip[data-cat="${state.category}"]`);
  $$('.chip').forEach((c) => c.classList.toggle('active', c === active));
  const ind = $('#chipInd');
  ind.style.transition = animated ? '' : 'none';
  ind.style.width = `${active.offsetWidth}px`;
  ind.style.transform = `translateX(${active.offsetLeft}px)`;
  if (!animated) void ind.offsetWidth; // зафиксировать позицию без анимации
}

function setCategory(cat) {
  if (cat === state.category) return;
  state.category = cat;
  haptic.select();
  moveChipIndicator();
  $(`.chip[data-cat="${cat}"]`).scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
  renderGrid();
}

/* ---------- сетка товаров: FLIP при фильтрации ---------- */
function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.products.filter((p) =>
    (state.category === 'all' || p.cat === state.category) &&
    (!q || `${p.title} ${p.subtitle}`.toLowerCase().includes(q)));
}

function createCard(p) {
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.id = p.id;
  el.tabIndex = 0;
  el.setAttribute('aria-label', `${p.title}, ${p.price} звёзд`);
  el.style.setProperty('--c1', p.c1);
  el.style.setProperty('--c2', p.c2);
  el.style.setProperty('--d', `${(-Math.random() * 4).toFixed(2)}s`);
  el.innerHTML = `
    <div class="card-inner">
      <div class="card-art">
        <span class="card-emoji">${p.emoji}</span>
        ${p.tag ? `<span class="card-tag">${esc(p.tag)}</span>` : ''}
      </div>
      <div class="card-body">
        <h3>${esc(p.title)}</h3>
        <p>${esc(p.subtitle)}</p>
        <div class="card-foot">
          <div class="price"><b>⭐ ${fmt(p.price)}</b>${p.old ? `<s>${fmt(p.old)}</s>` : ''}</div>
          <button class="add-btn" aria-label="Добавить в корзину">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
      </div>
    </div>`;
  return el;
}

function renderGrid({ initial = false } = {}) {
  const grid = $('#grid');
  const list = filtered();
  const ids = new Set(list.map((p) => p.id));
  const gridRect = grid.getBoundingClientRect();

  // First: запоминаем положение текущих карточек
  const nodes = new Map(), first = new Map();
  $$('.card:not(.leaving)', grid).forEach((el) => {
    nodes.set(el.dataset.id, el);
    first.set(el.dataset.id, el.getBoundingClientRect());
  });

  // Уходящие карточки вынимаем из потока и растворяем на месте
  nodes.forEach((el, id) => {
    if (ids.has(id)) return;
    const r = first.get(id);
    el.classList.add('leaving');
    Object.assign(el.style, {
      position: 'absolute', left: `${r.left - gridRect.left}px`, top: `${r.top - gridRect.top}px`,
      width: `${r.width}px`, height: `${r.height}px`,
    });
    settled(anim(el, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.82)' }],
      { duration: 240, easing: EASE_IN, fill: 'forwards' })).then(() => el.remove());
    nodes.delete(id);
  });

  // Last: новый порядок
  list.forEach((p) => {
    if (!nodes.has(p.id)) nodes.set(p.id, createCard(p));
    grid.append(nodes.get(p.id));
  });

  // Invert + Play
  let enterIndex = 0;
  list.forEach((p) => {
    const el = nodes.get(p.id);
    const from = first.get(p.id);
    if (from) {
      const to = el.getBoundingClientRect();
      const dx = from.left - to.left, dy = from.top - to.top;
      if (dx || dy) anim(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 600, easing: SPRING });
    } else {
      anim(el, [{ opacity: 0, transform: 'translateY(30px) scale(.9)' }, { opacity: 1, transform: 'none' }],
        { duration: 650, delay: (initial ? 250 : 140) + enterIndex++ * 60, easing: EASE_OUT, fill: 'backwards' });
    }
  });

  const empty = $('#empty');
  if (!list.length && empty.hidden) {
    empty.hidden = false;
    anim(empty, [{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: 150, easing: SPRING, fill: 'backwards' });
  } else if (list.length) {
    empty.hidden = true;
  }
}

function setupGrid() {
  const grid = $('#grid');
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card || card.classList.contains('leaving')) return;
    const add = e.target.closest('.add-btn');
    if (add) addToCart(card.dataset.id, add);
    else openProduct(card.dataset.id);
  });
  grid.addEventListener('keydown', (e) => {
    const card = e.target.closest('.card');
    if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openProduct(card.dataset.id);
    }
  });

  // 3D-наклон карточки за курсором (только мышь)
  if (reduceMotion || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  grid.addEventListener('pointermove', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const inner = card.firstElementChild.style;
    inner.setProperty('--rx', `${((0.5 - y) * 10).toFixed(2)}deg`);
    inner.setProperty('--ry', `${((x - 0.5) * 12).toFixed(2)}deg`);
    inner.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    inner.setProperty('--my', `${(y * 100).toFixed(1)}%`);
  });
  grid.addEventListener('pointerout', (e) => {
    const card = e.target.closest('.card');
    if (!card || card.contains(e.relatedTarget)) return;
    const inner = card.firstElementChild.style;
    inner.removeProperty('--rx');
    inner.removeProperty('--ry');
  });
}

/* ---------- шторки ---------- */
let openSheetEl = null;

function openSheet(sheet, view, { fromEl, toEl } = {}) {
  if (openSheetEl) closeSheet({ instant: true });
  openSheetEl = sheet;
  state.view = view;

  const overlay = $('#overlay');
  overlay.hidden = false;
  sheet.hidden = false;
  sheet.scrollTop = 0;
  document.body.classList.add('locked');

  // Конечная позиция цели shared-element — измеряем до запуска анимации шторки
  const toRect = fromEl && toEl ? toEl.getBoundingClientRect() : null;

  anim(overlay, [{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'linear' });
  anim(sheet, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 600, easing: EASE_OUT });
  $$('[data-stagger]', sheet).forEach((el, i) => {
    anim(el, [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }],
      { duration: 550, delay: 170 + i * 55, easing: EASE_OUT, fill: 'backwards' });
  });
  if (toRect) sharedElement(fromEl, toEl, toRect);

  syncTelegram();
  sheet.tabIndex = -1;
  sheet.focus({ preventScroll: true });
}

function closeSheet({ fromY = 0, instant = false } = {}) {
  const sheet = openSheetEl;
  if (!sheet) return Promise.resolve();
  openSheetEl = null;
  state.view = 'home';
  syncTelegram();

  const overlay = $('#overlay');
  const finish = () => {
    if (openSheetEl !== sheet) sheet.hidden = true;
    sheet.style.transform = '';
    sheet.getAnimations().forEach((a) => a.cancel());
    if (!openSheetEl) {
      overlay.hidden = true;
      overlay.style.opacity = '';
      overlay.getAnimations().forEach((a) => a.cancel());
      document.body.classList.remove('locked');
    }
  };
  if (instant) { finish(); return Promise.resolve(); }

  const fromOpacity = getComputedStyle(overlay).opacity;
  anim(overlay, [{ opacity: fromOpacity }, { opacity: 0 }], { duration: 320, easing: 'linear', fill: 'forwards' });
  return settled(anim(sheet, [{ transform: `translateY(${fromY}px)` }, { transform: 'translateY(100%)' }],
    { duration: 380, easing: EASE_IN, fill: 'forwards' })).then(finish);
}

// Свайп вниз за «ручку» закрывает шторку
function enableDrag(sheet) {
  let startY = 0, dy = 0, t0 = 0, dragging = false;
  const overlay = $('#overlay');

  sheet.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('[data-drag]')) return;
    dragging = true;
    startY = e.clientY;
    dy = 0;
    t0 = performance.now();
    sheet.setPointerCapture(e.pointerId);
  });
  sheet.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const raw = e.clientY - startY;
    dy = raw > 0 ? raw : raw / 6; // вверх — с сопротивлением
    sheet.style.transform = `translateY(${dy}px)`;
    overlay.style.opacity = String(Math.max(0, 1 - dy / 500));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    const velocity = dy / Math.max(1, performance.now() - t0);
    if (dy > 120 || (dy > 30 && velocity > 0.5)) {
      haptic.tap();
      closeSheet({ fromY: dy });
    } else {
      sheet.style.transform = '';
      overlay.style.opacity = '';
      anim(sheet, [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 500, easing: SPRING });
    }
  };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
}

// Карточка «перелетает» в шапку шторки
function sharedElement(fromEl, toEl, to) {
  const from = fromEl.getBoundingClientRect();
  const clone = fromEl.cloneNode(true);
  clone.classList.add('flying');
  clone.style.setProperty('--c1', getComputedStyle(fromEl).getPropertyValue('--c1'));
  clone.style.setProperty('--c2', getComputedStyle(fromEl).getPropertyValue('--c2'));
  document.body.append(clone);
  toEl.style.visibility = 'hidden';
  fromEl.style.visibility = 'hidden';

  const box = (r, radius) => ({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: radius });
  const flight = anim(clone, [box(from, '18px'), box(to, '24px')], { duration: 600, easing: EASE_OUT, fill: 'forwards' });
  const emoji = clone.querySelector('.card-emoji');
  if (emoji) anim(emoji, [{ transform: 'scale(1)' }, { transform: 'scale(2.1)' }], { duration: 600, easing: EASE_OUT, fill: 'forwards' });

  settled(flight).then(() => {
    toEl.style.visibility = '';
    fromEl.style.visibility = '';
    clone.remove();
  });
}

/* ---------- карточка товара ---------- */
function openProduct(id) {
  const p = state.byId.get(id);
  if (!p) return;
  state.current = p;
  haptic.tap();

  const sheet = $('#productSheet');
  const art = $('#psArt');
  art.style.setProperty('--c1', p.c1);
  art.style.setProperty('--c2', p.c2);
  $('#psEmoji').textContent = p.emoji;
  $('#psCat').textContent = CATEGORY_LABEL[p.cat] || 'Товар';
  $('#psRating').innerHTML = `<b>★ ${p.rating}</b> · ${fmt(p.sales)} покупок`;
  $('#psTitle').textContent = p.title;
  $('#psDesc').textContent = p.desc;
  $('#psFeatures').innerHTML = p.features.map((f) => `<li data-stagger>${esc(f)}</li>`).join('');
  $('#psPrice').innerHTML = `<b>⭐ ${fmt(p.price)}</b>${p.old ? `<s>${fmt(p.old)}</s>` : ''}`;

  const card = $(`.card[data-id="${CSS.escape(id)}"]:not(.leaving)`);
  openSheet(sheet, 'product', { fromEl: card?.querySelector('.card-art'), toEl: art });
}

/* ---------- корзина ---------- */
function addToCart(id, sourceEl) {
  const p = state.byId.get(id);
  const qty = state.cart.get(id) || 0;
  if (qty >= 10) { haptic.error(); toast('Максимум 10 шт. одного товара'); return; }
  state.cart.set(id, qty + 1);
  saveCart();
  haptic.medium();
  syncTelegram();
  flyToCart(sourceEl, p.emoji).then(() => {
    updateCartUI();
    bumpCart();
  });
}

function flyToCart(sourceEl, emoji) {
  const a = sourceEl.getBoundingClientRect(), b = $('#cartBtn').getBoundingClientRect();
  const sx = a.left + a.width / 2, sy = a.top + a.height / 2;
  const ex = b.left + b.width / 2, ey = b.top + b.height / 2;
  // Контрольная точка кривой Безье — над стартом, чтобы траектория шла «дугой»
  const cx = sx + (ex - sx) * 0.15, cy = Math.max(-20, ey + (sy - ey) * 0.1);

  const dot = document.createElement('div');
  dot.className = 'fly';
  dot.textContent = emoji;
  document.body.append(dot);

  const N = 18, frames = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    const x = u * u * sx + 2 * u * t * cx + t * t * ex;
    const y = u * u * sy + 2 * u * t * cy + t * t * ey;
    const s = t < 0.15 ? 0.4 + (t / 0.15) * 0.9 : 1.3 - ((t - 0.15) / 0.85) * 0.9;
    frames.push({ transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s.toFixed(3)}) rotate(${Math.round(t * 240)}deg)`, opacity: t > 0.9 ? 0.4 : 1 });
  }
  return settled(anim(dot, frames, { duration: 820, easing: 'cubic-bezier(.45,0,.4,1)' })).then(() => dot.remove());
}

function bumpCart() {
  const btn = $('#cartBtn');
  anim(btn, [
    { transform: 'scale(1)' }, { transform: 'scale(1.28) rotate(-10deg)' },
    { transform: 'scale(.94) rotate(4deg)' }, { transform: 'scale(1)' },
  ], { duration: 550, easing: 'ease-out' });
  const ring = document.createElement('span');
  ring.className = 'cart-ring';
  btn.append(ring);
  settled(anim(ring, [{ transform: 'scale(1)', opacity: 0.9 }, { transform: 'scale(1.9)', opacity: 0 }], { duration: 650, easing: EASE_OUT }))
    .then(() => ring.remove());
}

function countTo(el, to, duration = 650) {
  const from = Number(el.dataset.value || 0);
  el.dataset.value = String(to);
  cancelAnimationFrame(el._raf);
  if (reduceMotion || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / duration);
    const e = 1 - (1 - t) ** 3;
    el.textContent = fmt(Math.round(from + (to - from) * e));
    if (t < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

function updateCartUI() {
  const { count, total } = cartTotals();

  const badge = $('#cartBadge');
  if (count) {
    const wasHidden = badge.hidden;
    badge.hidden = false;
    if (badge.textContent !== String(count) || wasHidden) {
      badge.textContent = count;
      anim(badge, wasHidden
        ? [{ transform: 'scale(0)' }, { transform: 'scale(1)' }]
        : [{ transform: 'translateY(-70%) scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 550, easing: BOUNCE });
    }
  } else {
    badge.hidden = true;
  }

  const bar = $('#checkoutBar');
  $('[data-count]', bar).textContent = count;
  countTo($('[data-total]', bar), total);
  countTo($('#cartTotal'), total);
  $('#payBtn').disabled = count === 0;

  syncTelegram();
}

function cartRowHTML(p, qty) {
  return `
    <li class="cart-row" data-id="${p.id}" data-stagger>
      <div class="cart-thumb" style="--c1:${p.c1};--c2:${p.c2}">${p.emoji}</div>
      <div class="cart-info"><b>${esc(p.title)}</b><span>⭐ ${fmt(p.price)}</span></div>
      <div class="stepper">
        <button data-act="dec" aria-label="Меньше">−</button>
        <span class="qty">${qty}</span>
        <button data-act="inc" aria-label="Больше">+</button>
      </div>
    </li>`;
}

function renderCart() {
  const list = $('#cartList');
  list.innerHTML = [...state.cart].map(([id, qty]) => cartRowHTML(state.byId.get(id), qty)).join('');
  $('#cartEmpty').hidden = state.cart.size > 0;
  $('#cartClear').hidden = state.cart.size === 0;
}

function openCart() {
  renderCart();
  updateCartUI();
  haptic.tap();
  openSheet($('#cartSheet'), 'cart');
}

function removeRow(row) {
  const h = row.offsetHeight;
  return settled(anim(row, [
    { height: `${h}px`, opacity: 1, transform: 'none' },
    { height: `${h}px`, opacity: 0, transform: 'translateX(-40%)', offset: 0.5 },
    { height: '0px', opacity: 0, transform: 'translateX(-40%)', paddingTop: '0px', paddingBottom: '0px', borderBottomWidth: '0px' },
  ], { duration: 420, easing: EASE_OUT, fill: 'forwards' })).then(() => row.remove());
}

function showCartEmpty() {
  const empty = $('#cartEmpty');
  if (!empty.hidden) return;
  empty.hidden = false;
  $('#cartClear').hidden = true;
  anim(empty, [{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 500, easing: SPRING });
}

function changeQty(row, delta) {
  const id = row.dataset.id;
  const qty = (state.cart.get(id) || 0) + delta;
  if (qty > 10) { haptic.error(); return; }
  haptic.select();
  if (qty <= 0) {
    state.cart.delete(id);
    removeRow(row).then(() => { if (!state.cart.size) showCartEmpty(); });
  } else {
    state.cart.set(id, qty);
    const q = $('.qty', row);
    q.textContent = qty;
    anim(q, [{ transform: `translateY(${delta > 0 ? -12 : 12}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: SPRING });
  }
  saveCart();
  updateCartUI();
}

function clearCart() {
  haptic.medium();
  state.cart.clear();
  saveCart();
  updateCartUI();
  const rows = $$('.cart-row');
  Promise.all(rows.map((row, i) => sleep(i * 50).then(() => removeRow(row)))).then(showCartEmpty);
}

/* ---------- оплата ---------- */
function setPayLoading(on) {
  $('#payBtn').classList.toggle('loading', on);
  if (inTG) on ? tg.MainButton.showProgress(false) : tg.MainButton.hideProgress();
}

async function checkout() {
  if (state.busy || !state.cart.size) return;
  state.busy = true;
  setPayLoading(true);
  const items = [...state.cart].map(([id, qty]) => ({ id, qty }));
  try {
    if (inTG) {
      const res = await fetch('api/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: tg.initData, items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.link) throw new Error(data.error || `HTTP ${res.status}`);
      tg.openInvoice(data.link, (status) => {
        if (status === 'paid') onPaid();
        else if (status === 'failed') { haptic.error(); toast('Оплата не прошла'); }
      });
    } else {
      // Демо-режим в обычном браузере: имитируем успешную оплату
      await sleep(1100);
      onPaid();
    }
  } catch (err) {
    console.error(err);
    haptic.error();
    toast('Не удалось создать счёт. Попробуйте ещё раз');
  } finally {
    state.busy = false;
    setPayLoading(false);
  }
}

async function onPaid() {
  state.cart.clear();
  saveCart();
  await closeSheet();
  updateCartUI();
  showSuccess();
}

function showSuccess() {
  const box = $('#success');
  box.hidden = false;
  state.view = 'success';
  syncTelegram();
  haptic.ok();

  anim(box, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
  anim($('.success-check', box), [{ transform: 'scale(.4)' }, { transform: 'scale(1)' }], { duration: 700, easing: BOUNCE });
  anim($('.sc-ring', box), [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 650, delay: 100, easing: EASE_OUT, fill: 'both' });
  anim($('.sc-tick', box), [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 420, delay: 550, easing: EASE_OUT, fill: 'both' });
  $$('[data-s]', box).forEach((el, i) => anim(el, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }],
    { duration: 550, delay: 650 + i * 90, easing: EASE_OUT, fill: 'backwards' }));
  confetti();
}

async function hideSuccess() {
  const box = $('#success');
  await settled(anim(box, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.04)' }], { duration: 300, easing: EASE_IN }));
  box.hidden = true;
  box.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  state.view = 'home';
  updateCartUI();
}

function confetti() {
  if (reduceMotion) return;
  const canvas = $('#confetti');
  const ctx = canvas.getContext('2d');
  const dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvas.hidden = false;

  const colors = ['#8b5cf6', '#22d3ee', '#facc15', '#f472b6', '#34d399', '#fb923c'];
  const parts = Array.from({ length: 150 }, () => ({
    x: W / 2, y: H * 0.38,
    vx: (Math.random() - 0.5) * 15, vy: -Math.random() * 15 - 4,
    size: Math.random() * 7 + 4, rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.35,
    color: colors[(Math.random() * colors.length) | 0], rect: Math.random() < 0.6,
  }));
  const LIFE = 2800, t0 = performance.now();
  let last = t0;

  const frame = (now) => {
    const t = now - t0, k = Math.min(3, (now - last) / 16.7);
    last = now;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = Math.max(0, 1 - t / LIFE);
    for (const p of parts) {
      p.vy += 0.38 * k;
      p.vx *= 0.99 ** k;
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.rot += p.vr * k;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.rect) ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2.6, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    if (t < LIFE) requestAnimationFrame(frame);
    else canvas.hidden = true;
  };
  requestAnimationFrame(frame);
}

/* ---------- тост ---------- */
let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.getAnimations().forEach((a) => a.cancel());
  el.textContent = message;
  el.hidden = false;
  anim(el, [{ transform: 'translate(-50%, -150%)', opacity: 0 }, { transform: 'translate(-50%, 0)', opacity: 1 }], { duration: 500, easing: SPRING });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    settled(anim(el, [{ transform: 'translate(-50%, 0)', opacity: 1 }, { transform: 'translate(-50%, -150%)', opacity: 0 }],
      { duration: 300, easing: EASE_IN, fill: 'forwards' })).then(() => { el.hidden = true; });
  }, 2600);
}

/* ---------- кнопки Telegram ---------- */
function syncTelegram() {
  $('#checkoutBar').classList.toggle('show', state.cart.size > 0 && state.view === 'home');
  if (!inTG) return;
  const mb = tg.MainButton;
  const { count, total } = cartTotals();
  if (state.view === 'product' && state.current) {
    mb.setParams({ text: `В корзину · ⭐ ${fmt(state.current.price)}`, is_visible: true, is_active: true });
  } else if (state.view === 'cart' && count) {
    mb.setParams({ text: `Оплатить · ⭐ ${fmt(total)}`, is_visible: true, is_active: true });
  } else if (state.view === 'home' && count) {
    mb.setParams({ text: `Корзина · ${count} шт. · ⭐ ${fmt(total)}`, is_visible: true, is_active: true });
  } else {
    mb.hide();
  }
  if (tgv('6.1')) state.view === 'home' ? tg.BackButton.hide() : tg.BackButton.show();
}

function addFromSheet() {
  if (!state.current) return;
  addToCart(state.current.id, $('#psArt'));
  closeSheet();
}

function onMainButton() {
  if (state.view === 'product') addFromSheet();
  else if (state.view === 'cart') checkout();
  else if (state.view === 'home') openCart();
}

function onBack() {
  if (state.view === 'success') hideSuccess();
  else closeSheet();
}

/* ---------- запуск ---------- */
function bindEvents() {
  $('#cartBtn').addEventListener('click', openCart);
  $('#checkoutBarBtn').addEventListener('click', openCart);
  $('#overlay').addEventListener('click', () => closeSheet());
  $('#psAdd').addEventListener('click', addFromSheet);
  $('#payBtn').addEventListener('click', checkout);
  $('#cartClear').addEventListener('click', clearCart);
  $('#successOk').addEventListener('click', hideSuccess);
  $('#cartList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) changeQty(btn.closest('.cart-row'), btn.dataset.act === 'inc' ? 1 : -1);
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') onBack(); });
  enableDrag($('#productSheet'));
  enableDrag($('#cartSheet'));
}

async function init() {
  if (inTG) {
    document.body.classList.add('tg');
    tg.ready();
    tg.expand();
    if (tgv('7.7')) tg.disableVerticalSwipes(); // иначе свайп шторки закрывает само приложение
    tg.onEvent('themeChanged', applyTheme);
    tg.MainButton.onClick(onMainButton);
    if (tgv('6.1')) tg.BackButton.onClick(onBack);
  }
  applyTheme();
  greet();
  renderChips();
  renderPromos();
  bindEvents();
  setupSearch();
  setupScroll();
  setupGrid();

  const minSplash = sleep(reduceMotion ? 0 : 1100);
  try {
    state.products = await loadProducts();
  } catch (err) {
    console.error('Каталог не загрузился:', err);
  }
  state.byId = new Map(state.products.map((p) => [p.id, p]));
  restoreCart();

  await minSplash;
  await hideSplash();
  introAnimation();
  renderGrid({ initial: true });
  updateCartUI();
  if (!state.products.length) toast('Не удалось загрузить каталог');
}

init();

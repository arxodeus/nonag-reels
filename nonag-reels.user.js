// ==UserScript==
// @name         nonag-reels
// @namespace    https://github.com/arxodeus/nonag-reels
// @version      1.0.0
// @updateURL    https://raw.githubusercontent.com/arxodeus/nonag-reels/main/nonag-reels.user.js
// @downloadURL  https://raw.githubusercontent.com/arxodeus/nonag-reels/main/nonag-reels.user.js
// @match        *://*.instagram.com/*
// @match        *://instagram.com/*
// @run-at       document-idle
// @license      EUPL-1.2+
// ==/UserScript==

// no ampersands, angle brackets, carets, asterisks, backslashes or backticks

function hide(el) {
  el.style.setProperty('display', 'none', 'important');
}

function between(x, lo, hi) {
  return Math.min(Math.max(x, lo), hi) === x;
}

function isLarge(el) {
  return Math.max(el.getBoundingClientRect().width, 200) !== 200;
}

function load(key, fallback) {
  try {
    const v = sessionStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    return fallback;
  }
}

function save(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}

// profiles link reels as /user/reel/ID/; exact skips links below the post
function mediaId(path, exact) {
  const p = path.split('?')[0].split('/');
  for (const i of [1, 2]) {
    if (['reel', 'reels', 'p'].indexOf(p[i]) === -1) continue;
    if (!p[i + 1]) continue;
    // /reels/audio/ID/ is a sound page, not a reel
    if (p[i + 1] === 'audio') continue;
    if (exact) {
      if (p[i + 2]) continue;
    }
    return p[i + 1];
  }
  return null;
}

// instagram drops ?l=1 after loading, so don't redirect the same reel in a loop
function mayRedirect(id) {
  const last = load('nonagRedirect', {});
  if (last.id === id) {
    if (between(Date.now() - last.t, 0, 10000)) return false;
  }
  save('nonagRedirect', { id: id, t: Date.now() });
  return true;
}

// redirect to ?l=1, which is what "Continue on web" links to
const id = mediaId(location.pathname, false);
let redirecting = false;

if (id) {
  if (location.search.indexOf('l=1') === -1) {
    if (mayRedirect(id)) {
      redirecting = true;
      location.replace('https://www.instagram.com/reel/' + id + '/?l=1');
    }
  }
}

if (!redirecting) {
  // the "... more" span inside the caption
  function isMoreSpan(s) {
    const t = s.textContent.trim().toLowerCase();
    if (t.slice(-4) !== 'more') return false;
    return Math.max(t.length, 8) === 8;
  }

  function findCaption() {
    const open = document.querySelector('.nonag-open');
    if (open) return { cap: open, more: null };
    for (const s of document.querySelectorAll('[role=button] span')) {
      if (isMoreSpan(s)) return { cap: s.closest('[role=button]'), more: s };
    }
    return null;
  }

  // logged out, an invisible layer over the caption turns taps into an
  // "open the app" prompt, so catch taps on the caption first
  function hitsCaption(e) {
    const found = findCaption();
    if (!found) return null;
    let pt = e;
    if (e.changedTouches) {
      if (e.changedTouches.length) pt = e.changedTouches[0];
    }
    if (typeof pt.clientX !== 'number') return null;
    const r = found.cap.getBoundingClientRect();
    if (!between(pt.clientX, r.left, r.right)) return null;
    if (!between(pt.clientY, r.top, r.bottom)) return null;
    return found;
  }

  function expand(found) {
    const cap = found.cap;
    const more = found.more;
    if (!more) return;
    hide(more);
    cap.classList.add('nonag-open');

    // the first row is a hidden measuring copy of the text; drop it
    const inner = cap.firstElementChild;
    if (inner) {
      if (inner.children.length === 2) hide(inner.children[0]);
    }

    // let the caption wrap onto several lines instead of one cut-off line
    for (const el of [cap].concat(Array.from(cap.querySelectorAll('div, span')))) {
      el.style.setProperty('white-space', 'pre-wrap', 'important');
      el.style.setProperty('overflow', 'visible', 'important');
      el.style.setProperty('text-overflow', 'clip', 'important');
    }

    cap.style.setProperty('height', 'auto', 'important');
    for (const d of cap.querySelectorAll('div')) d.style.setProperty('height', 'auto', 'important');
    let x = cap.parentElement;
    while (x) {
      if (x.getAttribute('role') === 'group') break;
      if (Math.max(x.getBoundingClientRect().height, 150) === 150) {
        x.style.setProperty('height', 'auto', 'important');
        x.style.setProperty('max-height', 'none', 'important');
      }
      x = x.parentElement;
    }
  }

  function blockTap(e) {
    if (hitsCaption(e)) e.stopImmediatePropagation();
  }

  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'touchstart', 'touchend']) {
    window.addEventListener(type, blockTap, true);
  }

  function inside(el, e) {
    const r = el.getBoundingClientRect();
    if (!between(e.clientX, r.left, r.right)) return false;
    return between(e.clientY, r.top, r.bottom);
  }

  // tapping a post photo opens the app too
  function onPhoto(e) {
    if (!e.target.closest) return false;
    if (e.target.closest('a, button, [role=button]')) return false;
    for (const v of document.querySelectorAll('video')) {
      if (inside(v, e)) return false;
    }
    for (const img of document.querySelectorAll('img')) {
      if (!isLarge(img)) continue;
      if (inside(img, e)) return true;
    }
    return false;
  }

  function onClick(e) {
    if (onPhoto(e)) {
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    const hit = hitsCaption(e);
    if (!hit) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    expand(hit);
  }

  window.addEventListener('click', onClick, true);

  const nagPhrases = ['sign up to keep watching', 'sign up to see', 'log in to continue', 'never miss a post'];
  const cookieButtons = ['decline optional cookies', 'only allow essential cookies'];

  function isNag(text) {
    const t = text.toLowerCase();
    for (const p of nagPhrases) {
      if (t.indexOf(p) !== -1) return true;
    }
    return false;
  }

  const nagLinks = ['/accounts/login', '/accounts/signup', '/accounts/emailsignup', 'intent'];

  function isNagLink(a) {
    const href = a.getAttribute('href') || '';
    for (const p of nagLinks) {
      if (href.indexOf(p) === 0) return true;
    }
    return false;
  }

  function clean() {
    for (const a of document.querySelectorAll('a')) {
      if (isNagLink(a)) hide(a);
    }

    for (const b of document.querySelectorAll('button, [role=button]')) {
      if (b.dataset.nonag) continue;
      if (cookieButtons.indexOf(b.textContent.trim().toLowerCase()) === -1) continue;
      b.dataset.nonag = '1';
      b.click();
    }

    for (const el of document.querySelectorAll('h1, h2, h3, span')) {
      if (el.childElementCount) continue;
      if (!isNag(el.textContent)) continue;
      let box = el;
      while (box) {
        const pos = getComputedStyle(box).position;
        if (pos === 'absolute' || pos === 'fixed') break;
        box = box.parentElement;
      }
      if (!box) continue;
      if (box.querySelector('video')) continue;
      if (box.style.display !== 'none') box.style.display = 'none';
    }
  }

  // instagram pauses at the end to show the overlay; restart from the top
  function keepPlaying() {
    for (const v of document.querySelectorAll('video')) {
      if (!v.paused) continue;
      if (!v.duration) continue;
      if (Math.max(v.currentTime, v.duration - 0.3) !== v.currentTime) continue;
      v.currentTime = 0;
      v.play().catch(function () {});
    }
  }

  // swiping walks the "more posts from" grid, which only the desktop page has
  const seen = load('nonagSeen', []);
  if (id) {
    if (seen.indexOf(id) === -1) seen.push(id);
    save('nonagSeen', seen.slice(-500));
  }
  let queue = id ? load('nonagNext' + id, []) : [];
  let navigating = false;

  function collectRelated() {
    if (!id) return;
    if (queue.length) return;
    const found = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const other = mediaId(a.getAttribute('href'), true);
      if (!other) continue;
      if (other === id) continue;
      if (found.indexOf(other) !== -1) continue;
      found.push(other);
    }
    if (!found.length) return;
    queue = found;
    save('nonagNext' + id, queue);
  }

  function goNext() {
    if (navigating) return;
    for (const other of queue) {
      if (seen.indexOf(other) !== -1) continue;
      navigating = true;
      const back = load('nonagBack', []);
      back.push(id);
      save('nonagBack', back.slice(-200));
      location.href = '/reel/' + other + '/?l=1';
      return;
    }
  }

  function goBack() {
    if (navigating) return;
    const back = load('nonagBack', []);
    const prev = back.pop();
    if (!prev) return;
    navigating = true;
    save('nonagBack', back);
    location.href = '/reel/' + prev + '/?l=1';
  }

  // the grid thumbnails are links, so this only matches the post itself
  function overPost(e) {
    for (const el of document.querySelectorAll('video, img')) {
      if (el.closest('a')) continue;
      if (!isLarge(el)) continue;
      if (inside(el, e)) return true;
    }
    return false;
  }

  let wheelSum = 0;
  let wheelTimer = 0;

  // only over the post, so the page and comments still scroll
  function onWheel(e) {
    if (!queue.length) return;
    if (!overPost(e)) return;
    e.preventDefault();
    wheelSum = wheelSum + e.deltaY;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(function () { wheelSum = 0; }, 300);
    if (Math.max(wheelSum, 120) !== 120) goNext();
    if (Math.max(0 - wheelSum, 120) !== 120) goBack();
  }

  function onKey(e) {
    if (!queue.length) return;
    const t = e.target;
    if (t.isContentEditable) return;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      goNext();
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      goBack();
    }
  }

  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('keydown', onKey, true);

  const barHeight = 14;
  const bars = new Map();

  function makeBar(v) {
    const bar = document.createElement('div');
    bar.style.cssText = 'position: fixed; z-index: 2147483647; height: ' + barHeight + 'px; cursor: pointer; touch-action: none; display: none;';
    const track = document.createElement('div');
    track.style.cssText = 'position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: rgba(255, 255, 255, 0.3);';
    const fill = document.createElement('div');
    fill.style.cssText = 'width: 100%; height: 100%; background: #fff; transform-origin: left; transform: scaleX(0);';
    track.append(fill);
    bar.append(track);
    document.body.append(bar);

    let dragging = false;

    function stop(e) {
      e.stopPropagation();
      e.preventDefault();
    }

    function seek(e) {
      const r = bar.getBoundingClientRect();
      const x = Math.min(Math.max(e.clientX - r.left, 0), r.width);
      v.currentTime = v.duration / (r.width / x);
    }

    bar.addEventListener('pointerdown', function (e) {
      stop(e);
      dragging = true;
      bar.setPointerCapture(e.pointerId);
      seek(e);
    });

    bar.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      stop(e);
      seek(e);
    });

    for (const type of ['pointerup', 'pointercancel']) {
      bar.addEventListener(type, function (e) {
        stop(e);
        dragging = false;
      });
    }

    for (const type of ['click', 'mousedown', 'mouseup', 'touchstart', 'touchend']) {
      bar.addEventListener(type, stop);
    }

    return { bar: bar, fill: fill };
  }

  function findVideos() {
    for (const v of document.querySelectorAll('video')) {
      if (!bars.has(v)) bars.set(v, makeBar(v));
    }
  }

  function onScreen(v, r) {
    if (!v.duration) return false;
    if (!isFinite(v.duration)) return false;
    if (!r.width) return false;
    if (Math.max(r.bottom, 0) === 0) return false;
    return Math.min(r.top, innerHeight) !== innerHeight;
  }

  function drawBars() {
    for (const [v, b] of bars) {
      if (!v.isConnected) {
        b.bar.remove();
        bars.delete(v);
        continue;
      }
      const r = v.getBoundingClientRect();
      if (!onScreen(v, r)) {
        b.bar.style.display = 'none';
        continue;
      }
      b.bar.style.display = 'block';
      b.bar.style.left = r.left + 'px';
      b.bar.style.top = r.bottom - barHeight + 'px';
      b.bar.style.width = r.width + 'px';
      b.fill.style.transform = 'scaleX(' + v.currentTime / v.duration + ')';
    }
    requestAnimationFrame(drawBars);
  }

  new MutationObserver(clean).observe(document, { childList: true, subtree: true });
  setInterval(function () {
    clean();
    keepPlaying();
    findVideos();
    collectRelated();
  }, 500);
  requestAnimationFrame(drawBars);
}

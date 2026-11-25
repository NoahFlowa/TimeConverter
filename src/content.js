(function () {
  if (globalThis.__tcBootstrapped) return;
  globalThis.__tcBootstrapped = true;

const SKIP_TAGS = new Set(["script", "style", "textarea", "input", "select", "option", "code", "pre", "noscript", "title"]);

function parserApi() {
  const api = globalThis.TCParser;
  if (!api) throw new Error("UTC to Local Time parser did not load.");
  return api;
}

function createController(doc, hooks = {}) {
  const { findBareTimes, findExplicitTimes, formatLocal, localeUsesHour12 } = parserApi();
  const view = doc.defaultView;
  const now = typeof hooks.now === "function" ? hooks.now : () => new Date();
  const timeZone = hooks.timeZone;
  const locale = hooks.locale;
  let hour12 = hooks.hour12 === true ? true : hooks.hour12 === false ? false : null;
  let paused = Boolean(hooks.paused);
  let pickMode = false;
  let applying = 0;
  let scanTimer = 0;
  const pickedCounts = new Map();
  const observers = [];
  const observed = new WeakSet();

  function formatOptions() {
    const options = { hour12, locale, now: now() };
    if (timeZone) options.timeZone = timeZone;
    return options;
  }

  function effectiveHour12() {
    if (hour12 === true || hour12 === false) return hour12;
    return localeUsesHour12(locale, timeZone);
  }

  function withLock(fn) {
    applying += 1;
    try {
      return fn();
    } finally {
      applying -= 1;
    }
  }

  function isSkipped(node) {
    let element = node.parentElement;
    while (element) {
      if (SKIP_TAGS.has(element.localName)) return true;
      if (
        element.classList?.contains("tc-time") ||
        element.classList?.contains("tc-candidate") ||
        element.classList?.contains("tc-bar")
      ) {
        return true;
      }
      const editable = element.getAttribute?.("contenteditable");
      if (editable && editable.toLowerCase() !== "false") return true;
      if (element.parentElement) element = element.parentElement;
      else element = element.getRootNode?.().host ?? null;
    }
    return false;
  }

  function shadowOf(element) {
    if (!element || element.nodeType !== 1) return null;
    if (element.shadowRoot) return element.shadowRoot;
    try {
      return globalThis.chrome?.dom?.openOrClosedShadowRoot?.(element) ?? null;
    } catch {
      return null;
    }
  }

  function eachRoot(callback) {
    const start = doc.documentElement;
    if (!start) return;
    const stack = [start];
    const seen = new Set();
    while (stack.length) {
      const root = stack.pop();
      if (!root || seen.has(root)) continue;
      seen.add(root);
      const shadows = [];
      const ownShadow = shadowOf(root);
      if (ownShadow) shadows.push(ownShadow);
      if (root.querySelectorAll) {
        for (const element of root.querySelectorAll("*")) {
          const childShadow = shadowOf(element);
          if (childShadow) shadows.push(childShadow);
        }
      }
      callback(root);
      for (const shadow of shadows) stack.push(shadow);
    }
  }

  function queryAll(selector) {
    const found = [];
    eachRoot((root) => {
      if (root.nodeType === 1 && root.matches?.(selector)) found.push(root);
      if (root.querySelectorAll) found.push(...root.querySelectorAll(selector));
    });
    return found;
  }

  function textNodes(root) {
    if (!root || !doc.createTreeWalker || !view?.NodeFilter) return [];
    const filter = view.NodeFilter;
    const walker = doc.createTreeWalker(root, filter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue?.trim()) return filter.FILTER_REJECT;
        return isSkipped(node) ? filter.FILTER_REJECT : filter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function buildTimeSpan(match) {
    const span = doc.createElement("span");
    const local = formatLocal(match.date, formatOptions());
    span.className = "tc-time";
    span.dataset.tcOriginal = match.raw;
    span.dataset.tcUtc = match.date.toISOString();
    span.dataset.tcLocal = local;
    span.dataset.tcShowing = "local";
    span.title = match.raw;
    span.textContent = local;
    return span;
  }

  function buildCandidate(match) {
    const span = doc.createElement("span");
    span.className = "tc-candidate";
    span.title = "Convert this time as UTC";
    span.textContent = match.raw;
    return span;
  }

  function replaceMatches(root, finder, build) {
    for (const node of textNodes(root)) {
      if (!node.parentNode || node.nodeValue == null) continue;
      const text = node.nodeValue;
      const matches = finder(text);
      if (!matches.length) continue;
      const fragment = doc.createDocumentFragment();
      let cursor = 0;
      for (const match of matches) {
        if (match.start < cursor || match.end <= match.start || match.end > text.length) continue;
        if (match.start > cursor) fragment.append(doc.createTextNode(text.slice(cursor, match.start)));
        fragment.append(build(match));
        cursor = match.end;
      }
      if (!cursor) continue;
      if (cursor < text.length) fragment.append(doc.createTextNode(text.slice(cursor)));
      node.parentNode.replaceChild(fragment, node);
    }
  }

  function restoreSpan(span) {
    const text = span.dataset.tcOriginal ?? span.textContent ?? "";
    const parent = span.parentNode;
    span.replaceWith(doc.createTextNode(text));
    parent?.normalize?.();
  }

  function notePicked(raw) {
    pickedCounts.set(raw, (pickedCounts.get(raw) ?? 0) + 1);
  }

  function reapplyPicked() {
    if (!pickedCounts.size) return;
    const remaining = new Map(pickedCounts);
    for (const span of queryAll(".tc-time")) {
      const raw = span.dataset.tcOriginal;
      if (!remaining.has(raw)) continue;
      const left = remaining.get(raw) - 1;
      if (left <= 0) remaining.delete(raw);
      else remaining.set(raw, left);
    }
    if (!remaining.size) return;
    eachRoot((root) => {
      replaceMatches(root, (text) => {
        if (!remaining.size) return [];
        const matches = [];
        for (const match of findBareTimes(text, now())) {
          const left = remaining.get(match.raw);
          if (!left) continue;
          matches.push(match);
          if (left === 1) remaining.delete(match.raw);
          else remaining.set(match.raw, left - 1);
        }
        return matches;
      }, buildTimeSpan);
    });
  }

  function highlight(root) {
    replaceMatches(root, (text) => findBareTimes(text, now()), buildCandidate);
  }

  function reformatAll() {
    for (const span of queryAll(".tc-time")) {
      const date = new Date(span.dataset.tcUtc);
      if (Number.isNaN(date.getTime())) continue;
      const local = formatLocal(date, formatOptions());
      span.dataset.tcLocal = local;
      if (span.dataset.tcShowing === "original") span.title = local;
      else {
        span.textContent = local;
        span.title = span.dataset.tcOriginal;
      }
    }
  }

  function renderBar() {
    const bar = doc.querySelector("[data-tc-ui='bar']");
    if (!bar) return;
    const hours = bar.querySelector("[data-tc-action='hours']");
    const pause = bar.querySelector("[data-tc-action='pause']");
    if (hours) hours.textContent = effectiveHour12() ? "Use 24-hour" : "Use 12-hour";
    if (pause) {
      pause.textContent = paused ? "Resume on this site" : "Pause on this site";
      pause.dataset.paused = paused ? "true" : "false";
    }
  }

  function ensureBar() {
    let bar = doc.querySelector("[data-tc-ui='bar']");
    if (!bar) {
      bar = doc.createElement("div");
      bar.className = "tc-bar";
      bar.dataset.tcUi = "bar";
      bar.setAttribute("role", "region");
      bar.setAttribute("aria-label", "UTC to local time");
      const message = doc.createElement("p");
      message.className = "tc-bar-text";
      message.textContent = "Click a highlighted time to convert it as UTC. Esc to exit.";
      const hoursButton = doc.createElement("button");
      hoursButton.type = "button";
      hoursButton.dataset.tcAction = "hours";
      const pauseButton = doc.createElement("button");
      pauseButton.type = "button";
      pauseButton.dataset.tcAction = "pause";
      const doneButton = doc.createElement("button");
      doneButton.type = "button";
      doneButton.dataset.tcAction = "exit";
      doneButton.textContent = "Done";
      bar.append(message, hoursButton, pauseButton, doneButton);
      bar.addEventListener("click", (event) => {
        const action = event.target?.closest?.("[data-tc-action]")?.dataset.tcAction;
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        if (action === "hours") setHour12(!effectiveHour12(), { persist: true });
        else if (action === "pause") setPaused(!paused, { persist: true });
        else if (action === "exit") exitPickMode();
      });
      (doc.documentElement || doc.body).appendChild(bar);
    }
    renderBar();
    return bar;
  }

  function scanAll() {
    if (pickMode) ensureBar();
    if (paused) {
      if (pickMode) withLock(() => eachRoot(highlight));
      return;
    }
    withLock(() => {
      eachRoot((root) => replaceMatches(root, (text) => findExplicitTimes(text, now()), buildTimeSpan));
      reapplyPicked();
      if (pickMode) eachRoot(highlight);
    });
  }

  function scheduleScan() {
    if (!view) return;
    view.clearTimeout(scanTimer);
    scanTimer = view.setTimeout(() => {
      scanTimer = 0;
      if (applying) {
        scheduleScan();
        return;
      }
      scanAll();
    }, 50);
  }

  function observe(root) {
    if (!root || observed.has(root) || !view?.MutationObserver) return;
    observed.add(root);
    const observer = new view.MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) watchShadows(node);
        }
      }
      scheduleScan();
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    observers.push(observer);
  }

  function watchShadows(start) {
    if (!start) return;
    const shadows = [];
    const ownShadow = shadowOf(start);
    if (ownShadow) shadows.push(ownShadow);
    if (start.querySelectorAll) {
      for (const element of start.querySelectorAll("*")) {
        const childShadow = shadowOf(element);
        if (childShadow) shadows.push(childShadow);
      }
    }
    for (const shadow of shadows) {
      observe(shadow);
      watchShadows(shadow);
    }
  }

  function convertCandidate(span) {
    const matches = findBareTimes(span.textContent ?? "", now());
    const match = matches.find((item) => item.raw === span.textContent) ?? matches[0];
    if (!match) {
      restoreSpan(span);
      return 0;
    }
    notePicked(match.raw);
    span.replaceWith(buildTimeSpan(match));
    return 1;
  }

  function convertBareWithin(element) {
    return withLock(() => {
      let count = 0;
      const roots = [element];
      const elementShadow = shadowOf(element);
      if (elementShadow) roots.push(elementShadow);
      if (element.querySelectorAll) {
        for (const host of element.querySelectorAll("*")) {
          const hostShadow = shadowOf(host);
          if (hostShadow) roots.push(hostShadow);
        }
      }
      for (const root of roots) {
        const candidates = [];
        if (root.classList?.contains("tc-candidate")) candidates.push(root);
        if (root.querySelectorAll) candidates.push(...root.querySelectorAll(".tc-candidate"));
        for (const candidate of candidates) count += convertCandidate(candidate);
        const before = root.querySelectorAll ? root.querySelectorAll(".tc-time").length : 0;
        replaceMatches(root, (text) => {
          const matches = findBareTimes(text, now());
          for (const match of matches) notePicked(match.raw);
          return matches;
        }, buildTimeSpan);
        const after = root.querySelectorAll ? root.querySelectorAll(".tc-time").length : 0;
        count += Math.max(0, after - before);
      }
      return count;
    });
  }

  function toggleSpan(span) {
    if (span.dataset.tcShowing === "original") {
      span.textContent = span.dataset.tcLocal;
      span.dataset.tcShowing = "local";
      span.title = span.dataset.tcOriginal;
      return;
    }
    span.textContent = span.dataset.tcOriginal;
    span.dataset.tcShowing = "original";
    span.title = span.dataset.tcLocal;
  }

  function eventPath(event) {
    if (typeof event.composedPath === "function") return event.composedPath();
    const path = [];
    let node = event.target;
    while (node) {
      path.push(node);
      node = node.parentNode || node.host || null;
    }
    return path;
  }

  function onClick(event) {
    const path = eventPath(event);
    const time = path.find((node) => node.classList?.contains("tc-time"));
    if (time) {
      event.preventDefault();
      event.stopPropagation();
      toggleSpan(time);
      return;
    }
    if (!pickMode || path.some((node) => node.classList?.contains("tc-bar"))) return;

    const candidate = path.find((node) => node.classList?.contains("tc-candidate"));
    if (candidate) {
      event.preventDefault();
      event.stopPropagation();
      withLock(() => convertCandidate(candidate));
      return;
    }

    const element = path.find((node) => node.nodeType === 1);
    if (!element || element.localName === "html" || element.localName === "body") return;
    if (convertBareWithin(element) > 0) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function onKeydown(event) {
    if (event.key !== "Escape" || !pickMode) return;
    event.preventDefault();
    event.stopPropagation();
    exitPickMode();
  }

  function enterPickMode() {
    if (pickMode) return;
    pickMode = true;
    ensureBar();
    scanAll();
  }

  function exitPickMode() {
    if (!pickMode) return;
    pickMode = false;
    withLock(() => {
      for (const span of queryAll(".tc-candidate")) restoreSpan(span);
    });
    doc.querySelector("[data-tc-ui='bar']")?.remove();
  }

  function togglePickMode() {
    if (pickMode) exitPickMode();
    else enterPickMode();
  }

  function setHour12(value, { persist = false } = {}) {
    const next = value === true ? true : value === false ? false : null;
    if (next === hour12) {
      renderBar();
      return;
    }
    hour12 = next;
    if (persist) hooks.onHour12Change?.(hour12);
    withLock(reformatAll);
    renderBar();
  }

  function setPaused(value, { persist = false } = {}) {
    const next = Boolean(value);
    if (next === paused) {
      renderBar();
      return;
    }
    paused = next;
    if (persist) hooks.onPauseChange?.(paused);
    if (paused) {
      withLock(() => {
        for (const span of queryAll(".tc-time")) restoreSpan(span);
      });
      if (pickMode) withLock(() => eachRoot(highlight));
    } else {
      scanAll();
    }
    renderBar();
  }

  function destroy() {
    view?.clearTimeout(scanTimer);
    for (const observer of observers) observer.disconnect();
    observers.length = 0;
    doc.removeEventListener("click", onClick, true);
    doc.removeEventListener("keydown", onKeydown, true);
    doc.querySelector("[data-tc-ui='bar']")?.remove();
  }

  doc.addEventListener("click", onClick, true);
  doc.addEventListener("keydown", onKeydown, true);
  if (doc.documentElement) {
    observe(doc.documentElement);
    watchShadows(doc.documentElement);
  }
  scanAll();

  return {
    scan: scanAll,
    enterPickMode,
    exitPickMode,
    togglePickMode,
    isPickMode: () => pickMode,
    setHour12,
    setPaused,
    isPaused: () => paused,
    destroy,
  };
}

function extensionRuntime() {
  const runtime = globalThis.chrome?.runtime;
  return runtime?.id ? runtime : null;
}

async function persistPause(hostname, paused) {
  const stored = await chrome.storage.local.get({ pausedOrigins: [] });
  const origins = new Set(Array.isArray(stored.pausedOrigins) ? stored.pausedOrigins : []);
  if (paused) origins.add(hostname);
  else origins.delete(hostname);
  await chrome.storage.local.set({ pausedOrigins: [...origins] });
}

function bootstrap() {
  const pending = (async () => {
    let stored = { hour12: null, pausedOrigins: [] };
    try {
      stored = await chrome.storage.local.get(stored);
    } catch {
      stored = { hour12: null, pausedOrigins: [] };
    }
    const hostname = location.hostname;
    const controller = createController(document, {
      hour12: stored.hour12 ?? null,
      paused: Array.isArray(stored.pausedOrigins) && stored.pausedOrigins.includes(hostname),
      onHour12Change(value) {
        chrome.storage.local.set({ hour12: value }).catch(() => {});
      },
      onPauseChange(value) {
        persistPause(hostname, value).catch(() => {});
      },
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (Object.prototype.hasOwnProperty.call(changes, "hour12")) {
        controller.setHour12(changes.hour12.newValue ?? null);
      }
      if (changes.pausedOrigins) {
        const origins = changes.pausedOrigins.newValue ?? [];
        controller.setPaused(Array.isArray(origins) && origins.includes(hostname));
      }
    });
    return controller;
  })();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "TOGGLE_PICK") return undefined;
    pending
      .then((controller) => {
        controller.togglePickMode();
        sendResponse({ ok: true, pickMode: controller.isPickMode() });
      })
      .catch(() => sendResponse({ ok: false }));
    return true;
  });
  return pending;
}

globalThis.TCContent = { createController };
globalThis.__tcToggle = () => {
  ready
    ?.then((controller) => controller.togglePickMode())
    .catch((error) => console.error("UTC to Local Time could not toggle pick mode.", error));
};

let ready = null;
if (extensionRuntime()) ready = bootstrap();
})();

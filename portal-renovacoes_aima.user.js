// ==UserScript==
// @name         AIMA Renovação Status Display
// @namespace    https://github.com/Self-Perfection/gov.pt_enhancement_userscripts
// @version      2.0
// @description  Показывает числовой статус заявки на продление ВНЖ на страницах cidadao и validar
// @author       Self-Perfection
// @match        https://portal-renovacoes.aima.gov.pt/ords/r/aima/aima-pr/cidadao*
// @match        https://portal-renovacoes.aima.gov.pt/ords/r/aima/aima-pr/validar*
// @icon         https://portal-renovacoes.aima.gov.pt/ords/r/aima/200/files/static/v59/icons/app-icon-192.png
// @grant        GM_getValue
// @grant        GM_setValue
// @downloadURL  https://raw.githubusercontent.com/Self-Perfection/gov.pt_enhancement_userscripts/refs/heads/main/portal-renovacoes_aima.user.js
// @changelog    1.0 - Начальная версия: отображение числового статуса заявки в карточке
// @changelog    1.1 - MutationObserver вместо DOMContentLoaded для ожидания загрузки данных APEX
// @changelog    1.2 - Исправлен невалидный ключ dataset (дефисы → camelCase)
// @changelog    1.3 - WeakSet вместо dataset для отслеживания обработанных карточек
// @changelog    1.4 - Отключение MutationObserver после обработки всех карточек
// @changelog    1.5 - Добавлена кнопка (?) со справкой о статусах
// @changelog    1.6 - Fallback поиск элемента статуса по паттерну, улучшены сообщения об ошибках
// @changelog    1.7 - Журнал изменений статусов с кнопкой копирования, обновлены статусы (добавлены 11, 20)
// @changelog    1.8 - Статус грузится по кнопке «Узнать статус» (фикс конфликта с Recibo); debug-лог с кнопкой копирования
// @changelog    1.9 - Поддержка страницы Validação (анонимный доступ, без fetch и без риска для сессии)
// @changelog    2.0 - История статусов с привязкой к человеку (для нескольких заявок в семье); кнопка справки «?» больше не роняет сессию (button → span); добавлены статусы 12, 13
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '2.0';
  const DEBUG_LOG_KEY = 'debug_log';
  const DEBUG_LOG_MAX_ENTRIES = 200;

  // История статусов теперь хранится с привязкой к человеку:
  //   { "<personKey>": [ {s, t}, ... ], ... }
  // personKey — стабильный идентификатор заявителя (NIF / номер титулу /
  // процессу), либо токен из URL как fallback. Старый общий ключ
  // status_history однократно мигрируется в бакет "(до обновления скрипта)".
  const STORE_KEY = 'status_history_v2';
  const LEGACY_KEY = 'status_history';
  const LEGACY_BUCKET = '(до обновления скрипта)';

  function logDebug(entry) {
    let log;
    try {
      log = JSON.parse(GM_getValue(DEBUG_LOG_KEY, '[]'));
      if (!Array.isArray(log)) log = [];
    } catch (e) {
      log = [];
    }
    log.push({ t: Date.now(), ...entry });
    if (log.length > DEBUG_LOG_MAX_ENTRIES) {
      log.splice(0, log.length - DEBUG_LOG_MAX_ENTRIES);
    }
    GM_setValue(DEBUG_LOG_KEY, JSON.stringify(log));
  }

  function buildDebugPayload() {
    let debugLog;
    try {
      debugLog = JSON.parse(GM_getValue(DEBUG_LOG_KEY, '[]'));
    } catch (e) {
      debugLog = [];
    }
    return {
      scriptVersion: SCRIPT_VERSION,
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      statusHistory: getHistoryStore(),
      debugLog,
    };
  }

  const STATUS_LABELS = {
    1: 'Регистрация',
    5: 'Заявка передана сотруднику',
    11: 'Внутренняя проверка',
    12: 'Внутренняя проверка',
    13: 'Внутренняя проверка',
    14: 'Внутренняя проверка',
    15: 'Финальный анализ',
    20: '?',
    6: 'Одобрение',
  };

  // ─── Хранилище истории с привязкой к человеку ──────────────────────────

  function getHistoryStore() {
    let store;
    try {
      store = JSON.parse(GM_getValue(STORE_KEY, '{}'));
    } catch (e) {
      store = {};
    }
    if (!store || typeof store !== 'object' || Array.isArray(store)) store = {};
    return store;
  }

  function saveHistoryStore(store) {
    GM_setValue(STORE_KEY, JSON.stringify(store));
  }

  // Однократная миграция старой общей истории в отдельный бакет.
  function migrateLegacyHistory() {
    let legacyRaw;
    try {
      legacyRaw = GM_getValue(LEGACY_KEY, '');
    } catch (e) {
      legacyRaw = '';
    }
    if (!legacyRaw) return;
    let legacyArr;
    try {
      legacyArr = JSON.parse(legacyRaw);
    } catch (e) {
      legacyArr = null;
    }
    if (Array.isArray(legacyArr) && legacyArr.length > 0) {
      const store = getHistoryStore();
      if (!store[LEGACY_BUCKET]) {
        store[LEGACY_BUCKET] = legacyArr;
        saveHistoryStore(store);
      }
    }
    GM_setValue(LEGACY_KEY, ''); // больше не мигрируем
  }

  function getHistory(personKey) {
    if (!personKey) return [];
    const store = getHistoryStore();
    const h = store[personKey];
    return Array.isArray(h) ? h : [];
  }

  function recordStatus(personKey, statusValue) {
    if (!personKey) personKey = '(неизвестно)';
    const store = getHistoryStore();
    const history = Array.isArray(store[personKey]) ? store[personKey] : [];
    if (history.length > 0 && history[history.length - 1].s === statusValue) return;
    history.push({ s: statusValue, t: Date.now() });
    store[personKey] = history;
    saveHistoryStore(store);
  }

  // ─── Определение человека по странице ──────────────────────────────────

  function readFieldValue(el) {
    if (!el) return null;
    let v = (el.value || '').trim();
    if (!v) v = (el.getAttribute && (el.getAttribute('data-return-value') || '').trim()) || '';
    if (!v) {
      const txt = (el.textContent || '').trim();
      // не тащим простыни текста из контейнеров
      if (txt && txt.length <= 120) v = txt;
    }
    return v || null;
  }

  function getById(root, id) {
    if (!id) return null;
    if (root.getElementById) return root.getElementById(id);
    try {
      return root.querySelector('#' + CSS.escape(id));
    } catch (e) {
      return null;
    }
  }

  // Ищем значение поля по тексту его <label> — надёжнее, чем угадывать id.
  function readByLabel(root, labelRe) {
    const labels = root.querySelectorAll('label');
    for (const lb of labels) {
      if (!labelRe.test(lb.textContent || '')) continue;
      const forId = lb.getAttribute('for');
      const v = readFieldValue(getById(root, forId));
      if (v) return v;
    }
    return null;
  }

  // Ищем значение поля по паттерну id (P<num>_<NAME>).
  function readByIdPattern(root, idRe) {
    const els = root.querySelectorAll('input[id^="P"], span[id^="P"], [id^="P"][data-return-value]');
    for (const el of els) {
      const id = el.id || '';
      if (!/^P\d+_[A-Z0-9_]+$/i.test(id)) continue;
      if (/_(CONTAINER|LABEL)$/i.test(id)) continue;
      if (!idRe.test(id)) continue;
      const v = readFieldValue(el);
      if (v) return v;
    }
    return null;
  }

  function findField(root, labelRe, idRe) {
    return readByLabel(root, labelRe) || readByIdPattern(root, idRe);
  }

  // Длиннейшее значение query-параметра — это и есть токен заявки.
  function urlToken(href) {
    try {
      const u = new URL(href || location.href, location.origin);
      const params = new URLSearchParams(u.search);
      let longest = '';
      for (const [, v] of params) {
        if (v && v.length > longest.length) longest = v;
      }
      if (longest.length >= 8) return longest;
      return u.pathname + u.search;
    } catch (e) {
      return href || location.pathname;
    }
  }

  // Возвращает { key, label }: key — для хранилища, label — для показа.
  function identifyPerson(root) {
    root = root || document;
    const nif = findField(root, /\bnif\b/i, /_NIF\b/i);
    const titulo = findField(root, /t[íi]tulo/i, /_(TITULO|NR_TITULO|N_TITULO|NUM_TITULO|TITULO_RESID)/i);
    const processo = findField(root, /processo/i, /_(PROCESSO|NR_PROCESSO|N_PROCESSO|NUM_PROCESSO)/i);
    const pedido = findField(root, /n[.º\s]*do?\s*pedido|^pedido$/i, /_(NR_PEDIDO|N_PEDIDO|ID_PEDIDO|NUM_PEDIDO)/i);
    const nome = findField(root, /\bnome\b/i, /_(NOME|NOME_COMPLETO|NM_CIDADAO)/i);

    // Ключ — самый стабильный из доступных идентификаторов.
    const key = nif || titulo || processo || pedido || nome || null;

    // Метка — человекочитаемая: имя + короткий идентификатор для различения.
    const idBit = titulo || processo || pedido || (nif ? 'NIF ' + nif : null);
    let label = null;
    if (nome && idBit) label = nome + ' · ' + idBit;
    else if (nome) label = nome;
    else if (idBit) label = idBit;

    return { key, label };
  }

  function identifyPersonFromCard(cardBody) {
    const cardItem = (cardBody.closest && cardBody.closest('.a-CardView-item')) || cardBody;
    const titleEl = cardItem.querySelector(
      '.a-CardView-title, .a-CardView-titleText, .a-CardView-mainContent'
    );
    const label = titleEl ? (titleEl.textContent || '').trim() : null;
    const link = cardBody.querySelector('.a-CardView-subContent a');
    const key = link ? urlToken(link.href) : null;
    return { key, label: label || null };
  }

  // Сводит всё воедино: идентификационные поля → карточка → токен URL.
  function resolvePerson(root, cardBody) {
    const byFields = identifyPerson(root || document);
    let key = byFields.key;
    let label = byFields.label;

    if ((!key || !label) && cardBody) {
      const byCard = identifyPersonFromCard(cardBody);
      if (!key) key = byCard.key;
      if (!label) label = byCard.label;
    }
    if (!key) key = urlToken(location.href);
    if (!label) label = key;
    return { key, label };
  }

  function formatTimestamp(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function buildHistoryText(history, personLabel) {
    const head = personLabel ? (personLabel + ':\n') : '';
    return head + history.map(entry => {
      const label = STATUS_LABELS[entry.s] || '?';
      return formatTimestamp(entry.t) + ' — ' + entry.s + ' (' + label + ')';
    }).join('\n');
  }

  // Используем <span role="button"> чтобы APEX не перехватывал клик как submit формы
  // (см. комментарий у createHelpButton — баг с «A sua sessão terminou»).
  function createIconBtn(icon, titleText, onClick) {
    const btn = document.createElement('span');
    btn.textContent = icon;
    btn.title = titleText;
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.style.cssText = 'cursor:pointer; margin-left:6px; font-size:14px; user-select:none;';
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(btn);
    };
    btn.addEventListener('click', handler);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') handler(e);
    });
    return btn;
  }

  function flashOk(btn, original) {
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = original; }, 1500);
  }

  function createDebugCopyButton() {
    return createIconBtn('🐞', 'Скопировать отладочную информацию', (btn) => {
      const payload = JSON.stringify(buildDebugPayload(), null, 2);
      navigator.clipboard.writeText(payload).then(() => flashOk(btn, '🐞'));
    });
  }

  function renderHistory(parentEl, personKey, personLabel) {
    const history = getHistory(personKey);
    const container = document.createElement('div');
    container.style.cssText = 'margin-top:6px; font-size:12px; color:#666; line-height:1.5;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; margin-bottom:2px; flex-wrap:wrap;';
    const title = document.createElement('span');
    title.textContent = history.length > 0 ? 'История изменений:' : 'Отладка:';
    title.style.fontWeight = 'bold';
    header.appendChild(title);
    if (history.length > 0) {
      header.appendChild(createIconBtn('📋', 'Копировать историю', (btn) => {
        navigator.clipboard.writeText(buildHistoryText(history, personLabel)).then(() => flashOk(btn, '📋'));
      }));
    }
    header.appendChild(createDebugCopyButton());
    container.appendChild(header);

    // Чья это история — показываем явно, чтобы не путать членов семьи.
    if (personLabel) {
      const who = document.createElement('div');
      who.textContent = 'Заявитель: ' + personLabel;
      who.style.cssText = 'font-style:italic; color:#555; margin-bottom:2px;';
      container.appendChild(who);
    }

    for (const entry of history) {
      const row = document.createElement('div');
      const label = STATUS_LABELS[entry.s] || '?';
      row.textContent = formatTimestamp(entry.t) + ' — ' + entry.s + ' (' + label + ')';
      container.appendChild(row);
    }

    // Если в хранилище есть другие заявители — короткая подсказка.
    const store = getHistoryStore();
    const others = Object.keys(store).filter(k => k !== personKey);
    if (others.length > 0) {
      const note = document.createElement('div');
      note.style.cssText = 'margin-top:4px; color:#999;';
      note.textContent = 'Также отслеживается заявителей: ' + others.length +
        ' (история каждого видна на его странице).';
      container.appendChild(note);
    }

    parentEl.appendChild(container);
  }

  const EXPECTED_ESTADO_ID = 'P72_ESTADO_1';
  const REPORT_URL = 'https://t.me/aimairn/43114/135777';

  function findEstadoElement(root) {
    const primary = root.getElementById(EXPECTED_ESTADO_ID);
    if (primary) return { el: primary, fallback: false };
    const all = root.querySelectorAll('[id]');
    const re = /^P\d+_ESTADO_\d+$/;
    for (const el of all) {
      if (re.test(el.id)) return { el, fallback: true, foundId: el.id };
    }
    return null;
  }

  // На Validação ищем тот же регион Pedido, в котором лежит P72_ESTADO_1.
  // Если самого ESTADO нет — fallback по заголовку «Pedido» (берём только тот,
  // у которого внутри есть поля формы — внешний wrapper-регион пропускаем).
  function findPedidoRegionBody() {
    const estadoContainer = document.getElementById('P72_ESTADO_1_CONTAINER');
    if (estadoContainer) {
      const body = estadoContainer.closest('.t-Region-body');
      if (body) return body;
    }
    const headings = document.querySelectorAll('.t-Region-title');
    for (const h of headings) {
      if (h.textContent.trim() !== 'Pedido') continue;
      const region = h.closest('.t-Region');
      const body = region && region.querySelector('.t-Region-body');
      if (body && body.querySelector('.t-Form-fieldContainer')) return body;
    }
    return null;
  }

  function appendReportCTA(parent) {
    const linkStyle = 'color:#0d6efd; text-decoration:underline;';
    parent.appendChild(document.createTextNode('в чате реплаем на '));
    const announce = document.createElement('a');
    announce.href = REPORT_URL;
    announce.target = '_blank';
    announce.textContent = 'анонс юзерскрипта';
    announce.style.cssText = linkStyle;
    parent.appendChild(announce);
    parent.appendChild(document.createTextNode(' или тегните '));
    const self = document.createElement('a');
    self.href = 'https://t.me/Self_Perfection';
    self.target = '_blank';
    self.textContent = '@Self_Perfection';
    self.style.cssText = linkStyle;
    parent.appendChild(self);
  }

  function createStatusElement() {
    const div = document.createElement('div');
    div.className = 'a-CardView-subContent';
    div.style.marginTop = '8px';
    div.textContent = 'Загрузка статуса…';
    div.style.color = '#666';
    return div;
  }

  // Типичная последовательность статусов
  const STATUS_FLOW = [1, 5, 11, 14, 15, 20, 6];

  let helpDialog = null;

  function getHelpDialog() {
    if (helpDialog) return helpDialog;

    const style = document.createElement('style');
    style.textContent =
      '.aima-help-dialog::backdrop { background: rgba(0,0,0,0.3); }' +
      '.aima-help-dialog { border:1px solid #ccc; border-radius:8px; padding:12px 16px;' +
      'box-shadow:0 4px 12px rgba(0,0,0,0.15); font-size:13px; line-height:1.6;' +
      'min-width:280px; max-width:360px; color:#333; }';
    document.head.appendChild(style);

    helpDialog = document.createElement('dialog');
    helpDialog.className = 'aima-help-dialog';

    // Закрытие по клику на backdrop
    helpDialog.addEventListener('click', (e) => {
      if (e.target === helpDialog) helpDialog.close();
    });

    document.body.appendChild(helpDialog);
    return helpDialog;
  }

  function fillHelpDialog(dialog, statusValue) {
    dialog.innerHTML = '';

    // Кнопка закрытия
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText =
      'position:absolute; top:8px; right:12px; border:none; background:none;' +
      'font-size:20px; cursor:pointer; color:#666; line-height:1;';
    closeBtn.addEventListener('click', () => dialog.close());
    dialog.appendChild(closeBtn);

    const title = document.createElement('div');
    title.textContent = 'Типичная последовательность статусов:';
    title.style.cssText = 'font-weight:bold; margin-bottom:8px;';
    dialog.appendChild(title);

    const list = document.createElement('div');
    list.style.cssText = 'margin-bottom:8px;';
    for (const code of STATUS_FLOW) {
      const row = document.createElement('div');
      const numSpan = document.createElement('span');
      numSpan.textContent = String(code).padStart(2, ' ');
      numSpan.style.cssText = 'font-family:monospace; margin-right:4px;';
      row.appendChild(numSpan);

      const labelSpan = document.createElement('span');
      labelSpan.textContent = ' — ' + STATUS_LABELS[code];
      row.appendChild(labelSpan);

      if (code === statusValue) {
        const marker = document.createElement('span');
        marker.textContent = '  ◀ вы здесь';
        marker.style.cssText = 'color:#0d6efd; font-weight:bold;';
        row.appendChild(marker);
      }
      list.appendChild(row);
    }
    dialog.appendChild(list);

    const note11 = document.createElement('div');
    note11.style.cssText = 'font-size:12px; color:#666; margin-bottom:8px; font-style:italic;';
    note11.textContent = 'Статусы 11–13 могут появляться после 5 и иногда возвращаться.';
    dialog.appendChild(note11);

    if (!STATUS_FLOW.includes(statusValue)) {
      const note = document.createElement('div');
      note.style.cssText = 'color:#856404; background:#fff3cd; padding:4px 8px; border-radius:4px; margin-bottom:8px;';
      note.textContent = 'Ваш статус ' + statusValue + ' не входит в типичную последовательность. Расскажите об этом ';
      appendReportCTA(note);
      dialog.appendChild(note);
    }

    const footer = document.createElement('div');
    footer.style.cssText = 'font-size:12px; color:#666; border-top:1px solid #eee; padding-top:8px; margin-top:4px;';
    const linkStyle = 'color:#0d6efd; text-decoration:underline;';
    const sourceLink1 = document.createElement('a');
    sourceLink1.href = 'https://t.me/aimairn/43114/134298';
    sourceLink1.target = '_blank';
    sourceLink1.textContent = 'Источник 1';
    sourceLink1.style.cssText = linkStyle;
    footer.appendChild(sourceLink1);
    footer.appendChild(document.createTextNode(', '));
    const sourceLink2 = document.createElement('a');
    sourceLink2.href = 'https://t.me/aimairn/43114/136559';
    sourceLink2.target = '_blank';
    sourceLink2.textContent = 'Источник 2';
    sourceLink2.style.cssText = linkStyle;
    footer.appendChild(sourceLink2);
    footer.appendChild(document.createElement('br'));

    footer.appendChild(document.createTextNode('Если у вас нестандартный статус, расскажите '));
    appendReportCTA(footer);
    dialog.appendChild(footer);
  }

  // Кнопка "?" — <span role="button">, а НЕ <button>: APEX перехватывает
  // клик по <button> внутри формы как submit и роняет сессию
  // («Ocorreu 1 erro — A sua sessão terminou.» + перезагрузка страницы).
  function createHelpButton(statusValue) {
    const btn = document.createElement('span');
    btn.textContent = '?';
    btn.title = 'Справка о статусах';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.style.cssText =
      'display:inline-block; cursor:pointer; background:#6c757d; color:#fff; border-radius:50%;' +
      'width:20px; height:20px; font-size:12px; margin-left:6px; vertical-align:middle;' +
      'line-height:20px; text-align:center; padding:0; user-select:none;';

    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const dialog = getHelpDialog();
      fillHelpDialog(dialog, statusValue);
      dialog.showModal();
    };
    btn.addEventListener('click', handler);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') handler(e);
    });

    return btn;
  }

  function updateStatusElement(el, statusValue) {
    const label = STATUS_LABELS[statusValue] || 'Неизвестный статус';
    el.textContent = '';
    el.style.color = '';

    const badge = document.createElement('span');
    badge.textContent = statusValue + ' — ' + label;
    badge.style.cssText =
      'display:inline-block; padding:4px 10px; border-radius:4px; font-weight:bold; font-size:14px;';

    if (statusValue === 6) {
      badge.style.background = '#d4edda';
      badge.style.color = '#155724';
    } else if (statusValue >= 14) {
      badge.style.background = '#fff3cd';
      badge.style.color = '#856404';
    } else {
      badge.style.background = '#e2e3e5';
      badge.style.color = '#383d41';
    }

    el.appendChild(badge);
    el.appendChild(createHelpButton(statusValue));
  }

  function showError(el, message, personKey, personLabel) {
    el.textContent = '';
    el.style.color = '';
    const msg = document.createElement('div');
    msg.textContent = message;
    msg.style.color = '#dc3545';
    el.appendChild(msg);
    renderHistory(el, personKey, personLabel);
  }

  function collectBadgeInfo(cardBody) {
    const cardItem = cardBody.closest('.a-CardView-item');
    const badgeEl = cardItem && cardItem.querySelector('.a-CardView-badge');
    if (!badgeEl) return null;
    const className = badgeEl.className || '';
    const numMatch = className.match(/t-Badge--(\d+)/);
    return {
      className,
      title: badgeEl.getAttribute('title') || null,
      label: (badgeEl.querySelector('.a-CardView-badgeLabel') || {}).textContent || null,
      value: (badgeEl.querySelector('.a-CardView-badgeValue') || {}).textContent || null,
      num: numMatch ? Number(numMatch[1]) : null,
    };
  }

  function describeEstadoEl(el) {
    if (!el) return null;
    return {
      id: el.id,
      returnValue: el.getAttribute('data-return-value'),
      value: el.value || null,
    };
  }

  function urlPath(href) {
    try { return new URL(href).pathname; } catch (e) { return null; }
  }

  function processCard(cardBody) {
    const statusEl = createStatusElement();
    cardBody.appendChild(statusEl);
    renderIdle(statusEl, cardBody);
  }

  // Исходное состояние: статус автоматически не тянем, чтобы фоновый fetch
  // (с clear=72) не ломал APEX-сессию и не триггерил «A sua sessão terminou.»
  // на кнопке Recibo. Пользователь сам жмёт «Узнать статус», когда готов.
  function renderIdle(statusEl, cardBody) {
    statusEl.textContent = '';
    statusEl.style.color = '';

    const btn = document.createElement('span');
    btn.textContent = 'Узнать статус';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.style.cssText =
      'display:inline-block; cursor:pointer; padding:4px 10px; border-radius:4px; ' +
      'background:#0d6efd; color:#fff; font-weight:bold; font-size:14px; user-select:none;';
    const activate = (e) => {
      e.preventDefault();
      e.stopPropagation();
      loadStatus(statusEl, cardBody);
    };
    btn.addEventListener('click', activate);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') activate(e);
    });
    statusEl.appendChild(btn);

    const note = document.createElement('div');
    note.style.cssText = 'margin-top:4px; font-size:11px; color:#666;';
    note.textContent = 'После нажатия кнопка «Recibo» может перестать работать до перезагрузки страницы.';
    statusEl.appendChild(note);

    // История человека из этой карточки (по токену ссылки/полям карточки).
    const idlePerson = resolvePerson(document, cardBody);
    renderHistory(statusEl, idlePerson.key, idlePerson.label);
  }

  async function loadStatus(statusEl, cardBody) {
    statusEl.textContent = 'Загрузка статуса…';
    statusEl.style.color = '#666';

    // Резервная идентификация — на случай, если результат не получим.
    const fallbackPerson = resolvePerson(document, cardBody);

    const debug = {
      ver: SCRIPT_VERSION,
      badge: collectBadgeInfo(cardBody),
    };

    function handleResult(result) {
      debug.estado = result ? describeEstadoEl(result.el) : null;
      debug.fallback = result ? !!result.fallback : null;
      if (result && result.fallback) debug.foundId = result.foundId;

      // Человек определяется из того документа, где нашёлся статус.
      const root = result && result.el ? (result.el.ownerDocument || document) : document;
      const person = result ? resolvePerson(root, cardBody) : fallbackPerson;
      debug.personKey = person.key;
      debug.personLabel = person.label;
      logDebug(debug);

      if (!result) {
        statusEl.textContent = '';
        const msg = document.createElement('div');
        msg.textContent = 'Элемент статуса не найден. Расскажите об этом ';
        msg.style.color = '#dc3545';
        appendReportCTA(msg);
        statusEl.appendChild(msg);
        renderHistory(statusEl, person.key, person.label);
        return;
      }
      const val = Number(result.el.getAttribute('data-return-value'));
      updateStatusElement(statusEl, val);
      recordStatus(person.key, val);
      renderHistory(statusEl, person.key, person.label);
      if (result.fallback) {
        const warn = document.createElement('div');
        warn.style.cssText = 'color:#856404; background:#fff3cd; padding:4px 8px; border-radius:4px; margin-top:4px; font-size:12px;';
        warn.textContent = 'Найден нестандартный ID: ' + result.foundId + '. Расскажите об этом ';
        appendReportCTA(warn);
        statusEl.appendChild(warn);
      }
    }

    // Если элемент статуса уже есть в текущем документе — используем его,
    // fetch не нужен, сессия не пострадает.
    const localResult = findEstadoElement(document);
    if (localResult) {
      debug.source = 'local';
      handleResult(localResult);
      return;
    }

    const link = cardBody.querySelector('.a-CardView-subContent a');
    if (!link) {
      debug.source = 'no-link';
      debug.personKey = fallbackPerson.key;
      logDebug(debug);
      showError(statusEl, 'Ссылка на форму не найдена', fallbackPerson.key, fallbackPerson.label);
      return;
    }

    // Проверенный способ: запрашиваем validar как есть, включая clear=72.
    // Это единственная найденная комбинация, при которой APEX отдаёт
    // заполненный P72_ESTADO_1. Сторонний эффект — ротация сессии таба —
    // пользователь принял явно, нажав на «Узнать статус».
    debug.source = 'fetch';
    debug.fetchPath = urlPath(link.href);

    try {
      const response = await fetch(link.href, { credentials: 'include' });
      debug.fetchStatus = response.status;
      debug.fetchFinalPath = urlPath(response.url);
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      handleResult(findEstadoElement(doc));
    } catch (e) {
      debug.fetchError = String(e);
      debug.personKey = fallbackPerson.key;
      logDebug(debug);
      showError(statusEl, 'Ошибка загрузки: ' + e.message, fallbackPerson.key, fallbackPerson.label);
    }
  }

  function initCidadaoMode() {
    const processed = new WeakSet();

    // Наблюдаем за изменениями DOM для перехвата момента загрузки данных APEX
    const observer = new MutationObserver(() => {
      const cards = document.querySelectorAll('.a-CardView-body');
      for (const cardBody of cards) {
        if (processed.has(cardBody)) continue;
        // Ждём пока внутри карточки появится ссылка — признак загруженных данных
        const link = cardBody.querySelector('.a-CardView-subContent a');
        if (!link) continue;
        processed.add(cardBody);
        processCard(cardBody);
      }
      // Все карточки обработаны — observer больше не нужен
      if (cards.length > 0 && [...cards].every(c => processed.has(c))) {
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Validação рендерится анонимно и P72_ESTADO_1 уже лежит в DOM на момент
  // document-end — никакой fetch и никакой MutationObserver не нужны.
  function initValidacaoMode() {
    const result = findEstadoElement(document);
    const person = resolvePerson(document, null);
    const debug = { ver: SCRIPT_VERSION, page: 'validacao', personKey: person.key, personLabel: person.label };
    if (result) {
      debug.estado = describeEstadoEl(result.el);
      debug.fallback = !!result.fallback;
      if (result.fallback) debug.foundId = result.foundId;
    }
    logDebug(debug);

    const pedidoBody = findPedidoRegionBody();
    if (!pedidoBody) return;

    const container = document.createElement('div');
    container.style.cssText =
      'margin-bottom:16px; padding:10px 12px; background:#f8f9fa;' +
      'border-radius:6px; border-left:3px solid #0d6efd;';

    if (!result) {
      const msg = document.createElement('div');
      msg.style.color = '#dc3545';
      msg.textContent = 'Элемент статуса не найден. Расскажите об этом ';
      appendReportCTA(msg);
      container.appendChild(msg);
    } else {
      const val = Number(result.el.getAttribute('data-return-value'));
      recordStatus(person.key, val);

      const statusEl = document.createElement('div');
      updateStatusElement(statusEl, val);
      container.appendChild(statusEl);

      if (result.fallback) {
        const warn = document.createElement('div');
        warn.style.cssText =
          'color:#856404; background:#fff3cd; padding:4px 8px;' +
          'border-radius:4px; margin-top:6px; font-size:12px;';
        warn.textContent = 'Найден нестандартный ID: ' + result.foundId + '. Расскажите об этом ';
        appendReportCTA(warn);
        container.appendChild(warn);
      }
    }

    renderHistory(container, person.key, person.label);
    pedidoBody.appendChild(container);
  }

  migrateLegacyHistory();

  const path = location.pathname;
  if (/\/validar(?:\/|$)/.test(path)) {
    initValidacaoMode();
  } else if (/\/cidadao(?:\/|$)/.test(path)) {
    initCidadaoMode();
  }
})();

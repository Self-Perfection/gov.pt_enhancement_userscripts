// ==UserScript==
// @name         AIMA Renovação Status Display
// @namespace    https://github.com/Self-Perfection/gov.pt_enhancement_userscripts
// @version      1.8
// @description  Показывает числовой статус заявки на продление ВНЖ на странице cidadao
// @author       Self-Perfection
// @match        https://portal-renovacoes.aima.gov.pt/ords/r/aima/aima-pr/cidadao*
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
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '1.8';
  const DEBUG_LOG_KEY = 'debug_log';
  const DEBUG_LOG_MAX_ENTRIES = 200;

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
      statusHistory: getHistory(),
      debugLog,
    };
  }

  const STATUS_LABELS = {
    1: 'Регистрация',
    5: 'Заявка передана сотруднику',
    11: 'Внутренняя проверка',
    14: 'Внутренняя проверка',
    15: 'Финальный анализ',
    20: '?',
    6: 'Одобрение',
  };

  function getHistory() {
    return JSON.parse(GM_getValue('status_history', '[]'));
  }

  function recordStatus(statusValue) {
    const history = getHistory();
    if (history.length > 0 && history[history.length - 1].s === statusValue) return;
    history.push({ s: statusValue, t: Date.now() });
    GM_setValue('status_history', JSON.stringify(history));
  }

  function formatTimestamp(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function buildHistoryText(history) {
    return history.map(entry => {
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

  function renderHistory(parentEl) {
    const history = getHistory();
    const container = document.createElement('div');
    container.style.cssText = 'margin-top:6px; font-size:12px; color:#666; line-height:1.5;';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; margin-bottom:2px;';
    const title = document.createElement('span');
    title.textContent = history.length > 0 ? 'История изменений:' : 'Отладка:';
    title.style.fontWeight = 'bold';
    header.appendChild(title);
    if (history.length > 0) {
      header.appendChild(createIconBtn('📋', 'Копировать историю', (btn) => {
        navigator.clipboard.writeText(buildHistoryText(history)).then(() => flashOk(btn, '📋'));
      }));
    }
    header.appendChild(createDebugCopyButton());
    container.appendChild(header);
    for (const entry of history) {
      const row = document.createElement('div');
      const label = STATUS_LABELS[entry.s] || '?';
      row.textContent = formatTimestamp(entry.t) + ' — ' + entry.s + ' (' + label + ')';
      container.appendChild(row);
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
      numSpan.textContent = String(code).padStart(2, '\u00a0');
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
    note11.textContent = 'Статус 11 может появляться после 5 и иногда возвращаться.';
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

  // BUG: кнопка "?" вызывает уведомление от сайта:
  // «Ocorreu 1 erro — A sua sessão terminou.»
  // type="button" не помогает — APEX всё равно перехватывает.
  // TODO: заменить <button> на <span> с role="button" и tabindex="0".
  function createHelpButton(statusValue) {
    const btn = document.createElement('button');
    btn.textContent = '?';
    btn.title = 'Справка о статусах';
    btn.style.cssText =
      'cursor:pointer; border:none; background:#6c757d; color:#fff; border-radius:50%;' +
      'width:20px; height:20px; font-size:12px; margin-left:6px; vertical-align:middle;' +
      'line-height:20px; text-align:center; padding:0;';

    btn.addEventListener('click', () => {
      const dialog = getHelpDialog();
      fillHelpDialog(dialog, statusValue);
      dialog.showModal();
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

  function showError(el, message) {
    el.textContent = '';
    el.style.color = '';
    const msg = document.createElement('div');
    msg.textContent = message;
    msg.style.color = '#dc3545';
    el.appendChild(msg);
    renderHistory(el);
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

    renderHistory(statusEl);
  }

  async function loadStatus(statusEl, cardBody) {
    statusEl.textContent = 'Загрузка статуса…';
    statusEl.style.color = '#666';

    const debug = {
      ver: SCRIPT_VERSION,
      badge: collectBadgeInfo(cardBody),
    };

    function handleResult(result) {
      debug.estado = result ? describeEstadoEl(result.el) : null;
      debug.fallback = result ? !!result.fallback : null;
      if (result && result.fallback) debug.foundId = result.foundId;
      logDebug(debug);

      if (!result) {
        statusEl.textContent = '';
        const msg = document.createElement('div');
        msg.textContent = 'Элемент статуса не найден. Расскажите об этом ';
        msg.style.color = '#dc3545';
        appendReportCTA(msg);
        statusEl.appendChild(msg);
        renderHistory(statusEl);
        return;
      }
      const val = Number(result.el.getAttribute('data-return-value'));
      updateStatusElement(statusEl, val);
      recordStatus(val);
      renderHistory(statusEl);
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
      logDebug(debug);
      showError(statusEl, 'Ссылка на форму не найдена');
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
      logDebug(debug);
      showError(statusEl, 'Ошибка загрузки: ' + e.message);
    }
  }

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
})();

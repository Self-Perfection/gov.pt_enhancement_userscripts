// ==UserScript==
// @name         AIMA Renovação Status Display
// @namespace    https://github.com/Self-Perfection/gov.pt_enhancement_userscripts
// @version      1.13.1
// @description  Показывает числовой статус заявки на продление ВНЖ на странице проверки по токену; в кабинете подсказывает, где его смотреть
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
// @changelog    1.10 - Добавлена ссылка на вики о продлении ВНЖ (под статусом и в справке)
// @changelog    1.11 - Кнопка «?» больше не роняет сессию (button → span с role="button")
// @changelog    1.12 - Коды статуса по вики сообщества: добавлены 3, 12, 13, 17-19 и коды 1xx, убран неподтверждённый код 1, справка переписана честнее
// @changelog    1.13 - В кабинете больше не запрашиваем статус фоном (ломало «Recibo»): вместо кнопки «Узнать статус» — ссылка на страницу отслеживания, для одобренной заявки — ссылка про карту
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '1.13.1';
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

  // Настоящий номер заявки в экспорт не отдаём. Он короткий, последовательный
  // и человек его знает — по нему выгрузку, вставленную в общий чат, сопоставят
  // с автором, и обезличенный ключ журнала перестанет что-либо значить. Для
  // отладки достаточно знать, что заявка сменилась, поэтому нумеруем по порядку.
  function anonymizePedidoIds(store) {
    const out = {};
    for (const [key, history] of Object.entries(store)) {
      const seen = [];
      out[key] = history.map(entry => {
        if (entry.p == null) return { ...entry, p: null };
        let n = seen.indexOf(entry.p);
        if (n < 0) n = seen.push(entry.p) - 1;
        return { ...entry, p: n + 1 };
      });
    }
    return out;
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
      // Соль сюда не кладём: без неё ключи не разворачиваются в NIE перебором.
      statusHistory: anonymizePedidoIds(getHistoryStore()),
      debugLog,
    };
  }

  // Источник истины — вики сообщества, страница «Числовой код статуса»:
  // https://self-perfection.github.io/aima-renovacoes-wiki/process/etapy-zayavki/kod-statusa/
  // Правьте эту таблицу только вслед за вики, а не по отдельным сообщениям в чате.
  //
  // Официальной расшифровки кодов не существует. Кавычки в подписи означают, что
  // трактовка пришла из чата и ничем не подкреплена; без кавычек — наблюдалось
  // вместе со словесным статусом. Кода 1 здесь нет намеренно: его не наблюдал
  // никто, он известен только по одному неподтверждённому сообщению.
  const STATUS_LABELS = {
    // 0 — не статус заявки, а поле P3_TR_ESTADO («старая карта просрочена»).
    // Держим здесь, чтобы не предлагать человеку сообщать о «неизвестном коде».
    0: 'не статус заявки, а поле старой карты',
    3: 'самое начало, до анализа',
    5: '«заявка передана сотруднику»',
    6: 'одобрено',
    11: 'анализ',
    12: 'значение не установлено',
    13: 'значение не установлено',
    14: 'анализ',
    15: '«финальный анализ»',
    17: 'значение не установлено',
    18: 'открыт дозапрос',
    19: 'дозапрос, письмо со списком следом',
    20: 'ответ на дозапрос отправлен, ждёт анализа',
  };

  // Коды вида 1xx — те же коды плюс сто (111 = 11, 114 = 14); в чате это
  // проверили, сопоставив числа со словесными статусами.
  function normalizeCode(code) {
    return code > 100 ? code - 100 : code;
  }

  function statusLabel(code) {
    return STATUS_LABELS[normalizeCode(code)] || 'код не встречался';
  }

  function isKnownCode(code) {
    return normalizeCode(code) in STATUS_LABELS;
  }

  // ─── Журнал статусов, по заявителю ────────────────────────────────────
  //
  // Ключ — хеш от соли и NIE (Número de Identificação de Estrangeiro). NIE
  // закреплён за человеком навсегда и не меняется при подаче и продлении, так
  // что журнал переживает смену заявки; id заявки пишем атрибутом записи, чтобы
  // было видно, где одна заявка сменила другую.
  //
  // Сам NIE не храним: он есть на открытой странице, ключ считается заново.
  // Соль обязательна — NIE семизначный, голый хеш перебирается за секунду.
  // Соль никогда не попадает в debug-экспорт (см. buildDebugPayload), поэтому
  // ключи можно отдавать наружу как есть.
  const STORE_KEY = 'status_history_v2';
  const SALT_KEY = 'install_salt';
  const NO_NIE_KEY = 'no-nie';

  function getSalt() {
    let salt = GM_getValue(SALT_KEY, '');
    if (!salt) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      salt = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
      GM_setValue(SALT_KEY, salt);
    }
    return salt;
  }

  async function personKey(nie) {
    if (!nie) return NO_NIE_KEY;
    const data = new TextEncoder().encode(getSalt() + ':' + nie);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].slice(0, 8)
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }

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

  function getHistory(key) {
    const h = getHistoryStore()[key];
    return Array.isArray(h) ? h : [];
  }

  function recordStatus(key, statusValue, pedidoId) {
    const store = getHistoryStore();
    const history = Array.isArray(store[key]) ? store[key] : [];
    const last = history[history.length - 1];
    // Тот же код по той же заявке — не дублируем. Смена заявки при том же коде
    // это событие, его записываем.
    if (last && last.s === statusValue && last.p === pedidoId) return;
    history.push({ s: statusValue, t: Date.now(), p: pedidoId || null });
    store[key] = history;
    GM_setValue(STORE_KEY, JSON.stringify(store));
  }

  // Значение поля APEX по имени — на странице по токену так лежат NIE и id
  // заявки. Номер страницы в id у разных людей разный (P72_…, P76_…), поэтому
  // сначала пробуем ожидаемый id, потом ищем по шаблону — как findEstadoElement.
  function fieldValue(expectedId, suffixRe) {
    const byId = document.getElementById(expectedId);
    const read = (el) => {
      const v = el && (el.value || el.getAttribute('data-return-value'));
      return (v && String(v).trim()) || null;
    };
    const direct = read(byId);
    if (direct) return direct;
    for (const el of document.querySelectorAll('[id]')) {
      if (suffixRe.test(el.id)) {
        const v = read(el);
        if (v) return v;
      }
    }
    return null;
  }

  function formatTimestamp(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function buildHistoryText(history) {
    return history.map(entry => {
      const label = statusLabel(entry.s);
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

  const WIKI_URL = 'https://self-perfection.github.io/aima-renovacoes-wiki/';
  const STATUS_CODES_URL = WIKI_URL + 'process/etapy-zayavki/kod-statusa/';
  const CARD_DELIVERY_URL = WIKI_URL + 'process/karta-i-dostavka/';

  function createWikiLink(text, url) {
    const link = document.createElement('a');
    link.href = url || WIKI_URL;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = text;
    link.style.cssText = 'color:#0d6efd; text-decoration:underline;';
    return link;
  }

  function renderWikiLine(parentEl) {
    const line = document.createElement('div');
    line.style.cssText = 'margin-top:6px; font-size:12px;';
    line.appendChild(document.createTextNode('📖 '));
    line.appendChild(createWikiLink('Вики о продлении ВНЖ'));
    line.appendChild(document.createTextNode(' — статусы, сроки, частые вопросы'));
    parentEl.appendChild(line);
  }

  function renderFooter(parentEl, personKeyValue) {
    renderWikiLine(parentEl);
    const history = getHistory(personKeyValue);
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
      const label = statusLabel(entry.s);
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
    title.textContent = 'Код ' + statusValue + ' — ' + statusLabel(statusValue);
    title.style.cssText = 'font-weight:bold; margin-bottom:8px; padding-right:24px;';
    dialog.appendChild(title);

    // Коды 1xx — то же самое плюс сто. Без пояснения человек решит, что у него
    // какой-то свой особенный код.
    if (normalizeCode(statusValue) !== statusValue) {
      const note1xx = document.createElement('div');
      note1xx.style.cssText = 'margin-bottom:8px;';
      note1xx.textContent = 'Коды вида 1xx — те же коды плюс сто: ' + statusValue +
        ' значит то же, что ' + normalizeCode(statusValue) + '.';
      dialog.appendChild(note1xx);
    }

    // Код 0 — известная ложная тревога: скрипт зацепил поле старой карты.
    if (normalizeCode(statusValue) === 0) {
      const note0 = document.createElement('div');
      note0.style.cssText = 'margin-bottom:8px;';
      note0.textContent = 'Код 0 со значением Expirado — это поле P3_TR_ESTADO: ' +
        'оно говорит лишь о том, что просрочена ваша старая карта, что вы и так знаете. ' +
        'К рассмотрению заявки отношения не имеет. Нужное поле оканчивается на _ESTADO_1 — ' +
        'похоже, скрипт зацепил не то, расскажите об этом ';
      appendReportCTA(note0);
      dialog.appendChild(note0);
    }

    const disclaimer = document.createElement('div');
    disclaimer.style.cssText =
      'margin-bottom:8px; padding:6px 8px; background:#fff3cd; color:#856404; border-radius:4px;';
    disclaimer.textContent = 'Официальной расшифровки кодов не существует — всё, что о них ' +
      'известно, это наблюдения сообщества. Код полезен как признак жизни: что-то в системе ' +
      'шевелится. Строить по нему прогноз сроков нельзя, повлиять на него тоже нельзя.';
    dialog.appendChild(disclaimer);

    const pattern = document.createElement('div');
    pattern.style.cssText = 'margin-bottom:8px;';
    pattern.textContent = 'Единственная закономерность, под которой есть случаи с датами: ' +
      '14 → 15 нередко случается незадолго до одобрения, а после одобрения код становится 6. ' +
      'И даже это не правило — 15 висит неделями, а одобрение приходило напрямую из 13.';
    dialog.appendChild(pattern);

    if (!isKnownCode(statusValue)) {
      const note = document.createElement('div');
      note.style.cssText = 'color:#856404; background:#fff3cd; padding:4px 8px; border-radius:4px; margin-bottom:8px;';
      note.textContent = 'Код ' + statusValue + ' сообществу ещё не встречался. Расскажите о нём ';
      appendReportCTA(note);
      dialog.appendChild(note);
    }

    const wikiBlock = document.createElement('div');
    wikiBlock.style.cssText = 'margin-bottom:8px; padding:6px 8px; background:#e7f1ff; border-radius:4px;';
    wikiBlock.appendChild(document.createTextNode('📖 Что известно про каждый код и откуда — '));
    wikiBlock.appendChild(createWikiLink('в вики, со ссылками на источники', STATUS_CODES_URL));
    dialog.appendChild(wikiBlock);

    const footer = document.createElement('div');
    footer.style.cssText = 'font-size:12px; color:#666; border-top:1px solid #eee; padding-top:8px; margin-top:4px;';
    footer.appendChild(document.createTextNode('Заметили переход, которого нет в вики, — расскажите '));
    appendReportCTA(footer);
    dialog.appendChild(footer);
  }

  // <span role="button">, а не <button>: APEX перехватывает клик по <button>
  // внутри формы как submit и роняет сессию — «Ocorreu 1 erro — A sua sessão
  // terminou.» с перезагрузкой страницы. type="button" не помогает.
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
    el.textContent = '';
    el.style.color = '';

    const badge = document.createElement('span');
    badge.textContent = statusValue + ' — ' + statusLabel(statusValue);
    badge.style.cssText =
      'display:inline-block; padding:4px 10px; border-radius:4px; font-weight:bold; font-size:14px;';

    // Цветом отмечаем только то, что действительно что-то означает: одобрение и
    // дозапрос (там нужны действия). Раскрашивать «чем больше число, тем ближе
    // одобрение» нельзя — коды откатываются назад, это не шкала прогресса.
    const code = normalizeCode(statusValue);
    if (code === 6) {
      badge.style.background = '#d4edda';
      badge.style.color = '#155724';
    } else if (code === 18 || code === 19) {
      badge.style.background = '#fff3cd';
      badge.style.color = '#856404';
    } else {
      badge.style.background = '#e2e3e5';
      badge.style.color = '#383d41';
    }

    el.appendChild(badge);
    el.appendChild(createHelpButton(statusValue));
  }



  function describeEstadoEl(el) {
    if (!el) return null;
    return {
      id: el.id,
      returnValue: el.getAttribute('data-return-value'),
      value: el.value || null,
    };
  }


  // Совет «следите за кодом статуса» осмыслен, только пока заявка в работе.
  // По решённой заявке показываем то, что относится к ней, а не общий текст.
  function cardOutcome(cardBody) {
    const item = cardBody.closest('.a-CardView-item') || cardBody;
    const badge = item.querySelector('.a-CardView-badgeValue');
    const text = ((badge && badge.textContent) || '').toLowerCase();
    // Порядок важен: «indeferido» содержит «deferido» как подстроку.
    if (text.includes('indeferido')) return 'refused';
    if (text.includes('deferido')) return 'approved';
    return 'pending';
  }

  // На cidadao статус намеренно не показываем. Чтобы его получить, пришлось бы
  // фоном запросить страницу заявки, а этот запрос ротирует APEX-сессию и ломает
  // кнопку «Recibo». Вместо этого подсказываем открыть страницу по токену: там
  // статус виден сразу, без входа в кабинет и без риска для сессии.
  function annotateCard(cardBody) {
    const outcome = cardOutcome(cardBody);
    logDebug({ ver: SCRIPT_VERSION, page: 'cidadao', outcome });

    // Про отказ у сообщества проверенного материала нет — лучше промолчать,
    // чем советовать наугад человеку, которому и так плохо.
    if (outcome === 'refused') return;

    const note = document.createElement('div');
    note.style.cssText = 'margin-top:8px; padding:8px 10px; background:#e7f1ff; ' +
      'border-radius:4px; font-size:12px; line-height:1.5;';

    const head = document.createElement('div');
    head.style.cssText = 'font-weight:bold; margin-bottom:2px;';
    note.appendChild(head);

    if (outcome === 'approved') {
      head.textContent = '✅ Заявка одобрена — следить больше не за чем';
      note.appendChild(document.createTextNode(
        'Карту печатают и присылают почтой CTT. '));
      note.appendChild(createWikiLink(
        'Сроки, трек-номер и что делать при ошибке в данных карты', CARD_DELIVERY_URL));
    } else {
      head.textContent = '📌 Как следить за движением заявки';

      // Даём свою подписанную ссылку, а не отсылаем «к ссылке выше»: там синим
      // набран сам токен, и не всем очевидно, что по нему надо кликать.
      const link = cardBody.querySelector('.a-CardView-subContent a');
      if (link) {
        const openLine = document.createElement('div');
        openLine.style.cssText = 'margin:6px 0;';
        const open = document.createElement('a');
        open.href = link.href;
        open.target = '_blank';
        open.rel = 'noopener';
        open.textContent = 'Открыть страницу с кодом статуса →';
        open.style.cssText =
          'display:inline-block; padding:5px 12px; border-radius:4px; background:#0d6efd; ' +
          'color:#fff; font-weight:bold; text-decoration:none;';
        openLine.appendChild(open);
        note.appendChild(openLine);
      }

      note.appendChild(document.createTextNode(
        'Сохраните её в закладки: потом достаточно открыть закладку и обновить страницу, ' +
        'логиниться и вводить токен заново не нужно. Там виден числовой код статуса — он ' +
        'меняется чаще словесного, поэтому по нему бывает заметно движение дела, когда ' +
        'снаружи всё замерло. '));
      note.appendChild(createWikiLink('Что означают коды', STATUS_CODES_URL));
    }

    const holder = cardBody.querySelector('.a-CardView-subContent') || cardBody;
    holder.appendChild(note);
  }

  function initCidadaoMode() {
    const annotated = new WeakSet();

    // Ждём, пока APEX отрисует карточку: ссылка с токеном — признак, что данные
    // загрузились. Заявка у человека одна, поэтому после первой же отключаемся.
    const observer = new MutationObserver(() => {
      for (const cardBody of document.querySelectorAll('.a-CardView-body')) {
        if (annotated.has(cardBody)) continue;
        if (!cardBody.querySelector('.a-CardView-subContent a')) continue;
        annotated.add(cardBody);
        annotateCard(cardBody);
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Validação рендерится анонимно и P72_ESTADO_1 уже лежит в DOM на момент
  // document-end — никакой fetch и никакой MutationObserver не нужны.
  async function initValidacaoMode() {
    const result = findEstadoElement(document);

    // NIE и id заявки лежат в этом же документе — идти за ними никуда не нужно.
    const nie = fieldValue('P72_NIE', /^P\d+_NIE$/);
    const pedidoId = fieldValue('P72_ID_1', /^P\d+_ID_1$/);
    const key = await personKey(nie);

    const debug = { ver: SCRIPT_VERSION, page: 'validacao', key, pedidoId, hasNie: !!nie };
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
      recordStatus(key, val, pedidoId);

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

    renderFooter(container, key);
    pedidoBody.appendChild(container);
  }

  const path = location.pathname;
  if (/\/validar(?:\/|$)/.test(path)) {
    initValidacaoMode();
  } else if (/\/cidadao(?:\/|$)/.test(path)) {
    initCidadaoMode();
  }
})();

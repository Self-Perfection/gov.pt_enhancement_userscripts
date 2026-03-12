// ==UserScript==
// @name         AIMA Renovação Status Display
// @namespace    https://github.com/Self-Perfection/gov.pt_enhancement_userscripts
// @version      1.5
// @description  Показывает числовой статус заявки на продление ВНЖ на странице cidadao
// @author       Self-Perfection
// @match        https://portal-renovacoes.aima.gov.pt/ords/r/aima/aima-pr/cidadao*
// @icon         https://portal-renovacoes.aima.gov.pt/ords/r/aima/200/files/static/v59/icons/app-icon-192.png
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Self-Perfection/gov.pt_enhancement_userscripts/refs/heads/main/portal-renovacoes.aima.user.js
// @changelog    1.0 - Начальная версия: отображение числового статуса заявки в карточке
// @changelog    1.1 - MutationObserver вместо DOMContentLoaded для ожидания загрузки данных APEX
// @changelog    1.2 - Исправлен невалидный ключ dataset (дефисы → camelCase)
// @changelog    1.3 - WeakSet вместо dataset для отслеживания обработанных карточек
// @changelog    1.4 - Отключение MutationObserver после обработки всех карточек
// @changelog    1.5 - Добавлена кнопка (?) со справкой о статусах
// ==/UserScript==

(function () {
  'use strict';

  const STATUS_LABELS = {
    1: 'Регистрация',
    5: 'Заявка передана сотруднику',
    14: 'Внутренняя проверка',
    15: 'Финальный анализ',
    6: 'Одобрение',
  };

  function createStatusElement() {
    const div = document.createElement('div');
    div.className = 'a-CardView-subContent';
    div.style.marginTop = '8px';
    div.textContent = 'Загрузка статуса…';
    div.style.color = '#666';
    return div;
  }

  // Типичная последовательность статусов
  const STATUS_FLOW = [1, 5, 14, 15, 6];

  function createHelpPopup(statusValue) {
    const popup = document.createElement('div');
    popup.style.cssText =
      'display:none; position:absolute; z-index:9999; background:#fff; border:1px solid #ccc;' +
      'border-radius:8px; padding:12px 16px; box-shadow:0 4px 12px rgba(0,0,0,0.15);' +
      'font-size:13px; line-height:1.6; min-width:280px; max-width:360px; color:#333;';

    const title = document.createElement('div');
    title.textContent = 'Типичная последовательность статусов:';
    title.style.cssText = 'font-weight:bold; margin-bottom:8px;';
    popup.appendChild(title);

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
    popup.appendChild(list);

    if (!STATUS_FLOW.includes(statusValue)) {
      const note = document.createElement('div');
      note.textContent = 'Ваш статус ' + statusValue + ' не входит в типичную последовательность.';
      note.style.cssText = 'color:#856404; background:#fff3cd; padding:4px 8px; border-radius:4px; margin-bottom:8px;';
      popup.appendChild(note);
    }

    const footer = document.createElement('div');
    footer.style.cssText = 'font-size:12px; color:#666; border-top:1px solid #eee; padding-top:8px; margin-top:4px;';
    const sourceLink = document.createElement('a');
    sourceLink.href = 'https://t.me/aimairn/43114/134298';
    sourceLink.target = '_blank';
    sourceLink.textContent = 'Источник';
    sourceLink.style.cssText = 'color:#0d6efd; text-decoration:underline;';
    footer.appendChild(sourceLink);
    footer.appendChild(document.createElement('br'));

    const contactText = document.createTextNode('Если у вас нестандартный статус, напишите в ');
    footer.appendChild(contactText);
    const chatLink = document.createElement('a');
    chatLink.href = 'https://t.me/aimairn/43114/134298';
    chatLink.target = '_blank';
    chatLink.textContent = 'чате';
    chatLink.style.cssText = 'color:#0d6efd; text-decoration:underline;';
    footer.appendChild(chatLink);
    footer.appendChild(document.createTextNode(', тегнув '));
    const selfLink = document.createElement('a');
    selfLink.href = 'https://t.me/Self_Perfection';
    selfLink.target = '_blank';
    selfLink.textContent = '@Self_Perfection';
    selfLink.style.cssText = 'color:#0d6efd; text-decoration:underline;';
    footer.appendChild(selfLink);
    popup.appendChild(footer);

    return popup;
  }

  function createHelpButton(statusValue) {
    const wrapper = document.createElement('span');
    wrapper.style.cssText = 'position:relative; display:inline-block; vertical-align:middle;';

    const btn = document.createElement('button');
    btn.textContent = '?';
    btn.title = 'Справка о статусах';
    btn.style.cssText =
      'cursor:pointer; border:none; background:#6c757d; color:#fff; border-radius:50%;' +
      'width:20px; height:20px; font-size:12px; margin-left:6px; vertical-align:middle;' +
      'line-height:20px; text-align:center; padding:0;';

    const popup = createHelpPopup(statusValue);
    wrapper.appendChild(btn);
    wrapper.appendChild(popup);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        popup.style.display = 'none';
      }
    });

    return wrapper;
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
    el.textContent = message;
    el.style.color = '#dc3545';
  }

  async function processCard(cardBody) {
    const statusEl = createStatusElement();
    cardBody.appendChild(statusEl);

    // Попытка найти элемент на текущей странице
    const localEl = document.getElementById('P72_ESTADO_1');
    if (localEl) {
      const val = Number(localEl.getAttribute('data-return-value'));
      updateStatusElement(statusEl, val);
      return;
    }

    // Ищем ссылку на страницу validar внутри карточки
    const link = cardBody.querySelector('.a-CardView-subContent a');
    if (!link) {
      showError(statusEl, 'Ссылка на форму не найдена');
      return;
    }

    try {
      const response = await fetch(link.href, { credentials: 'include' });
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const remoteEl = doc.getElementById('P72_ESTADO_1');
      if (remoteEl) {
        const val = Number(remoteEl.getAttribute('data-return-value'));
        updateStatusElement(statusEl, val);
      } else {
        showError(statusEl, 'Элемент статуса не найден на странице формы');
      }
    } catch (e) {
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

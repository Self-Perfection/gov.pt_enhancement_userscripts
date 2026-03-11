// ==UserScript==
// @name         AIMA Renovação Status Display
// @namespace    https://github.com/Self-Perfection/gov.pt_enhancement_userscripts
// @version      1.1
// @description  Показывает числовой статус заявки на продление ВНЖ на странице cidadao
// @author       Self-Perfection
// @match        https://portal-renovacoes.aima.gov.pt/ords/r/aima/aima-pr/cidadao*
// @icon         https://portal-renovacoes.aima.gov.pt/ords/r/aima/200/files/static/v59/icons/app-icon-192.png
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Self-Perfection/gov.pt_enhancement_userscripts/refs/heads/main/aima_status_display.user.js
// @changelog    1.0 - Начальная версия: отображение числового статуса заявки в карточке
// @changelog    1.1 - MutationObserver вместо DOMContentLoaded для ожидания загрузки данных APEX
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

  const MARKER = 'aima-status-processed';

  function tryProcess() {
    const cards = document.querySelectorAll('.a-CardView-body');
    for (const cardBody of cards) {
      if (cardBody.dataset[MARKER]) continue;
      // Ждём пока внутри карточки появится ссылка — признак загруженных данных
      const link = cardBody.querySelector('.a-CardView-subContent a');
      if (!link) continue;
      cardBody.dataset[MARKER] = '1';
      processCard(cardBody);
    }
  }

  // Пробуем сразу (вдруг данные уже есть)
  tryProcess();

  // Наблюдаем за изменениями DOM для перехвата момента загрузки данных APEX
  const observer = new MutationObserver(tryProcess);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();

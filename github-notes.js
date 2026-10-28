/* Личные заметки к рецептам в GitHub: ac5531/recipes, ветка main.
 * Один файл notes/<имя_рецепта>.json на один рецепт.
 * Токен никогда не добавляется в репозиторий: он хранится только в браузере.
 */
(() => {
  'use strict';

  const OWNER = 'ac5531';
  const REPO = 'recipes';
  const BRANCH = 'main';
  const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/`;
  const TOKEN_KEY = 'recipes_github_notes_token_v1';

  const readLocal = key => {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  };
  const writeLocal = (key, value) => {
    try { localStorage.setItem(key, value); return true; } catch (_) { return false; }
  };
  const readSession = key => {
    try { return sessionStorage.getItem(key); } catch (_) { return null; }
  };
  const token = () => readSession(TOKEN_KEY) || readLocal(TOKEN_KEY) || '';
  const saveToken = (value, remember) => {
    try { localStorage.removeItem(TOKEN_KEY); } catch (_) { /* Недоступно. */ }
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (_) { /* Недоступно. */ }
    if (remember) {
      if (!writeLocal(TOKEN_KEY, value)) {
        try { sessionStorage.setItem(TOKEN_KEY, value); } catch (_) { /* Недоступно. */ }
      }
    } else {
      try { sessionStorage.setItem(TOKEN_KEY, value); } catch (_) { /* Недоступно. */ }
    }
  };

  function toBase64(value) {
    const bytes = new TextEncoder().encode(value);
    // Не используем btoa() напрямую с кириллицей: для неё нужна UTF-8 кодировка.
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function fromBase64(value) {
    const bytes = Uint8Array.from(atob(String(value).replace(/\s+/g, '')), c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async function request(path, { method = 'GET', body, missingIsNull = false } = {}) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (token()) headers.Authorization = `Bearer ${token()}`;
    if (body) headers['Content-Type'] = 'application/json';
    const url = API + path + (method === 'GET' ? `?ref=${encodeURIComponent(BRANCH)}` : '');
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store'
      });
    } catch (_) {
      throw new Error('Нет соединения с GitHub. Проверь интернет или открой коллекцию через localhost.');
    }
    if (response.status === 404 && missingIsNull) return null;
    if (!response.ok) {
      let ghMessage = '';
      try { ghMessage = (await response.json()).message || ''; } catch (_) { /* Нет JSON. */ }
      const message = response.status === 401 ? 'Токен недействителен или истёк. Укажи новый.' :
        response.status === 403 ? 'Доступ запрещён. Проверь права токена (Contents: Read and write) и лимиты GitHub.' :
        response.status === 409 ? 'Файл изменён на GitHub. Перезагрузи страницу, проверь заметку и попробуй ещё раз.' :
        response.status === 422 ? 'GitHub отклонил изменение файла. Обнови страницу и повтори попытку.' :
        `Ошибка GitHub (${response.status})${ghMessage ? ': ' + ghMessage : '.'}`;
      throw new Error(message);
    }
    return response.status === 204 ? null : response.json();
  }

  function parseNote(file) {
    if (!file || file.type !== 'file' || file.encoding !== 'base64') {
      throw new Error('Не удалось прочитать файл заметки.');
    }
    const data = JSON.parse(fromBase64(file.content));
    return {
      text: typeof data.text === 'string' ? data.text : '',
      title: typeof data.title === 'string' ? data.title : '',
      recipe: typeof data.recipe === 'string' ? data.recipe : '',
      updated_at: typeof data.updated_at === 'string' ? data.updated_at : '',
      sha: file.sha
    };
  }

  async function readNote(path) {
    const file = await request(path, { missingIsNull: true });
    return file ? parseNote(file) : null;
  }

  function notice(el, text, error = false) {
    if (!el) return;
    el.textContent = text;
    el.style.color = error ? '#a12b2b' : '';
  }

  function injectStyle() {
    if (document.querySelector('#github-notes-styles')) return;
    const style = document.createElement('style');
    style.id = 'github-notes-styles';
    style.textContent = `
      .gn-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:11px 0}
      .gn-button{border:0;border-radius:9px;padding:10px 15px;background:#315e45;color:#fff;
        font:700 13px/1.35 system-ui,sans-serif;cursor:pointer}
      .gn-button:disabled{opacity:.55;cursor:wait}
      .gn-link{color:#315e45;font-weight:700;text-decoration:none}
      .gn-auth{margin:12px 0;padding:10px 14px;border:1px solid #e6e6d9;border-radius:9px;background:#fff}
      .gn-auth summary{cursor:pointer;color:#315e45;font-weight:700;font-size:13px}
      .gn-auth label{display:block;font-size:13px;margin:7px 0}
      .gn-auth input[type=password]{display:block;width:100%;max-width:520px;padding:10px;margin:8px 0;
        border:1px solid #cbd5c5;border-radius:7px;font:14px system-ui,sans-serif}
      .gn-auth .gn-button{margin:6px 8px 4px 0}
      .gn-remote-button{border:1px solid #315e45;background:#edf3e7;color:#315e45}
      .gn-explain{font-size:12px;color:#6d7869;line-height:1.5}
      @media print{.gn-actions,.gn-auth{display:none!important}}
    `;
    document.head.appendChild(style);
  }

  function makeAuthPanel(onStatus) {
    const panel = document.createElement('details');
    panel.className = 'gn-auth';
    panel.innerHTML = `<summary>Настроить GitHub-токен</summary>
      <div class="gn-explain">Нужен только для записи. Создай Fine-grained token с доступом к репозиторию
      ac5531/recipes и правом Contents: Read and write. Никому не отправляй токен.</div>
      <input type="password" autocomplete="off" spellcheck="false" placeholder="Вставь github_pat_..." aria-label="Персональный GitHub-токен">
      <label><input type="checkbox" checked> Запомнить токен в этом браузере (только на личном устройстве)</label>
      <button type="button" class="gn-button gn-token-save">Сохранить токен</button>
      <button type="button" class="gn-button gn-remote-button gn-token-remove">Удалить токен с устройства</button>`;
    const input = panel.querySelector('input[type=password]');
    panel.querySelector('.gn-token-save').addEventListener('click', () => {
      const value = input.value.trim();
      if (!value) return onStatus('Вставь токен в поле выше.', true);
      saveToken(value, panel.querySelector('input[type=checkbox]').checked);
      input.value = '';
      panel.open = false;
      onStatus('Токен сохранён на этом устройстве. Теперь можно сохранять заметки.');
    });
    panel.querySelector('.gn-token-remove').addEventListener('click', () => {
      saveToken('', false);
      input.value = '';
      panel.open = false;
      onStatus('Токен удалён с устройства. Просмотр заметок доступен без него.');
    });
    return { panel, focus: () => { panel.open = true; input.focus(); } };
  }

  async function initRecipe() {
    const area = document.querySelector('.note-area');
    const block = area.closest('.local-notes') || area.parentElement;
    const status = block.querySelector('.notes-status');
    const id = document.body.dataset.recipe;
    const recipeFile = decodeURIComponent(location.pathname.split('/').pop() || '');
    if (!/^\d{2}_\d{2}_[a-z0-9_]+\.html$/.test(recipeFile) || !/^\d+$/.test(id || '')) return;
    const basename = recipeFile.slice(0, -5);
    const path = `notes/${basename}.json`;
    const syncKey = `recipes_notes_last_sync_v1_${basename}`;
    const legacyKey = `recipes_v1_1_${id}_notes`;
    const title = document.querySelector('.hero h1')?.textContent?.trim() || document.title;
    let remoteText = null;
    let remoteAvailable = false;
    let pendingLoad = null;
    let edits = 0;

    injectStyle();
    const actions = document.createElement('div');
    actions.className = 'gn-actions no-print';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'gn-button';
    save.textContent = 'Сохранить на GitHub';
    const load = document.createElement('button');
    load.type = 'button';
    load.className = 'gn-button gn-remote-button';
    load.textContent = 'Загрузить версию с GitHub';
    load.hidden = true;
    const all = document.createElement('a');
    all.href = 'notes.html';
    all.textContent = '📝 Все заметки';
    all.className = 'gn-link';
    actions.append(save, load, all);
    block.insertBefore(actions, status);
    const auth = makeAuthPanel((message, error) => notice(status, message, error));
    block.insertBefore(auth.panel, status);

    function putIntoArea(text) {
      area.value = text;
      writeLocal(legacyKey, text);
    }
    function rememberSync(text) { writeLocal(syncKey, text); }
    function showLoadButton(note) {
      pendingLoad = note;
      load.hidden = false;
    }
    load.addEventListener('click', () => {
      if (pendingLoad === null) return;
      if (area.value.trim() && area.value !== pendingLoad &&
          !window.confirm('Заменить локальный черновик версией с GitHub? Этот черновик будет перезаписан.')) return;
      putIntoArea(pendingLoad);
      rememberSync(pendingLoad);
      load.hidden = true;
      pendingLoad = null;
      notice(status, 'Заметка загружена с GitHub.');
    });

    area.addEventListener('input', () => {
      edits += 1;
      notice(status, area.value === remoteText
        ? 'Заметка совпадает с сохранённой на GitHub.'
        : 'Черновик сохранён в браузере. Для синхронизации нажми «Сохранить на GitHub».');
    });

    async function loadInitial() {
      const startingRevision = edits;
      notice(status, 'Проверяю заметку на GitHub…');
      try {
        const remote = await readNote(path);
        remoteAvailable = Boolean(remote);
        remoteText = remote?.text ?? '';
        const localText = area.value;
        const synced = readLocal(syncKey);
        if (startingRevision !== edits) {
          notice(status, 'Ты начал редактировать заметку. Автоматическая загрузка не заменит новые правки.');
          if (remoteText !== area.value) showLoadButton(remoteText);
          return;
        }
        if (localText === remoteText) {
          rememberSync(remoteText);
          notice(status, remoteAvailable ? 'Заметка загружена с GitHub.' : 'Пока нет заметки на GitHub.');
        } else if (!localText.trim() || (synced !== null && synced === localText)) {
          putIntoArea(remoteText);
          rememberSync(remoteText);
          notice(status, remoteAvailable
            ? 'Загружена актуальная заметка с GitHub.'
            : 'На GitHub заметки нет. Локальная копия обновлена.');
        } else {
          showLoadButton(remoteText);
          notice(status, remoteAvailable
            ? 'Есть локальная и GitHub-версии заметки. Локальная сохранена: выбери, какую оставить.'
            : 'Найдена прежняя заметка в этом браузере. Нажми «Сохранить на GitHub», чтобы перенести её.');
          if (!remoteAvailable) load.hidden = true;
        }
      } catch (error) {
        notice(status, 'Не удалось загрузить GitHub: ' + error.message + ' Локальный черновик сохранён.', true);
      }
    }

    save.addEventListener('click', async () => {
      if (!token()) {
        auth.focus();
        notice(status, 'Сначала добавь GitHub-токен, затем повторно нажми «Сохранить на GitHub».');
        return;
      }
      const submitted = area.value;
      save.disabled = true;
      notice(status, 'Сохраняю заметку на GitHub…');
      try {
        const latest = await readNote(path);
        const currentRemoteText = latest?.text ?? '';
        // Защита от тихого затирания заметки, обновлённой с другого устройства.
        if (remoteText !== null && currentRemoteText !== remoteText && submitted !== currentRemoteText &&
            !window.confirm('На GitHub заметка была изменена с другого устройства. Перезаписать её текущим текстом?')) {
          showLoadButton(currentRemoteText);
          notice(status, 'Сохранение отменено. Твой черновик остался в браузере.');
          return;
        }
        if (!submitted.trim()) {
          if (latest) {
            await request(path, {
              method: 'DELETE',
              body: { message: `Удалить заметку: ${title}`, sha: latest.sha, branch: BRANCH }
            });
          }
          remoteAvailable = false;
          remoteText = '';
          rememberSync('');
          notice(status, 'Заметка удалена с GitHub. В общем списке её больше нет.');
        } else {
          const json = JSON.stringify({
            title,
            recipe: recipeFile,
            text: submitted,
            updated_at: new Date().toISOString()
          }, null, 2) + '\n';
          await request(path, {
            method: 'PUT',
            body: {
              message: `${latest ? 'Обновить' : 'Добавить'} заметку: ${title}`,
              content: toBase64(json),
              ...(latest ? { sha: latest.sha } : {}),
              branch: BRANCH
            }
          });
          remoteAvailable = true;
          remoteText = submitted;
          rememberSync(submitted);
          notice(status, area.value === submitted
            ? 'Готово! Заметка сохранена на GitHub.'
            : 'Предыдущая версия сохранена на GitHub. В поле есть новые несинхронизированные изменения.');
        }
        load.hidden = true;
        pendingLoad = null;
      } catch (error) {
        notice(status, 'Не удалось сохранить на GitHub: ' + error.message + ' Текст остался в браузере.', true);
      } finally {
        save.disabled = false;
      }
    });

    await loadInitial();
  }

  function initIndex() {
    const actions = document.querySelector('.content > .actions');
    if (!actions || actions.querySelector('[href="notes.html"]')) return;
    const link = document.createElement('a');
    link.href = 'notes.html';
    link.className = 'navlink';
    link.textContent = '📝 Все заметки →';
    actions.appendChild(link);
  }

  async function initAllNotes() {
    const root = document.querySelector('#all-notes');
    const status = document.querySelector('#all-notes-status');
    const refresh = document.querySelector('#refresh-notes');
    const panelHolder = document.querySelector('#notes-settings');
    if (panelHolder) {
      injectStyle();
      const auth = makeAuthPanel((message, error) => notice(status, message, error));
      panelHolder.appendChild(auth.panel);
    }
    const show = async () => {
      root.replaceChildren();
      notice(status, 'Загружаю все заметки с GitHub…');
      if (refresh) refresh.disabled = true;
      try {
        const entries = await request('notes', { missingIsNull: true });
        if (entries === null) {
          notice(status, 'Пока нет заметок. Добавь первую заметку в любом рецепте.');
          return;
        }
        if (!Array.isArray(entries)) throw new Error('Папка notes должна быть папкой, а не файлом.');
        const noteFiles = entries.filter(item => item.type === 'file' &&
          /^\d{2}_\d{2}_[a-z0-9_]+\.json$/.test(item.name)).sort((a, b) => a.name.localeCompare(b.name));
        const results = await Promise.all(noteFiles.map(async entry => {
          try {
            const note = await readNote('notes/' + entry.name);
            if (!note || !note.text.trim()) return null;
            const recipe = entry.name.replace(/\.json$/, '.html');
            return { ...note, recipe }; // имя файла — доверенный источник ссылки
          } catch (error) {
            return { error: `${entry.name}: ${error.message}` };
          }
        }));
        let count = 0;
        let failures = 0;
        results.forEach(item => {
          if (!item) return;
          if (item.error) { failures += 1; return; }
          const li = document.createElement('li');
          li.className = 'gn-note-card';
          const a = document.createElement('a');
          a.href = item.recipe;
          a.textContent = item.title || item.recipe.replace(/\.html$/, '');
          const p = document.createElement('p');
          p.textContent = item.text;
          li.append(a, p);
          root.appendChild(li);
          count += 1;
        });
        if (failures) {
          notice(status, `Показано ${count} заметок. Не удалось прочитать ${failures}: обнови страницу и проверь файлы.`, true);
        } else {
          notice(status, count ? `Заметок: ${count}. Показаны только рецепты с непустыми заметками.`
            : 'Пока нет заметок. Добавь первую заметку в любом рецепте.');
        }
      } catch (error) {
        notice(status, `Не удалось получить список заметок: ${error.message}`, true);
      } finally {
        if (refresh) refresh.disabled = false;
      }
    };
    if (refresh) refresh.addEventListener('click', show);
    await show();
  }

  if (document.querySelector('.note-area') && document.body.dataset.recipe) {
    void initRecipe();
  } else if (document.querySelector('#all-notes')) {
    void initAllNotes();
  } else if (document.querySelector('.content > .actions')) {
    initIndex();
  }
})();

/**
 * Личные рецепты · Google Apps Script + Google Drive
 * Версия: 2026-10-28. Содержимое коллекции импортируется ОДИН раз
 * из публичного исходного репозитория; после импорта GitHub не нужен.
 *
 * Инструкция: см. README-УСТАНОВКА.txt
 */

const RECIPES_APP_BUILD = '2026-10-28-fast-v2-sync-button';

const RECIPES_CONFIG = Object.freeze({
  source: 'https://raw.githubusercontent.com/ac5531/recipes/main/',
  rootFolder: 'Мои рецепты — веб-приложение',
  siteFolder: 'Сайт',
  notesFolder: 'Заметки',
  folderIdProperty: 'PERSONAL_RECIPES_DRIVE_ROOT_ID',
  siteVersionProperty: 'PERSONAL_RECIPES_SITE_VERSION',
  pageCacheSeconds: 21600, // до 6 часов; данные после обновления исходников сбрасываются по версии
  pageNames: [
    'index.html',
    '01_01_tortilya.html', '02_02_burger.html',
    '03_03_frittata.html', '04_04_choco_oats.html',
    '05_05_blinchiki.html', '06_06_rosti.html',
    '07_07_khachapuri.html', '08_08_tvorog_oats.html',
    '09_09_hot_toast.html', '10_10_omelet_roll.html',
    '11_11_creamy_chicken.html', '12_12_cheeseburger_bowl.html',
    '13_13_creamy_pasta.html', '14_14_quesadilla.html',
    '15_15_teriyaki_beef.html', '16_16_meatballs.html',
    '17_17_shawarma.html', '18_18_kofte.html',
    '19_19_schnitzel.html', '20_20_honey_mustard.html',
    'changes.html', 'guide.html', 'nutrition_basis.html'
  ],
  assetNames: ['breakfast.css', 'breakfast.js', 'portions.js']
});

/**
 * Запустить ОДИН РАЗ из редактора Apps Script до публикации.
 * Создаёт папки на Google Диске и копирует исходные HTML/CSS/JS.
 * Повторный запуск обновляет исходники сайта, но НЕ удаляет заметки.
 */
function setupRecipes() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const files = RECIPES_CONFIG.pageNames.concat(RECIPES_CONFIG.assetNames);
    const newContents = {};
    // Забираем небольшими параллельными пачками; не зависим от CDN при работе сайта.
    for (let offset = 0; offset < files.length; offset += 4) {
      const names = files.slice(offset, offset + 4);
      const batch = names.map(name => ({
        url: RECIPES_CONFIG.source + encodeURIComponent(name) + '?import=' + Date.now(),
        method: 'get', muteHttpExceptions: true,
        headers: {'Accept': 'text/plain', 'Cache-Control': 'no-cache'}
      }));
      const responses = UrlFetchApp.fetchAll(batch);
      responses.forEach((response, i) => {
        const code = response.getResponseCode();
        if (code !== 200) throw new Error('Не удалось импортировать ' + names[i] + ': HTTP ' + code);
        const value = response.getContentText('UTF-8');
        if (value.length < 80) throw new Error('Подозрительно короткий файл: ' + names[i]);
        if (names[i].endsWith('.html') && !/<html\b/i.test(value)) {
          throw new Error('Получен не HTML для ' + names[i]);
        }
        newContents[names[i]] = value;
      });
    }
    const root = getRootFolder_(true);
    const site = findOrCreateChild_(root, RECIPES_CONFIG.siteFolder);
    findOrCreateChild_(root, RECIPES_CONFIG.notesFolder);
    files.forEach(name => {
      const existing = site.getFilesByName(name);
      if (existing.hasNext()) {
        existing.next().setContent(newContents[name]);
      } else {
        site.createFile(name, newContents[name], fileMime_(name));
      }
    });
    // Обновляем версию только после успешной записи всех файлов.
    // Новая версия автоматически обходит предыдущий кэш страниц.
    refreshSiteCache();
    const result = 'Готово: импортировано/обновлено ' + files.length +
      ' файлов. Папка в Google Drive: ' + root.getUrl() +
      '. Заметки хранятся отдельно и не менялись.';
    Logger.log(result);
    return result;
  } finally {
    lock.releaseLock();
  }
}

/** Повторный импорт HTML/CSS/JS из GitHub, если ты изменил рецепты там. */
function updateRecipesFromGitHub() {
  return setupRecipes();
}

/**
 * При обычном открытии берём уже собранный HTML из CacheService.
 * Из Google Drive читаем исходники только при первом запросе/промахе кэша.
 * Страницы содержат актуальный JS/CSS; заметки по-прежнему живые и отдельно.
 */
function doGet(e) {
  try {
    const requested = (e && e.parameter && e.parameter.page) || 'index.html';
    if (requested !== 'notes' && RECIPES_CONFIG.pageNames.indexOf(requested) === -1) {
      return HtmlService.createHtmlOutput(errorHtml_('Страница не найдена.'))
        .setTitle('Страница не найдена');
    }
    const version = getSiteVersion_();
    const html = renderCachedPage_(requested, version, function () {
      if (requested === 'notes') return renderAllNotesPage_(version);
      const site = getSiteFolder_(false);
      const original = readTextFile_(site, requested);
      const appUrl = ScriptApp.getService().getUrl();
      if (!appUrl) throw new Error('Сначала опубликуй веб-приложение через Deploy.');
      return convertPage_(original, requested, site, appUrl, version);
    });
    return HtmlService.createHtmlOutput(html)
      .setTitle(requested === 'notes' ? 'Мои заметки · рецепты' : 'Мои рецепты')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (err) {
    return HtmlService.createHtmlOutput(errorHtml_(String(err.message || err)))
      .setTitle('Ошибка загрузки рецептов');
  }
}

/**
 * Если напрямую исправлял HTML в папке «Сайт» на Google Диске,
 * запусти эту функцию в редакторе. После импорта из GitHub выполняется сама.
 * Не удаляет файлы, не затрагивает заметки и не требует новой ссылки.
 */
function refreshSiteCache() {
  const version = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty(RECIPES_CONFIG.siteVersionProperty, version);
  Logger.log('Кэш страниц обновлён. Версия: ' + version);
  return version;
}

function getSiteVersion_() {
  return PropertiesService.getScriptProperties().getProperty(RECIPES_CONFIG.siteVersionProperty) || 'initial';
}

/**
 * Кэшируем HTML частями по 16 тыс. символов, поскольку у CacheService
 * ограничение 100 КБ на один ключ. Если Google очистил часть кэша досрочно,
 * безопасно восстанавливаем страницу из Google Drive.
 */
function renderCachedPage_(page, version, render) {
  const key = 'recipes:page:' + RECIPES_APP_BUILD + ':' + version + ':' + page;
  let cache = null;
  try {
    cache = CacheService.getScriptCache();
    const count = Number(cache.get(key + ':count'));
    if (Number.isInteger(count) && count > 0 && count <= 100) {
      const keys = [];
      for (let i = 0; i < count; i++) keys.push(key + ':' + i);
      const parts = cache.getAll(keys);
      if (keys.every(k => Object.prototype.hasOwnProperty.call(parts, k))) {
        return keys.map(k => parts[k]).join('');
      }
    }
  } catch (err) {
    Logger.log('Кэш страниц недоступен, загрузка напрямую: ' + err);
  }
  const html = render();
  if (cache) {
    try {
      const pieces = {};
      let count = 0;
      for (let offset = 0; offset < html.length; offset += 16000) {
        pieces[key + ':' + count] = html.slice(offset, offset + 16000);
        count++;
      }
      if (count > 0 && count <= 100) {
        cache.putAll(pieces, RECIPES_CONFIG.pageCacheSeconds);
        // Счётчик записываем последним: неполная запись не считается попаданием.
        cache.put(key + ':count', String(count), RECIPES_CONFIG.pageCacheSeconds);
      }
    } catch (err) {
      Logger.log('Не удалось заполнить кэш: ' + err);
    }
  }
  return html;
}

/** Получить одну заметку. Вызывается из HTML через google.script.run. */
function readRecipeNote(recipe) {
  verifyRecipe_(recipe);
  const folder = getNotesFolder_(false);
  if (!folder) return {recipe: recipe, text: '', revision: '', updatedAt: ''};
  const file = findFirstFile_(folder, noteFileName_(recipe));
  if (!file) return {recipe: recipe, text: '', revision: '', updatedAt: ''};
  const note = decodeNote_(file);
  return {
    recipe: recipe,
    title: note.title || '',
    text: note.text || '',
    revision: note.revision || '',
    updatedAt: note.updatedAt || ''
  };
}

/**
 * Записать/удалить одну заметку. Пустой текст => удаление файла.
 * revision защищает от случайной перезаписи на разных устройствах.
 */
function saveRecipeNote(recipe, title, text, expectedRevision) {
  verifyRecipe_(recipe);
  if (typeof text !== 'string' || text.length > 50000) {
    throw new Error('Текст заметки должен быть строкой не длиннее 50 000 символов.');
  }
  const cleanTitle = String(title || recipe).trim().slice(0, 250) || recipe;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const folder = getNotesFolder_(true);
    const file = findFirstFile_(folder, noteFileName_(recipe));
    const previous = file ? decodeNote_(file) : null;
    const actualRevision = previous ? String(previous.revision || '') : '';
    if (String(expectedRevision || '') !== actualRevision) {
      throw new Error('Заметка уже изменена на другом устройстве. Скопируй свой текст и обнови страницу перед повторным сохранением.');
    }
    if (!text.trim()) {
      if (file) file.setTrashed(true);
      clearNotesListCache_();
      return {recipe: recipe, title: cleanTitle, text: '', revision: '', updatedAt: ''};
    }
    const note = {
      recipe: recipe,
      title: cleanTitle,
      text: text,
      updatedAt: new Date().toISOString(),
      revision: Utilities.getUuid()
    };
    const serialized = JSON.stringify(note, null, 2);
    if (file) file.setContent(serialized);
    else folder.createFile(noteFileName_(recipe), serialized, 'application/json');
    clearNotesListCache_();
    return note;
  } finally {
    lock.releaseLock();
  }
}

/** Список только непустых заметок, в порядке рецептов. */
function listRecipeNotes() {
  const cacheKey = 'recipes:notes:list:v1';
  try {
    const cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (err) { Logger.log('Кэш заметок недоступен: ' + err); }
  const folder = getNotesFolder_(false);
  if (!folder) return [];
  const collected = {};
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const filename = file.getName();
    if (!/\.json$/.test(filename)) continue;
    try {
      const note = decodeNote_(file);
      if (note && typeof note.text === 'string' && note.text.trim() &&
          RECIPES_CONFIG.pageNames.indexOf(note.recipe) >= 0 &&
          /^\d\d_\d\d_/.test(note.recipe)) {
        collected[note.recipe] = {
          recipe: note.recipe,
          title: String(note.title || note.recipe),
          text: note.text,
          updatedAt: String(note.updatedAt || '')
        };
      }
    } catch (err) {
      Logger.log('Пропущен некорректный файл заметки ' + filename + ': ' + err);
    }
  }
  const results = RECIPES_CONFIG.pageNames.filter(name => Object.prototype.hasOwnProperty.call(collected, name))
    .map(name => collected[name]);
  try {
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(results), 1200);
  } catch (err) { Logger.log('Не удалось кэшировать список заметок: ' + err); }
  return results;
}

function clearNotesListCache_() {
  try { CacheService.getScriptCache().remove('recipes:notes:list:v1'); }
  catch (err) { Logger.log('Не удалось сбросить кэш списка заметок: ' + err); }
}

/** По желанию: импорт уже сохранённых публичных notes/*.json из GitHub. */
function importExistingGithubNotes() {
  const url = 'https://api.github.com/repos/ac5531/recipes/contents/notes';
  const response = UrlFetchApp.fetch(url, {muteHttpExceptions: true,
    headers: {'Accept':'application/vnd.github+json', 'User-Agent':'Personal-Recipes-Importer'}});
  if (response.getResponseCode() === 404) {
    Logger.log('На GitHub пока нет папки notes: импортировать нечего.');
    return 'На GitHub нет папки notes: импортировать нечего.';
  }
  if (response.getResponseCode() !== 200) throw new Error('Ошибка чтения GitHub: HTTP ' + response.getResponseCode());
  const entries = JSON.parse(response.getContentText('UTF-8'));
  const folder = getNotesFolder_(true);
  let imported = 0;
  entries.forEach(entry => {
    if (!entry || entry.type !== 'file' || !entry.name.endsWith('.json')) return;
    const recipe = entry.name.replace(/\.json$/, '') + '.html';
    if (RECIPES_CONFIG.pageNames.indexOf(recipe) === -1) return;
    if (findFirstFile_(folder, entry.name)) return; // существующие заметки Drive не перезаписываем
    const detail = UrlFetchApp.fetch(entry.download_url, {muteHttpExceptions: true});
    if (detail.getResponseCode() !== 200) return;
    try {
      const old = JSON.parse(detail.getContentText('UTF-8'));
      if (typeof old.text !== 'string' || !old.text.trim()) return;
      const fresh = {
        recipe: recipe, title: String(old.title || recipe), text: old.text,
        updatedAt: new Date().toISOString(), revision: Utilities.getUuid()
      };
      folder.createFile(entry.name, JSON.stringify(fresh, null, 2), 'application/json');
      imported++;
    } catch (err) {
      Logger.log('Пропущен ' + entry.name + ': ' + err);
    }
  });
  Logger.log('Импортировано из GitHub: ' + imported);
  return 'Импортировано из GitHub: ' + imported;
}

// ------------------------------ Drive helpers -------------------------------

function getRootFolder_(create) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(RECIPES_CONFIG.folderIdProperty);
  if (id) return DriveApp.getFolderById(id);
  if (!create) {
    throw new Error('Коллекция ещё не загружена. В редакторе Apps Script запусти функцию setupRecipes.');
  }
  const folder = DriveApp.getRootFolder().createFolder(RECIPES_CONFIG.rootFolder);
  props.setProperty(RECIPES_CONFIG.folderIdProperty, folder.getId());
  return folder;
}
function findOrCreateChild_(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}
function getSiteFolder_(create) {
  const root = getRootFolder_(Boolean(create));
  if (create) return findOrCreateChild_(root, RECIPES_CONFIG.siteFolder);
  const matches = root.getFoldersByName(RECIPES_CONFIG.siteFolder);
  if (!matches.hasNext()) throw new Error('Нет папки «Сайт». Повтори setupRecipes.');
  return matches.next();
}
function getNotesFolder_(create) {
  const root = getRootFolder_(Boolean(create));
  if (create) return findOrCreateChild_(root, RECIPES_CONFIG.notesFolder);
  const matches = root.getFoldersByName(RECIPES_CONFIG.notesFolder);
  return matches.hasNext() ? matches.next() : null;
}
function findFirstFile_(folder, name) {
  const matches = folder.getFilesByName(name);
  return matches.hasNext() ? matches.next() : null;
}
function readTextFile_(folder, name) {
  const file = findFirstFile_(folder, name);
  if (!file) throw new Error('На Google Диске нет файла ' + name + '. Запусти setupRecipes.');
  return file.getBlob().getDataAsString('UTF-8');
}
function decodeNote_(file) {
  const parsed = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
  if (!parsed || typeof parsed !== 'object') throw new Error('Неправильный формат заметки.');
  return parsed;
}
function fileMime_(name) {
  if (name.endsWith('.html')) return 'text/html';
  if (name.endsWith('.css')) return 'text/css';
  if (name.endsWith('.js')) return 'application/javascript';
  return 'text/plain';
}
function verifyRecipe_(name) {
  if (typeof name !== 'string' || !/^\d\d_\d\d_[a-z_]+\.html$/.test(name) ||
      RECIPES_CONFIG.pageNames.indexOf(name) === -1) {
    throw new Error('Неизвестный рецепт: ' + name);
  }
}
function noteFileName_(recipe) {
  return recipe.replace(/\.html$/, '.json');
}
function escapeHtml_(value) {
  return String(value).replace(/[&<>"']/g, function (m) {
    return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[m];
  });
}
function errorHtml_(errorText) {
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="font:16px/1.6 system-ui;max-width:700px;margin:50px auto;padding:20px;color:#314b37">' +
    '<h1>Не удалось открыть рецепты</h1><p>' + escapeHtml_(errorText) + '</p></body></html>';
}

// ------------------------- HTML transformation -------------------------------

function convertPage_(source, name, site, appUrl, version) {
  let html = source;
  const siteVersion = encodeURIComponent(version);
  // Любая ссылка на внутреннюю .html-страницу ведёт обратно в наше веб-приложение.
  html = html.replace(/\bhref\s*=\s*(["'])([^"'?#]+\.html)(?:\?[^"'#]*)?(#[^"']*)?\1/gi,
    function (original, quote, link, hash) {
      if (RECIPES_CONFIG.pageNames.indexOf(link) < 0) return original;
      return 'href=' + quote + appUrl + '?page=' + encodeURIComponent(link) + '&v=' + siteVersion + (hash || '') + quote;
    });
  // CSS хранится на Google Диске. Встраиваем в HTML: внешнее кэширование исключено.
  html = html.replace(/<link\b(?=[^>]*\bhref\s*=\s*["']breakfast\.css(?:\?[^"']*)?["'])[^>]*\/?\s*>/gi,
    function () { return '<style data-recipes-source="breakfast.css">' + readTextFile_(site, 'breakfast.css') + '</style>'; });
  // JS тоже встраиваем при каждом открытии, чтобы не требовался Ctrl+F5.
  html = html.replace(/<script\b([^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*)>\s*<\/script\s*>/gi,
    function (original, attrs, src) {
      const simple = src.split('?')[0].split('#')[0];
      if (simple === 'github-notes.js') return ''; // старое подключение GitHub удаляем
      if (simple !== 'breakfast.js' && simple !== 'portions.js') return original;
      let js = readTextFile_(site, simple);
      // Убираем старый динамический загрузчик github-notes.js, не меняя расчёты.
      js = js.replace(/\/\/ Дополнение: заметки в GitHub[\s\S]*$/m, '');
      return '<script data-recipes-source="' + simple + '">\n' + js.replace(/<\/script/gi, '<\\/script') + '\n</script>';
    });
  // Вызовы старого Github Notes отсутствуют, но HTML заметок и localStorage остаются.
  const header = '<base target="_top"><meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">';
  html = html.replace(/<head\b([^>]*)>/i, '<head$1>' + header);
  const bridge = '<script data-google-recipes-bridge>\n' +
    buildClientBridge_(name, appUrl, version) + '\n</script>';
  if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, bridge + '</body>');
  else html += bridge;
  return html;
}

function buildClientBridge_(name, appUrl, version) {
  // Строка JS в отдельном блоке: легко тестировать и переиспользовать.
  return 'window.RECIPES_APP_URL=' + JSON.stringify(appUrl) + ';\n' +
    'window.RECIPES_PAGE=' + JSON.stringify(name) + ';\n' +
    'window.RECIPES_SITE_VERSION=' + JSON.stringify(version) + ';\n' +
    CLIENT_BRIDGE_SOURCE;
}

const CLIENT_BRIDGE_SOURCE = String.raw`
(function () {
  'use strict';
  var appUrl = window.RECIPES_APP_URL;
  var page = window.RECIPES_PAGE;
  var version = encodeURIComponent(window.RECIPES_SITE_VERSION || 'initial');
  function urlFor(pageName) {
    return appUrl + '?page=' + encodeURIComponent(pageName) + '&v=' + version;
  }
  // Перехватываем и те ссылки, которые создаются динамически JavaScript.
  document.addEventListener('click', function (event) {
    var a = event.target.closest ? event.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var file = href.split(/[?#]/)[0];
    if (/^(?:index|changes|guide|nutrition_basis|\d\d_\d\d_[a-z_]+)\.html$/.test(file)) {
      a.href = urlFor(file);
      a.target = '_top';
    }
  }, true);

  function notesLink() {
    var a = document.createElement('a');
    a.href = urlFor('notes');
    a.target = '_top';
    a.className = 'gas-notes-link';
    a.textContent = '📝 Все заметки';
    return a;
  }
  var style = document.createElement('style');
  style.textContent = '.gas-notes-tools{margin:12px 0;display:flex;align-items:center;gap:13px;flex-wrap:wrap}' +
    '.gas-notes-button{background:#315e45;color:#fff;border:0;border-radius:9px;padding:10px 16px;font:700 13px system-ui;cursor:pointer}' +
    '.gas-notes-button:disabled{opacity:.58;cursor:wait}' +
    '.gas-notes-link{color:#315e45;font-weight:700;text-decoration:none}' +
    '.gas-notes-status{display:block;font-size:13px;color:#6d7869;margin:7px 0 0;min-height:20px}' +
    '.gas-update-button{background:#edf3e7;color:#315e45;border:1px solid #d6e1d3;border-radius:9px;padding:10px 16px;font:700 13px system-ui;cursor:pointer}' +
    '.gas-update-button:hover{background:#e0edda}' +
    '.gas-update-button:disabled{opacity:.55;cursor:wait}' +
    '.gas-update-status{width:100%;font:13px/1.6 system-ui;color:#6d7869;margin:-9px 0 19px;min-height:0}' +
    '.gas-update-status a{margin-left:6px}' +
    '@media print{.gas-notes-tools,.gas-notes-status,.gas-update-button,.gas-update-status{display:none!important}}';
  document.head.appendChild(style);
  if (page === 'index.html') {
    // Кнопка находится на главной странице. Сам импорт выполняется в Apps Script.
    // С сайта не требуется GitHub-токен и повторное развёртывание для новых рецептов.
    var spot = document.querySelector('.actions') || document.querySelector('.content') || document.body;
    if (spot) {
      spot.appendChild(notesLink());
      var updateButton = document.createElement('button');
      updateButton.type = 'button';
      updateButton.className = 'gas-update-button no-print';
      updateButton.textContent = '↻ Обновить рецепты';
      spot.appendChild(updateButton);
      var updateStatus = document.createElement('div');
      updateStatus.className = 'gas-update-status no-print';
      updateStatus.setAttribute('role', 'status');
      updateStatus.setAttribute('aria-live', 'polite');
      if (spot.insertAdjacentElement) spot.insertAdjacentElement('afterend', updateStatus);
      else spot.appendChild(updateStatus);
      updateButton.addEventListener('click', function () {
        if (updateButton.disabled) return;
        if (!window.google || !google.script || !google.script.run) {
          updateStatus.textContent = 'Обновление доступно только на сайте Google Apps Script.';
          return;
        }
        updateButton.disabled = true;
        updateButton.textContent = '↻ Обновляем…';
        updateStatus.style.color = '#6d7869';
        updateStatus.textContent = 'Загружаем обновлённые рецепты из GitHub на Google Диск. Не закрывай эту вкладку до завершения.';
        google.script.run.withSuccessHandler(function () {
          updateButton.disabled = false;
          updateButton.textContent = '↻ Обновить рецепты';
          updateStatus.style.color = '#315e45';
          updateStatus.textContent = '✓ Рецепты обновлены, кэш сброшен.';
          var link = document.createElement('a');
          link.href = appUrl + '?page=index.html&refresh=' + Date.now();
          link.target = '_top';
          link.textContent = 'Открыть обновлённую коллекцию →';
          updateStatus.appendChild(link);
        }).withFailureHandler(function (err) {
          updateButton.disabled = false;
          updateButton.textContent = '↻ Обновить рецепты';
          updateStatus.style.color = '#ac3333';
          updateStatus.textContent = 'Не удалось обновить рецепты: ' +
            (err && err.message ? err.message : String(err));
        }).updateRecipesFromGitHub();
      });
    }
  }
  var input = document.querySelector('.note-area');
  if (!input) return;
  var oldStatus = document.querySelector('.notes-status');
  if (oldStatus) oldStatus.style.display = 'none';
  var tools = document.createElement('div');
  tools.className = 'gas-notes-tools no-print';
  var save = document.createElement('button');
  save.type = 'button'; save.className = 'gas-notes-button';
  save.textContent = 'Сохранить заметку';
  tools.appendChild(save); tools.appendChild(notesLink());
  var status = document.createElement('div');
  status.className = 'gas-notes-status'; status.setAttribute('role', 'status');
  status.textContent = 'Загрузка заметки с Google Диска…';
  input.insertAdjacentElement('afterend', tools);
  tools.insertAdjacentElement('afterend', status);
  var dirty = false;
  var loaded = false;
  var revision = '';
  var inFlight = false;
  var titleEl = document.querySelector('h1');
  var title = titleEl ? titleEl.textContent.trim() : page;
  input.addEventListener('input', function () {
    dirty = true;
    if (!inFlight) status.textContent = 'Есть несохранённые изменения — нажми «Сохранить заметку».';
  });
  function fail(err) {
    inFlight = false;
    save.disabled = false;
    status.style.color = '#ac3333';
    status.textContent = 'Ошибка: ' + (err && err.message ? err.message : String(err));
  }
  if (!window.google || !google.script || !google.script.run) {
    status.textContent = 'Этот сайт нужно открыть по ссылке Google Apps Script.';
    save.disabled = true;
    return;
  }
  google.script.run.withSuccessHandler(function (data) {
    loaded = true;
    revision = data.revision || '';
    if (!dirty) {
      // При первом открытии берем синхронизированную версию с Google Диска.
      // Если её нет, сохраняем непустой локальный черновик (если он был).
      if (data.text) input.value = data.text;
      else if (!input.value.trim()) input.value = '';
    }
    status.style.color = '#6d7869';
    status.textContent = data.text
      ? 'Заметка загружена с Google Диска. Изменения сохраняются кнопкой ниже.'
      : (input.value.trim() ? 'Есть локальный черновик. Нажми «Сохранить заметку», чтобы перенести его на Google Диск.' :
        'Заметки пока нет. После сохранения она будет доступна на всех устройствах.');
  }).withFailureHandler(fail).readRecipeNote(page);

  save.addEventListener('click', function () {
    if (!loaded) {
      status.textContent = 'Подожди загрузки предыдущей версии заметки.';
      return;
    }
    if (inFlight) return;
    inFlight = true;
    var content = input.value;
    save.disabled = true;
    status.style.color = '#6d7869';
    status.textContent = 'Сохранение на Google Диск…';
    google.script.run.withSuccessHandler(function (result) {
      loaded = true;
      inFlight = false;
      save.disabled = false;
      revision = result.revision || '';
      dirty = input.value !== content;
      status.style.color = '#315e45';
      status.textContent = dirty ? 'Сохранена предыдущая версия. Сохрани последние изменения ещё раз.' :
        (result.text ? '✓ Сохранено на Google Диске. Заметка доступна на всех устройствах.' :
          '✓ Пустая заметка удалена. В общем списке её больше нет.');
    }).withFailureHandler(fail).saveRecipeNote(page, title, content, revision);
  });
})();
`;

function renderAllNotesPage_(version) {
  const url = ScriptApp.getService().getUrl();
  if (!url) throw new Error('Сначала разверни веб-приложение.');
  // Этот экран полностью генерируется Apps Script, без прежнего github-notes.js.
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><base target="_top">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<title>Все мои заметки</title><style>
:root{--green:#315e45;--ink:#273326;--line:#e6e6d9;--muted:#6d7869}
*{box-sizing:border-box}body{margin:0;background:#eeeee6;color:var(--ink);font:16px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif}
.page{max-width:930px;margin:35px auto;background:#fffdf8;box-shadow:0 18px 60px #242d231c;border-radius:18px;overflow:hidden}
.hero{background:linear-gradient(123deg,#183a2a,#3e684b);color:white;padding:45px 60px 38px}
.eyebrow{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#d6e6c8;font-weight:800}
h1{font:700 clamp(32px,5vw,51px)/1.12 Georgia,serif;margin:14px 0}
.hero p{color:#e4eddf;margin:0}.content{padding:35px 60px 54px}
.actions{display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-bottom:27px}
a{color:var(--green);text-decoration:none;font-weight:700}.btn{background:var(--green);color:white;border:0;border-radius:9px;padding:10px 18px;font-weight:700;cursor:pointer}
.status{font-size:14px;color:var(--muted);min-height:24px}
#notes-list{padding:0;margin:0;list-style:none}
.note-item{border:1px solid var(--line);background:white;border-radius:12px;padding:18px 21px;margin:12px 0}
.note-item a{font:700 22px/1.3 Georgia,serif}.note-item p{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0 0}
@media(max-width:650px){.page{margin:0;border-radius:0}.hero{padding:35px 25px}.content{padding:25px}.note-item a{font-size:20px}}
</style></head><body><main class="page"><header class="hero"><div class="eyebrow">Персональная коллекция · после готовки</div>
<h1>📝 Все мои заметки</h1><p>Здесь только те рецепты, к которым есть записи.</p></header>
<div class="content"><div class="actions"><a id="back-link" href="#">← Ко всем 20 рецептам</a>
<button id="refresh" type="button" class="btn">Обновить список</button></div>
<div id="status" class="status" role="status">Загрузка…</div><ol id="notes-list"></ol></div></main>
<script>
(function(){
'use strict';
var appUrl=${JSON.stringify(url)};
var siteVersion=${JSON.stringify(version || getSiteVersion_())};
function go(page){return appUrl+'?page='+encodeURIComponent(page)+'&v='+encodeURIComponent(siteVersion);}
var back=document.getElementById('back-link');back.href=go('index.html');back.target='_top';
var out=document.getElementById('notes-list'),status=document.getElementById('status');
function refresh(){
 status.textContent='Загрузка заметок с Google Диска…';out.textContent='';
 google.script.run.withSuccessHandler(function(notes){
  status.style.color='';
  if(!notes.length){status.textContent='Заметок пока нет. Они появятся здесь после первого сохранения.';return;}
  status.textContent='Заметок: '+notes.length;
  notes.forEach(function(n){
   var li=document.createElement('li');li.className='note-item';
   var a=document.createElement('a');a.href=go(n.recipe);a.target='_top';a.textContent=n.title;
   var p=document.createElement('p');p.textContent=n.text;
   li.appendChild(a);li.appendChild(p);out.appendChild(li);
  });
 }).withFailureHandler(function(err){
  status.style.color='#b33';status.textContent='Ошибка загрузки: '+(err.message||String(err));
 }).listRecipeNotes();
}
document.getElementById('refresh').addEventListener('click',refresh);refresh();
})();
</script></body></html>`;
}

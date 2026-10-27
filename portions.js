/* Единственное дополнение к коллекции: пересчёт ингредиентов и КБЖУ по числу порций с шагом 0,5. */
(function () {
  'use strict';

  const statsNumber = document.querySelector('.stats .stat:first-child strong');
  const statsLabel = document.querySelector('.stats .stat:first-child span');
  const ingredients = document.querySelector('.ingredients');
  if (!statsNumber || !ingredients) return;

  const originalCount = Number(statsNumber.textContent.trim().replace(',', '.'));
  if (!(originalCount > 0)) return;

  const ruNumber = new Intl.NumberFormat('ru-RU', {
    useGrouping: false, maximumFractionDigits: 4
  });
  const format = value => ruNumber.format(Math.round((value + Number.EPSILON) * 10000) / 10000);
  const parse = text => Number(String(text).replace(',', '.'));
  const originalLabel = statsLabel ? statsLabel.textContent : '';

  // Запоминаем исходные значения: каждое новое количество пересчитывается от оригинала.
  const ingredientAmounts = [...document.querySelectorAll('.ingredients .amount')]
    .map(el => ({el, original: el.textContent}));
  const portionsInNames = [
    ...document.querySelectorAll('.ingredients .check label span'),
    ...document.querySelectorAll('table.nutrition td.ingname')
  ].map(el => ({el, node: el.firstChild, original: el.firstChild ? el.firstChild.textContent : ''}))
    .filter(item => /\d+(?:[.,]\d+)?\s*×\s*\d+(?:[.,]\d+)?\s*г/.test(item.original));

  const tables = document.querySelectorAll('table.nutrition');
  const overallValues = tables[0] ? [...tables[0].querySelectorAll('tbody tr')].map(row => {
    const cells = row.querySelectorAll('td');
    return cells.length >= 3 ? {el: cells[2], original: cells[2].textContent, isCalories: /калор/i.test(cells[0].textContent)} : null;
  }).filter(Boolean) : [];
  const detailedValues = tables[1] ? [...tables[1].querySelectorAll('tbody tr')].flatMap(row =>
    [...row.querySelectorAll('td')].slice(1).map(el => ({el, original: el.textContent}))
  ) : [];

  const scaleText = (source, multiplier, decimals) => {
    if (multiplier === 1) return source;
    return source.replace(/^(\s*≈?\s*)(\d+(?:[.,]\d+)?)(.*)$/s, (_, prefix, number, suffix) => {
      const result = parse(number) * multiplier;
      const displayed = decimals === undefined ? format(result) :
        new Intl.NumberFormat('ru-RU', {useGrouping: false, maximumFractionDigits: decimals}).format(result);
      return prefix + displayed + suffix;
    });
  };

  const style = document.createElement('style');
  style.textContent = `
    .rp-portions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:15px 0 19px}
    .rp-portions label{font-weight:700;color:var(--green)}
    .rp-portions button{min-width:36px;height:36px;padding:0 8px;border:1px solid var(--line);border-radius:9px;background:var(--lime);color:var(--green);font-size:21px;font-weight:700;cursor:pointer}
    .rp-portions button:hover{background:#e0ead8}
    .rp-portions button:disabled{opacity:.45;cursor:default}
    .rp-portions input{width:77px;height:36px;border:1px solid #cbd5c5;border-radius:9px;background:#fff;color:var(--ink);font:600 16px system-ui,sans-serif;text-align:center;padding:4px}
    .rp-portions .rp-hint{font-size:13px;color:var(--muted)}
    @media print{.rp-portions{display:none!important}}
  `;
  document.head.appendChild(style);

  const controls = document.createElement('div');
  controls.className = 'rp-portions no-print';
  controls.innerHTML = '<label for="rp-portion-input">Количество порций:</label>' +
    '<button type="button" class="rp-minus" aria-label="Уменьшить количество порций на половину">−</button>' +
    '<input id="rp-portion-input" type="number" min="0.5" step="0.5" inputmode="decimal" aria-label="Количество порций">' +
    '<button type="button" class="rp-plus" aria-label="Увеличить количество порций на половину">+</button>' +
    '<span class="rp-hint">Шаг 0,5</span>';
  ingredients.parentNode.insertBefore(controls, ingredients);

  const input = controls.querySelector('input');
  const minus = controls.querySelector('.rp-minus');
  const plus = controls.querySelector('.rp-plus');
  const root = document.body.dataset.recipe || location.pathname;
  const storageKey = 'recipes_v1_1_' + root + '_portion_count';
  let current = originalCount;

  function apply(value) {
    let count = parse(value);
    if (!Number.isFinite(count) || count < 0.5) count = current;
    count = Math.max(0.5, Math.round(count * 2) / 2);
    const factor = count / originalCount;
    current = count;
    input.value = String(count);
    minus.disabled = count <= 0.5;

    statsNumber.textContent = format(count);
    if (statsLabel) {
      const word = Number.isInteger(count)
        ? ({one: 'порция', few: 'порции', many: 'порций', other: 'порции'}[new Intl.PluralRules('ru-RU').select(count)])
        : 'порции';
      statsLabel.textContent = count === originalCount ? originalLabel : word;
    }

    for (const {el, original} of ingredientAmounts) el.textContent = scaleText(original, factor);
    for (const {node, original} of portionsInNames) {
      node.textContent = factor === 1 ? original : original.replace(
        /(\d+(?:[.,]\d+)?)(\s*×\s*\d+(?:[.,]\d+)?\s*г)/,
        (_, pieces, rest) => format(parse(pieces) * factor) + rest
      );
    }
    for (const {el, original, isCalories} of overallValues)
      el.textContent = scaleText(original, factor, isCalories ? 0 : 1);
    for (const {el, original} of detailedValues)
      el.textContent = scaleText(original, factor, 2);
    try {localStorage.setItem(storageKey, String(count));} catch (e) { /* Недоступное хранилище не блокирует управление. */ }
  }

  minus.addEventListener('click', () => apply(current - 0.5));
  plus.addEventListener('click', () => apply(current + 0.5));
  input.addEventListener('change', () => apply(input.value));
  input.addEventListener('keydown', e => {if (e.key === 'Enter') input.blur();});

  let saved = null;
  try {saved = localStorage.getItem(storageKey);} catch (e) { /* Работаем без сохранения. */ }
  apply(saved !== null ? saved : originalCount);
})();

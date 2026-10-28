/* Edition 1.3.4. Pure quantity model; no storage, DOM, network or secrets.
 * grams remains the nutritional mass. Whole eggs are displayed as pieces.
 * A cooking batch is not silently equated with requested servings.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RecipeCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const nutrients = ['kcal', 'protein', 'fat', 'carbs'];
  const format = (n, d = 2) => new Intl.NumberFormat('ru-RU', {useGrouping:false, maximumFractionDigits:d}).format(Math.round((n + Number.EPSILON) * 10**d) / 10**d);
  const esc = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const portionWord = n => ({one:'порция',few:'порции',many:'порций',other:'порции'}[new Intl.PluralRules('ru-RU').select(n)]);
  // Cooking display only. The original gram amount is ALWAYS preserved for
  // scaling, purchase totals and nutrition. Spoon quantities are approximate:
  // 1 tsp = 5 ml ≈ 4.6g vegetable/olive oil, 4g sugar or 5g fine table salt.
  const tspGrams = Object.freeze({oil:4.6,sugar:4,salt:5});
  function spoonText(key, value) {
    const gramsPerTsp = tspGrams[key];
    if (!gramsPerTsp || value / gramsPerTsp < 0.5 - 1e-9) return null;
    // Quarter-teaspoon is the smallest realistic kitchen measure; avoid fake
    // precision in decimals when converting mass to volume.
    const quarters = Math.max(2, Math.round(value / gramsPerTsp * 4));
    // 1/2 tbsp is easier to measure than 1 1/2 tsp and matches the source
    // batter recipe (0.5 tbsp salt for five eggs).
    if (quarters >= 6 && quarters % 6 === 0) return '≈ ' + format(quarters / 12) + ' ст. л.';
    const tbsp = Math.floor(quarters / 12);
    const tspQuarter = quarters % 12;
    const parts = [];
    if (tbsp) parts.push(format(tbsp) + ' ст. л.');
    if (tspQuarter) parts.push(format(tspQuarter / 4) + ' ч. л.');
    return '≈ ' + parts.join(' + ');
  }
  function measuredAmount(item, value) {
    const useSpoons = item.key === 'sugar' || item.key === 'salt' ||
      (item.key === 'oil' && item.measure_spoons === true);
    return useSpoons ? spoonText(item.key, value) : null;
  }

  function count(value, fallback) {
    const n = Number(String(value == null ? '' : value).trim().replace(',', '.'));
    return Number.isFinite(n) && n >= .5 && n <= 1000 ? Math.round(n * 2) / 2 : fallback;
  }
  function create(recipe, basis, state) {
    const enabled = Boolean(recipe.child && state.enabled);
    const requestedA = count(state.adult, recipe.portions);
    const requestedC = enabled ? count(state.child, 1) : 0;
    const pancake = recipe.batch_mode === 'shared_pancakes';
    const step = recipe.batch_step_portions || .5;
    const cookedA = pancake ? requestedA : Math.ceil((requestedA - 1e-9) / step) * step;
    const eggsMass = recipe.egg_model && recipe.egg_model.grams_per_egg || 55;
    const pancakesPerEgg = pancake ? (recipe.pancakes_per_egg || 4) : 0;
    const adultPancakesPerPortion = pancake ? (recipe.pancakes_per_adult_portion || 3) : 0;
    const childPancakesPerPortion = pancake ? (recipe.pancakes_per_child_portion || 2) : 0;
    const pancakeA = pancake ? requestedA * adultPancakesPerPortion : 0;
    const pancakeC = pancake ? requestedC * childPancakesPerPortion : 0;
    const pancakeReference = recipe.portions * adultPancakesPerPortion;
    const pancakeBatch = pancake ? Math.ceil((pancakeA + pancakeC - 1e-9) / pancakesPerEgg) * pancakesPerEgg : 0;
    const pancakeLeft = pancakeBatch - pancakeA - pancakeC;
    const sideRecipe = who => who === 'a' ? recipe : recipe.child;
    const servings = who => who === 'a' ? cookedA : requestedC;
    const requested = who => who === 'a' ? requestedA : requestedC;
    const factor = who => servings(who) / sideRecipe(who).portions;
    // 'eat' includes only chosen servings. 'cook' includes full batches.
    function amount(who, gi, ii, mode = 'cook') {
      if (who === 'c' && !enabled) return 0;
      const r = sideRecipe(who), item = r.groups[gi].items[ii];
      if (pancake && gi === 0) {
        // Full shared batter is emitted once, on adult side, never twice.
        if (mode === 'cook') return who === 'a' ? recipe.groups[0].items[ii].grams * pancakeBatch / pancakeReference : 0;
        return item.grams * requested(who) / r.portions;
      }
      return item.grams * (mode === 'eat' ? requested(who) / r.portions : factor(who));
    }
    function grams(who, key, group) {
      let sum = 0, found = false;
      ['a', 'c'].forEach(side => {
        if (who !== 't' && who !== side || side === 'c' && !enabled) return;
        sideRecipe(side).groups.forEach((g, gi) => {
          if (group !== undefined && Number(group) !== gi) return;
          g.items.forEach((item, ii) => {if (item.key === key) {found = true; sum += amount(side, gi, ii);}});
        });
      });
      if (!found) throw new Error('Ингредиент шага отсутствует: ' + who + '.' + (group === undefined ? '' : group + '.') + key);
      return sum;
    }
    function display(item, value) {
      if (item.key === 'egg') {
        const pieces = value / eggsMass;
        if (Math.abs(pieces - Math.round(pieces)) > 1e-6) throw new Error('Не целое яйцо в приготовляемой партии: ' + pieces);
        return format(Math.round(pieces)) + ' шт.';
      }
      return measuredAmount(item, value) || format(value) + ' ' + (item.unit || 'г');
    }
    function expand(template) {
      const special = {adultPancakes:pancakeA,childPancakes:pancakeC,allPancakes:pancakeA+pancakeC,
        batchPancakes:pancakeBatch,leftoverPancakes:pancakeLeft,
        adultBatterPercent:100*pancakeA/pancakeBatch,childBatterPercent:100*pancakeC/pancakeBatch,
        leftoverBatterPercent:100*pancakeLeft/pancakeBatch};
      return String(template).replace(/\{\{(.*?)\}\}/g, (_, token) => {
        if (Object.prototype.hasOwnProperty.call(special, token)) return format(special[token], 2);
        const m = token.match(/^([act])\.(?:(\d+)\.)?(\w+)(?:\*([\d.]+))?(\|measure)?$/);
        if (!m) throw new Error('Неизвестный токен: ' + token);
        const [,who,gi,key,mul,measure] = m;
        let value = key === 'portions' ? (who === 't' ? cookedA+requestedC : servings(who)) : grams(who,key,gi);
        value *= Number(mul || 1);
        if (key === 'egg') {
          value /= eggsMass;
          if (Math.abs(value - Math.round(value)) > 1e-6) throw new Error('Дробное яйцо в шаге: ' + token);
          value = Math.round(value);
        }
        if (measure) {
          if (!Object.prototype.hasOwnProperty.call(tspGrams, key))
            throw new Error('Нельзя измерить ложками: ' + token);
          // Only templates for oil poured onto food carry |measure;
          // pan oil templates keep using numeric grams.
          return display({key, measure_spoons:true}, value);
        }
        return format(value);
      });
    }
    function nutrition(who, mode = 'cook') {
      const total = {kcal:0,protein:0,fat:0,carbs:0};
      if (who === 'c' && !enabled) return total;
      sideRecipe(who).groups.forEach((g,gi) => g.items.forEach((i,ii) => {
        if (!basis[i.key]) throw new Error('Нет расчётной базы: ' + i.key);
        const grams = amount(who,gi,ii,mode);
        nutrients.forEach(k => total[k] += grams / 100 * basis[i.key][k]);
      }));
      return total;
    }
    function totals() {
      const all = new Map();
      ['a','c'].forEach(side => {
        if (side==='c'&&!enabled) return;
        sideRecipe(side).groups.forEach((g,gi)=>g.items.forEach((item,ii)=>{
          const n = amount(side,gi,ii);
          if (n === 0) return;
          const key = item.key + '|' + (item.unit||'г');
          if (!all.has(key)) all.set(key,{...item,grams:0});
          all.get(key).grams += n;
        }));
      });
      return [...all.values()];
    }
    function batchMessage() {
      if (pancake) return 'Общий замес: ' + format(pancakeBatch/pancakesPerEgg) + ' шт. яиц → ориентировочно ' + format(pancakeBatch) +
        ' блинов. Для тебя: ' + format(pancakeA) + (enabled ? ', для ребёнка: ' + format(pancakeC) : '') +
        '. Остаток без начинки: ' + format(pancakeLeft) + ' шт. По твоему фактическому результату — примерно ' + format(pancakesPerEgg) + ' блина из 1 яйца (12 блинов из 3 яиц). Реальный выход зависит от диаметра сковороды и толщины. Начинка и соусы — только на выбранные порции. При отличающемся выходе дели по массе готовых блинов; сырые яйца не делим.';
      if (cookedA > requestedA + 1e-9) return 'Выбрано: ' + format(requestedA) + ' ' + portionWord(requestedA) +
        '. Чтобы использовать целые яйца и сохранить пропорции, готовим ' + format(cookedA) + ' ' + portionWord(cookedA) +
        '. Все ингредиенты и шаги ниже — на эту партию. Остаток: ' + format(cookedA-requestedA) + ' ' + portionWord(cookedA-requestedA) +
        '; отдели его после приготовления и храни по инструкции. Детское количество не увеличивается.';
      return '';
    }
    return {recipe,basis,enabled,pancake,requestedA,requestedC,cookedA,pancakeA,pancakeC,pancakeBatch,pancakeLeft,pancakesPerEgg,
      eggsMass,sideRecipe,servings,requested,factor,amount,grams,display,expand,nutrition,totals,batchMessage};
  }
  return {create,format,esc,count,portionWord,nutrients,spoonText};
});

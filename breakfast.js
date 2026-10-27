/* Редакция 1.2. Полностью локальное приложение: без fetch, CDN и сервера.
 * Базовые данные неизменны; обе партии пересчитываются независимо от них.
 * Числовые токены в шагах используют те же граммовки, что списки ингредиентов.
 */
(function () {
  'use strict';
  const source = document.getElementById('recipe-family-data');
  if (!source) return;
  let payload;
  try { payload = JSON.parse(source.textContent); } catch (error) {
    console.error('Не удалось прочитать данные рецепта.', error); return;
  }
  const r = payload.recipe, child = r.child, basis = payload.basis;
  if (!child || !r.groups || !r.step_templates) return;
  const root = String(r.id);
  const prefix = 'recipes_v1_2_' + root + '_';
  const legacy = 'recipes_v1_1_' + root + '_';
  let storageAvailable = true;
  const get = key => { try { return localStorage.getItem(key); } catch (_) { storageAvailable = false; return null; } };
  const set = (key, value) => { try { localStorage.setItem(key, String(value)); } catch (_) { storageAvailable = false; } };
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const format = (value, digits = 2) => new Intl.NumberFormat('ru-RU', {useGrouping:false, maximumFractionDigits:digits}).format(Math.round((value + Number.EPSILON) * Math.pow(10,digits)) / Math.pow(10,digits));
  const parseCount = (value, fallback) => {
    const n = Number(String(value ?? '').trim().replace(',', '.'));
    return Number.isFinite(n) && n >= .5 && n <= 1000 ? Math.round(n * 2) / 2 : fallback;
  };
  const word = n => ({one:'порция',few:'порции',many:'порций',other:'порции'}[new Intl.PluralRules('ru-RU').select(n)]);
  const state = {
    adult: parseCount(get(legacy+'portion_count'), r.portions),
    child: parseCount(get(prefix+'child_portions'), 1),
    enabled: get(prefix+'child_enabled') === '1'
  };
  const checks = Object.create(null);
  const elements = {
    toggle:document.getElementById('include-child'),
    adult:document.getElementById('adult-portions'),
    child:document.getElementById('child-portions'),
    info:document.getElementById('child-mode-info'),
    status:document.getElementById('mode-status'),
    method:document.getElementById('recipe-steps'),
    nutrition:document.getElementById('nutrition-section'),
    storage:document.getElementById('storage-section'),
    workflow:document.getElementById('recipe-workflow')
  };
  const lists = document.createElement('div'); lists.id = 'ingredient-lists';
  document.getElementById('adult-ingredients').replaceWith(lists);
  const factor = who => who === 'a' ? state.adult/r.portions : state.child/child.portions;
  const recipeFor = who => who === 'a' ? r : child;

  function grams(who, key, groupIndex) {
    let total = 0;
    for (const side of ['a','c']) {
      if (who !== 't' && who !== side) continue;
      if (side === 'c' && !state.enabled) continue;
      recipeFor(side).groups.forEach((group, gi) => {
        if (groupIndex !== undefined && Number(groupIndex) !== gi) return;
        group.items.forEach(item => { if (item.key === key) total += item.grams * factor(side); });
      });
    }
    return total;
  }
  function expand(template) {
    const ap = state.adult*3, cp = state.enabled ? state.child*2 : 0;
    const special = {adultPancakes:ap, childPancakes:cp, allPancakes:ap+cp,
      adultBatterPercent:100*ap/(ap+cp), childBatterPercent:100*cp/(ap+cp)};
    return String(template).replace(/\{\{(.*?)\}\}/g, (_,token) => {
      if (Object.prototype.hasOwnProperty.call(special,token)) return format(special[token],1);
      const m = token.match(/^([act])\.(?:(\d+)\.)?(\w+)(?:\*([\d.]+))?$/);
      if (!m) throw new Error('Неизвестный токен шага: ' + token);
      const [,who,group,key,multiplier] = m;
      const value = key === 'portions' ? (who === 'a' ? state.adult : who === 'c' ? state.child : state.adult+(state.enabled?state.child:0)) : grams(who,key,group);
      return format(value*Number(multiplier || 1));
    });
  }
  function nameFor(item, scale) {
    return item.name.replace(/(\d+(?:[.,]\d+)?)(\s*×\s*\d+(?:[.,]\d+)?\s*г)/g,
      (_,n,tail) => format(Number(n.replace(',','.'))*scale)+tail);
  }
  function isChecked(key) {
    if (!(key in checks)) checks[key] = get(prefix+'check_'+key) === '1';
    return checks[key];
  }
  function ingredientRow(name, amount, unit, key) {
    return '<div class="check"><label><input type="checkbox" data-check="'+esc(key)+'"'+(isChecked(key)?' checked':'')+'/><span>'+esc(name)+'</span></label><span class="amount">'+format(amount)+' '+esc(unit)+'</span></div>';
  }
  function groupHtml(group, who, index) {
    let h='<div class="card"><h3>'+esc(group.name)+'</h3>';
    group.items.forEach((item,ii) => { h += ingredientRow(nameFor(item,factor(who)),item.grams*factor(who),item.unit||'г',who+'-'+index+'-'+ii); });
    return h+'</div>';
  }
  function allIngredientTotals() {
    const result = new Map();
    for (const side of ['a','c']) {
      if (side==='c'&&!state.enabled) continue;
      recipeFor(side).groups.forEach(group => group.items.forEach(item => {
        const key=item.key+'|'+(item.unit||'г');
        if (!result.has(key)) result.set(key,{...item, grams:0});
        result.get(key).grams += item.grams*factor(side);
      }));
    }
    const labels={oil:'Растительное масло — всего',chicken:'Куриное филе — всего',egg:'Яйца без скорлупы — всего',tortilla:'Тортильи — общий вес',bun:'Булочки / хлебная основа — общий вес',water:'Вода по рецепту (без воды для варки)',salt:'Соль — всего',milk:'Безлактозное молоко 1,5% — всего',milk_regular:'Обычное молоко 3,2% — всего'};
    return '<details class="details family-totals"><summary>Общие продукты на обе партии — сводный список</summary><p>Это сумма списков ниже, а не дополнительные продукты. Обязательные продукты обеих сторон учтены; необязательные добавки не включены.</p><ul>'+[...result.values()].map(item=>'<li><span>'+esc(labels[item.key]||item.name.replace(/,?\s*\d+(?:[.,]\d+)?\s*×\s*\d+(?:[.,]\d+)?\s*г/g,''))+'</span><span class="sum-amount">'+format(item.grams)+' '+esc(item.unit||'г')+'</span></li>').join('')+'</ul></details>';
  }
  function renderIngredients() {
    const open = Boolean(lists.querySelector('.family-totals[open]'));
    let html='';
    const shared=state.enabled&&r.id===5;
    if (shared) {
      html+='<h3 class="role-heading">Общее блинное тесто<span class="role-subtitle">Один замес для тебя и ребёнка; повторно добавлять эти продукты не нужно.</span></h3><div class="ingredients shared-ingredients"><div class="card"><h3>Обычное молоко 3,2% и яйцо</h3>';
      r.groups[0].items.forEach((item,ii)=>{
        const amount=grams('t',item.key,0);
        html+=ingredientRow(item.name,amount,item.unit||'г','s-0-'+ii);
      });
      html+='</div><div class="card"><h3>Как разделить блины</h3><p>Ориентир: тебе '+format(state.adult*3)+' шт., ребёнку '+format(state.child*2)+' шт.</p><p>При другом выходе: '+expand('{{adultBatterPercent}}')+'% готовой партии тебе и '+expand('{{childBatterPercent}}')+'% ребёнку по массе. Для половины порции не нужно печь половинку блина — отдели нужную долю после приготовления.</p><p class="small">Яйцо для дробной массы размешай и отвесь без скорлупы.</p></div></div>';
    }
    if(state.enabled) html+='<h3 class="role-heading">Моя '+(shared?'начинка и соус':'партия')+' · '+format(state.adult)+' '+word(state.adult)+'</h3>';
    html+='<div class="ingredients" id="adult-ingredients">';
    r.groups.forEach((g,gi)=>{if(!(shared&&gi===0))html+=groupHtml(g,'a',gi);});
    html+='</div>';
    if (state.enabled) {
      html+='<h3 class="role-heading">Детская '+(shared?'начинка':'партия')+' · '+format(state.child)+' '+word(state.child)+'<span class="role-subtitle">'+esc(child.title)+'</span></h3><div class="ingredients child-ingredients" id="child-ingredients">';
      child.groups.forEach((g,gi)=>{if(!(shared&&gi===0))html+=groupHtml(g,'c',gi);});
      html+='</div>';
      if (child.optional) html+='<p class="hint">'+esc(child.optional)+'</p>';
      html+=allIngredientTotals();
    }
    lists.innerHTML=html;
    if(open&&lists.querySelector('.family-totals'))lists.querySelector('.family-totals').open=true;
  }
  function nutritionalTotals(who) {
    const total={kcal:0,protein:0,fat:0,carbs:0};
    recipeFor(who).groups.forEach(g=>g.items.forEach(item=>{
      for(const key of Object.keys(total))total[key]+=item.grams*factor(who)/100*basis[item.key][key];
    }));
    return total;
  }
  function nutritionDetails(who) {
    let html='';
    recipeFor(who).groups.forEach(group=>group.items.forEach(item=>{
      const amount=item.grams*factor(who);
      html+='<tr><td class="ingname">'+esc(nameFor(item,factor(who)))+'<small>'+(who==='a'?'Моя партия':'Детская партия')+' · '+esc(group.name)+'</small></td><td>'+format(amount)+' '+esc(item.unit||'г')+'</td>';
      for (const key of ['kcal','protein','fat','carbs'])html+='<td>'+format(amount/100*basis[item.key][key],1)+'</td>';
      html+='</tr>';
    }));return html;
  }
  function renderNutrition() {
    const open=Boolean(elements.nutrition.querySelector('details[open]'));
    const a=nutritionalTotals('a'),c=state.enabled?nutritionalTotals('c'):null;
    let h='<h2>КБЖУ</h2><div class="tablewrap"><table class="nutrition"><thead><tr><th>Показатель</th><th>Моя порция</th><th>Моя партия</th>'+(state.enabled?'<th class="child-col">Детская порция</th><th class="child-col">Детская партия</th>':'')+'</tr></thead><tbody>';
    for(const [key,label,unit] of [['kcal','Калории','ккал'],['protein','Белки','г'],['fat','Жиры','г'],['carbs','Углеводы','г']]) {
      const d=key==='kcal'?0:1;
      h+='<tr><td>'+label+'</td><td>≈ '+format(a[key]/state.adult,d)+' '+unit+'</td><td>≈ '+format(a[key],d)+' '+unit+'</td>';
      if(state.enabled)h+='<td class="child-col">≈ '+format(c[key]/state.child,d)+' '+unit+'</td><td class="child-col">≈ '+format(c[key],d)+' '+unit+'</td>';
      h+='</tr>';
    }
    h+='</tbody></table></div><p class="hint">Приближённая модель, не анализ упаковок. Масло и соусы учтены полностью. Твоя порция не уменьшается при добавлении ребёнка. Детские КБЖУ показаны отдельно; средняя «семейная порция» не используется. Порция ребёнка — ориентир приготовления, не требование съесть всё.</p>';
    if(r.nutrition_note)h+='<div class="note">'+esc(r.nutrition_note)+'</div>';
    h+='<details class="details"'+(open?' open':'')+'><summary>Расчёт по каждому ингредиенту</summary><div class="tablewrap"><table class="nutrition"><thead><tr><th>Ингредиент</th><th>Масса</th><th>ккал</th><th>Б, г</th><th>Ж, г</th><th>У, г</th></tr></thead><tbody>'+nutritionDetails('a')+(state.enabled?nutritionDetails('c'):'')+'</tbody></table></div><p><a href="nutrition_basis.html">Расчётная база и источники →</a></p></details>';
    elements.nutrition.innerHTML=h;
  }
  function renderStorage() {
    let h='<h2>Хранение и следующая порция</h2>';
    if(state.enabled)h+='<h3>Мой завтрак</h3>';
    for(const [key,label] of [['fridge','Что убрать в холодильник.'],['reheat','Как подать в следующий раз.'],['freeze','Заморозка.']])
      h+='<p><strong>'+label+'</strong> '+esc(r.storage[key])+'</p>';
    if(state.enabled)h+='<div class="child-storage"><h3>Детский завтрак</h3><p>'+esc(child.storage)+'</p></div>';
    elements.storage.innerHTML=h;
  }
  function render() {
    elements.toggle.checked=state.enabled;
    elements.adult.value=String(state.adult);elements.child.value=String(state.child);
    document.querySelector('.child-count').hidden=!state.enabled;
    elements.info.hidden=!state.enabled;
    document.querySelectorAll('[data-count]').forEach(button=>{
      button.disabled=Number(button.dataset.delta)<0&&state[button.dataset.count]<=.5;
    });
    elements.status.textContent=state.enabled?'Готовим вместе · мои: '+format(state.adult)+' '+word(state.adult)+' · детские: '+format(state.child)+' '+word(state.child):'Только мой завтрак · '+format(state.adult)+' '+word(state.adult);
    elements.info.innerHTML=state.enabled?'<p class="child-title">Ребёнку: '+esc(child.title)+'</p><p class="child-description">Детские продукты добавляются сверх твоих. Ниже — один общий порядок, а не два независимых рецепта.</p>'+(child.allergy_note?'<div class="allergy-notice"><strong>Молоко и яйцо в блинах.</strong> '+esc(child.allergy_note)+'</div>':''):'';
    const stats=document.querySelectorAll('.stats .stat');
    stats[0].querySelector('strong').textContent=state.enabled?format(state.adult)+' + '+format(state.child):format(state.adult);
    stats[0].querySelector('span').textContent=state.enabled?'мои + детские порции':'мои '+word(state.adult);
    stats[1].querySelector('strong').textContent=state.enabled?r.family_time:r.time;
    stats[1].querySelector('.micro').textContent='≈ '+(state.enabled?r.family_active_minutes:r.active_minutes)+' мин активной работы';
    stats[2].querySelector('span').textContent='ккал / моя порция';
    stats[3].querySelector('span').textContent='белка / моя порция';
    document.querySelector('.hero .badge').textContent=(state.enabled?'Мои '+format(state.adult)+' + детские '+format(state.child)+' порции':'Мои '+format(state.adult)+' '+word(state.adult))+' · ≈'+format(r.nutrition.per_portion.kcal,0)+' ккал / моя порция';
    elements.workflow.innerHTML='<p><strong>Как организовать готовку.</strong> '+esc(state.enabled?r.family_workflow:r.workflow)+' Время — ориентир для базового количества; при другой площади сковороды и числе партий оно меняется.</p>';
    document.getElementById('ingredient-heading').textContent=state.enabled?'Ингредиенты на оба завтрака':'Ингредиенты';
    document.getElementById('method-heading').textContent=state.enabled?'Как приготовить оба завтрака':'Как приготовить';
    renderIngredients();
    elements.method.innerHTML=(state.enabled?r.family_step_templates:r.step_templates).map(([title,text])=>'<li><strong>'+esc(title)+'</strong>'+esc(expand(text))+'</li>').join('');
    renderNutrition();renderStorage();
    set(legacy+'portion_count',state.adult);set(prefix+'child_portions',state.child);set(prefix+'child_enabled',state.enabled?'1':'0');
  }
  elements.toggle.addEventListener('change',()=>{state.enabled=elements.toggle.checked;render();});
  document.querySelectorAll('[data-count]').forEach(button=>button.addEventListener('click',()=>{
    const key=button.dataset.count;state[key]=parseCount(state[key]+Number(button.dataset.delta),state[key]);render();
  }));
  for(const who of ['adult','child']) {
    elements[who].addEventListener('change',()=>{state[who]=parseCount(elements[who].value,state[who]);render();});
    elements[who].addEventListener('keydown',event=>{if(event.key==='Enter')elements[who].blur();});
  }
  lists.addEventListener('change',event=>{
    const box=event.target.closest('input[data-check]');if(!box)return;
    checks[box.dataset.check]=box.checked;set(prefix+'check_'+box.dataset.check,box.checked?'1':'0');
  });
  const reset=document.querySelector('[data-reset]');
  if(reset)reset.addEventListener('click',()=>{
    // Only visible product checkboxes; neither recipe mode nor portion counters are reset.
    lists.querySelectorAll('input[data-check]').forEach(box=>{box.checked=false;checks[box.dataset.check]=false;set(prefix+'check_'+box.dataset.check,'0');});
  });
  const notes=document.querySelector('.note-area'),notesStatus=document.querySelector('.notes-status');
  function updateNotesStatus(){if(notesStatus)notesStatus.textContent=storageAvailable?'Заметки и настройки сохраняются только в этом браузере. Перед переносом файлов скопируй важное.':'Локальное сохранение недоступно. Переключение работает до закрытия страницы; заметки скопируй отдельно.';}
  if(notes){notes.value=get(legacy+'notes')||'';notes.addEventListener('input',()=>{set(legacy+'notes',notes.value);updateNotesStatus();});}
  const print=document.querySelector('[data-print]');if(print)print.addEventListener('click',()=>window.print());
  render();updateNotesStatus();
  // Read-only diagnostic state for local checks; no personal data or network access.
  window.recipeBreakfastState=()=>({...state});
})();

/* Edition 1.3. Dinner quantities, step templates and nutrition share one model. */
(function () {
  'use strict';
  const source = document.getElementById('recipe-family-data');
  if (!source || !window.RecipeCore) return;
  const {recipe:r,basis} = JSON.parse(source.textContent);
  if (r.child) return;
  const core=window.RecipeCore, f=core.format, esc=core.esc;
  const prefix='recipes_v1_1_'+r.id+'_';
  const get=k=>{try{return localStorage.getItem(k);}catch(_){return null;}};
  const set=(k,v)=>{try{localStorage.setItem(k,String(v));}catch(_){/* Browsing still works. */}};
  let current=core.count(get(prefix+'portion_count'),r.portions),plan;
  const list=document.querySelector('.ingredients');
  const controls=document.createElement('div');controls.className='family-portions no-print';
  controls.innerHTML='<div class="portion-control"><label for="rp-portion-input">Нужно порций</label><div class="portion-row"><button type="button" data-delta="-0.5" aria-label="Уменьшить на 0,5">−</button><input id="rp-portion-input" type="number" min="0.5" max="1000" step="0.5" inputmode="decimal"><button type="button" data-delta="0.5" aria-label="Увеличить на 0,5">+</button></div></div><span class="portion-hint">Шаг 0,5</span>';
  list.before(controls);
  const batch=document.createElement('div');batch.id='batch-plan';batch.className='note batch-plan';list.before(batch);
  const input=controls.querySelector('input');
  const nameFor=(item,scale)=>item.name.replace(/(\d+(?:[.,]\d+)?)(\s*×\s*\d+(?:[.,]\d+)?\s*г)/g,(_,n,t)=>f(Number(n.replace(',','.'))*scale)+t);
  function render(){
    plan=core.create(r,basis,{adult:current});input.value=String(current);
    controls.querySelector('[data-delta="-0.5"]').disabled=current<=.5;
    controls.querySelector('[data-delta="0.5"]').disabled=current>=1000;
    batch.textContent=plan.batchMessage().replace(' Детское количество не увеличивается.','');batch.hidden=!batch.textContent;
    const stats=document.querySelectorAll('.stats .stat');
    stats[0].querySelector('strong').textContent=f(plan.cookedA);
    stats[0].querySelector('span').textContent='готовим '+core.portionWord(plan.cookedA);
    let idx=0;
    list.innerHTML=r.groups.map((g,gi)=>'<div class="card"><h3>'+esc(g.name)+'</h3>'+g.items.map((item,ii)=>{
      const key=prefix+'ingredient_'+idx++;
      return '<div class="check"><label><input type="checkbox" data-storage-key="'+key+'"'+(get(key)==='1'?' checked':'')+'><span>'+esc(nameFor(item,plan.factor('a')))+'</span></label><span class="amount">'+esc(plan.display(item,plan.amount('a',gi,ii)))+'</span></div>';
    }).join('')+'</div>').join('');
    document.getElementById('recipe-steps').innerHTML=r.step_templates.map(([title,text])=>'<li><strong>'+esc(title)+'</strong>'+esc(plan.expand(text))+'</li>').join('');
    const total=plan.nutrition('a'),eat=plan.nutrition('a','eat');
    const nutrition=document.getElementById('nutrition-section');
    const open=Boolean(nutrition.querySelector('details[open]'));
    let html='<h2>КБЖУ</h2><div class="tablewrap"><table class="nutrition"><thead><tr><th>Показатель</th><th>На 1 порцию</th><th>Готовим '+f(plan.cookedA)+' '+core.portionWord(plan.cookedA)+'</th><th>Выбрано '+f(current)+'</th></tr></thead><tbody>';
    [['kcal','Калории','ккал'],['protein','Белки','г'],['fat','Жиры','г'],['carbs','Углеводы','г']].forEach(([key,label,unit])=>{
      const d=key==='kcal'?0:1;
      html+='<tr><td>'+label+'</td><td>≈ '+f(total[key]/plan.cookedA,d)+' '+unit+'</td><td>≈ '+f(total[key],d)+' '+unit+'</td><td>≈ '+f(eat[key],d)+' '+unit+'</td></tr>';
    });
    html+='</tbody></table></div><p class="hint">Приближённая модель. Все соусы, масло и панировка из списка учтены. Остаток приготовленной партии — не дополнительная еда в выбранных порциях.</p>';
    if(plan.cookedA>current)html+='<p class="note">Остаток: '+f(plan.cookedA-current)+' '+core.portionWord(plan.cookedA-current)+', ≈'+f(total.kcal-eat.kcal,0)+' ккал.</p>';
    if(r.nutrition_note)html+='<p class="note">'+esc(r.nutrition_note)+'</p>';
    html+='<details class="details"'+(open?' open':'')+'><summary>Расчёт по каждому ингредиенту</summary><div class="tablewrap"><table class="nutrition"><thead><tr><th>Ингредиент</th><th>Количество</th><th>ккал</th><th>Б, г</th><th>Ж, г</th><th>У, г</th></tr></thead><tbody>';
    r.groups.forEach((g,gi)=>g.items.forEach((item,ii)=>{
      const amount=plan.amount('a',gi,ii);
      html+='<tr><td class="ingname">'+esc(nameFor(item,plan.factor('a')))+'<small>'+esc(g.name)+'</small></td><td>'+esc(plan.display(item,amount))+'</td>'+core.nutrients.map(k=>'<td>'+f(amount/100*basis[item.key][k],1)+'</td>').join('')+'</tr>';
    }));
    html+='</tbody></table></div><p><a href="nutrition_basis.html">Расчётная база →</a></p></details>';
    nutrition.innerHTML=html;set(prefix+'portion_count',current);
  }
  function apply(v){current=core.count(v,current);render();}
  controls.querySelectorAll('button[data-delta]').forEach(b=>b.addEventListener('click',()=>apply(current+Number(b.dataset.delta))));
  input.addEventListener('change',()=>apply(input.value));input.addEventListener('keydown',e=>{if(e.key==='Enter')input.blur();});
  list.addEventListener('change',e=>{if(e.target.matches('input[data-storage-key]'))set(e.target.dataset.storageKey,e.target.checked?'1':'0');});
  const reset=document.querySelector('[data-reset]');if(reset)reset.addEventListener('click',()=>list.querySelectorAll('input').forEach(b=>{b.checked=false;set(b.dataset.storageKey,'0');}));
  const note=document.querySelector('.note-area'),status=document.querySelector('.notes-status');
  if(note){note.value=get(prefix+'notes')||'';note.addEventListener('input',()=>set(prefix+'notes',note.value));}
  if(status)status.textContent='Локальный черновик. На сайте Google Apps Script сохраняй заметку кнопкой в Google Drive.';
  const print=document.querySelector('[data-print]');if(print)print.addEventListener('click',()=>window.print());
  render();window.recipeQuantityPlan=()=>plan;
})();

(function() {
  // ===================== Config =====================
  const exam = window.examConfig;
  if (!exam) {
    console.error('examConfig not found. Define window.examConfig BEFORE loading quiz-engine.js');
    return;
  }

  // ===================== State =====================
  const state = {
    index: 0,
    answers: {},        // { qid: choiceIndex }
    flags: {},          // { qid: true }
    elims: {},          // { qid: Set([choiceIndex,...]) }
    eliminateMode: false,
    remaining: exam.timeLimitSec,
    timerId: null,
    timerHidden: false,
    finished: false,
    reviewMode: false
  };

  // ===================== DOM =====================
  const el = {
    sectionTitle: document.getElementById('sectionTitle'),
    timeLeft:     document.getElementById('timeLeft'),
    toggleTimer:  document.getElementById('toggleTimer'),
    qbadge:       document.getElementById('qbadge'),
    qtitle:       document.getElementById('qtitle'),
    choices:      document.getElementById('choices'),
    flagTop:      document.getElementById('flagTop'),
    flagLabel:    document.getElementById('flagLabel'),
    elimToggle:   document.getElementById('elimToggle'),
    elimHint:     document.getElementById('elimHint'),

    back:   document.getElementById('btnBack'),
    next:   document.getElementById('btnNext'),
    finish: document.getElementById('btnFinish'),

    progress: document.getElementById('progress'),
    pill:     document.getElementById('centerPill'),
    pillText: document.getElementById('pillText'),
    pillFlag: document.getElementById('pillFlag'),

    pop:      document.getElementById('popover'),
    popGrid:  document.getElementById('popGrid'),
    popClose: document.getElementById('popClose'),
    goReview: document.getElementById('goReview'),

    checkPage: document.getElementById('checkPage'),
    checkGrid: document.getElementById('checkGrid'),

    dashrow: document.getElementById('dashrow')
  };

  // ===================== Helpers =====================
  function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

  // ===================== Static rows =====================
  (function buildTicks(){
    if (!el.dashrow) return;
    for(let i=0;i<54;i++){
      const d=document.createElement('div');
      d.className='dash';
      el.dashrow.appendChild(d);
    }
  })();
  (function buildProgress(){
    if (!el.progress) return;
    const seg = Math.max(24, exam.questions.length * 2);
    el.progress.style.setProperty('--seg', seg);
    el.progress.innerHTML='';
    for(let i=0;i<seg;i++){
      const s=document.createElement('div');
      s.className='seg';
      el.progress.appendChild(s);
    }
  })();

  // ===================== Storage (optional resume) =====================
  function loadSaved(){
    try{
      const data = JSON.parse(localStorage.getItem(exam.storageKey)||'null');
      if(!data) return;
      Object.assign(state.answers, data.answers||{});
      Object.assign(state.flags,   data.flags  ||{});
      if (data.elims) {
        Object.keys(data.elims).forEach(q=> state.elims[q] = new Set(data.elims[q]));
      }
      if (typeof data.remaining==='number') state.remaining = data.remaining;
      if (typeof data.index==='number')     state.index     = clamp(data.index, 0, exam.questions.length-1);
    }catch(e){}
  }
  function save(){
    const elimsObj = {};
    Object.keys(state.elims).forEach(q=>{ elimsObj[q] = Array.from(state.elims[q]||[]); });
    try{
      localStorage.setItem(exam.storageKey, JSON.stringify({
        answers:   state.answers,
        flags:     state.flags,
        elims:     elimsObj,
        remaining: state.remaining,
        index:     state.index
      }));
    }catch(e){}
  }

  // ====== Option A: ALWAYS RESET ON PAGE LOAD ======
  function resetPractice() {
    try { localStorage.removeItem(exam.storageKey); } catch(e){}
    state.index         = 0;
    state.answers       = {};
    state.flags         = {};
    state.elims         = {};
    state.eliminateMode = false;
    state.remaining     = exam.timeLimitSec;
    state.finished      = false;
    state.reviewMode    = false;
  }

  // ===================== Timer =====================
  function startTimer(){
    if(state.timerId || state.finished) return;
    tick();
    state.timerId=setInterval(tick,1000);
  }
  function tick(){
    if (state.remaining<=0) return finishExam();
    state.remaining--;
    const m=String(Math.floor(state.remaining/60)).padStart(2,'0');
    const s=String(state.remaining%60).padStart(2,'0');
    if(!state.timerHidden && el.timeLeft) el.timeLeft.textContent=`${m}:${s}`;
    save();
    if(state.remaining<=0) finishExam();
  }
  if (el.toggleTimer && el.timeLeft){
    el.toggleTimer.addEventListener('click', ()=>{
      state.timerHidden=!state.timerHidden;
      el.toggleTimer.textContent = state.timerHidden ? 'Show' : 'Hide';
      el.timeLeft.style.visibility = state.timerHidden ? 'hidden' : 'visible';
    });
  }

  // ===================== Renderers =====================
  function render(){
    if (el.sectionTitle) el.sectionTitle.textContent = exam.sectionTitle;
    renderQuestion();
    renderProgress();
    buildPopGrid();
    buildCheckGrid();
    updateNavs();
    updateFlagVisuals();
    updatePillFlag();
    if (el.timeLeft){
      const m=String(Math.floor(state.remaining/60)).padStart(2,'0');
      const s=String(state.remaining%60).padStart(2,'0');
      el.timeLeft.textContent=`${m}:${s}`;
    }
  }

  function renderQuestion(){
    const q = exam.questions[state.index];

    // top meta
    if (el.qbadge) el.qbadge.textContent = state.index + 1;

    // Allow HTML in prompt so you can embed figures
    if (el.qtitle) el.qtitle.innerHTML = q.prompt;

    // choices
    if (!el.choices) return;
    const letter = i => String.fromCharCode(65+i);
    const elimSet = state.elims[q.id] || new Set();
    el.choices.innerHTML = q.choices.map((t,i)=>{
      const id=`${q.id}_c${i}`;
      const checked = state.answers[q.id]===i ? 'checked':'';  // radio checked
      const elimClass = elimSet.has(i) ? 'eliminated' : '';
      return `
        <label class="choice ${elimClass}" data-choice="${i}" for="${id}">
          <input id="${id}" type="radio" name="${q.id}" value="${i}" ${checked} />
          <div class="text"><b>${letter(i)}.</b> ${t}</div>
          <div class="letter">${letter(i)}</div>
        </label>
      `;
    }).join('');

    // handlers
    el.choices.querySelectorAll('.choice').forEach(choice=>{
      const idx = Number(choice.dataset.choice);
      const input = choice.querySelector('input');
      choice.addEventListener('click', (ev)=>{
        if (!state.eliminateMode) return;
        if (ev.target.tagName.toLowerCase()==='input') return;
        ev.preventDefault();
        toggleElimination(q.id, idx);
        choice.classList.toggle('eliminated');
        save();
      });
      input.addEventListener('change', ()=>{
        state.answers[q.id] = idx;
        save();
        renderProgress();
        buildPopGrid();
        buildCheckGrid();
      });
    });

    // flag & eliminate controls
    const flagged = !!state.flags[q.id];
    if (el.flagTop && el.flagLabel){
      el.flagTop.classList.toggle('on', flagged);
      el.flagTop.setAttribute('aria-pressed', String(flagged));
      el.flagLabel.textContent = flagged ? 'For review' : 'Mark for review';
    }
    if (el.elimToggle && el.elimHint){
      el.elimToggle.classList.toggle('on', state.eliminateMode);
      el.elimToggle.setAttribute('aria-pressed', String(state.eliminateMode));
      el.elimHint.style.display = state.eliminateMode ? 'block' : 'none';
    }
  }

  function toggleElimination(qid, idx){
    if (!state.elims[qid]) state.elims[qid] = new Set();
    const s = state.elims[qid];
    if (s.has(idx)) s.delete(idx); else s.add(idx);
  }

  function renderProgress(){
    if (!el.progress || !el.pillText) return;
    const segs = el.progress.children.length;
    const active = Math.ceil(((state.index+1)/exam.questions.length)*segs);
    for(let i=0;i<segs;i++){
      el.progress.children[i].classList.toggle('active', i<active);
    }
    el.pillText.textContent = `Question ${state.index+1} of ${exam.questions.length}`;
  }

  function updatePillFlag(){
    if (!el.pillFlag) return;
    const q = exam.questions[state.index];
    const flagged = !!state.flags[q.id];
    el.pillFlag.style.display = flagged ? 'block' : 'none';
  }
  function updateFlagVisuals(){
    if (!el.flagTop || !el.flagLabel) return;
    const q = exam.questions[state.index];
    const flagged = !!state.flags[q.id];
    el.flagTop.classList.toggle('on', flagged);
    el.flagTop.setAttribute('aria-pressed', String(flagged));
    el.flagLabel.textContent = flagged ? 'For review' : 'Mark for review';
  }

  // ---------- Review popover & page grids ----------
  function buildPopGrid(){
    if (!el.popGrid) return;
    el.popGrid.innerHTML='';
    exam.questions.forEach((q,i)=>{
      const b=document.createElement('button');
      b.className='nbtn';
      b.textContent = String(i+1);
      const answered = typeof state.answers[q.id]==='number';
      const flagged  = !!state.flags[q.id];
      if (i===state.index){
        b.classList.add('current');
        const pin=document.createElement('span');
        pin.className='pin';
        pin.textContent='📍';
        b.appendChild(pin);
      }
      if (answered) b.classList.add('answered');
      if (flagged)  b.classList.add('review');
      b.addEventListener('click', ()=>{
        state.index=i;
        state.reviewMode=false;
        closePopover();
        render();
      });
      el.popGrid.appendChild(b);
    });
  }
  function buildCheckGrid(){
    if (!el.checkGrid) return;
    el.checkGrid.innerHTML='';
    exam.questions.forEach((q,i)=>{
      const b=document.createElement('button');
      b.className='nbtn';
      b.textContent = String(i+1);
      const answered = typeof state.answers[q.id]==='number';
      const flagged  = !!state.flags[q.id];
      if (answered) b.classList.add('answered');
      if (flagged)  b.classList.add('review');
      b.addEventListener('click', ()=>{
        state.index=i;
        state.reviewMode=false;
        render();
        scrollTo(0,0);
      });
      el.checkGrid.appendChild(b);
    });
  }

  // ===================== Actions =====================
  function updateNavs(){
    if (!el.next || !el.finish) return;
    const last = state.index===exam.questions.length-1 && !state.reviewMode;
    el.next.style.display   = last ? 'none':'inline-block';
    el.finish.style.display = last ? 'inline-block':'none';
  }
  function go(delta){
    if (state.reviewMode){
      state.reviewMode=false;
      render();
      return;
    }
    const k = clamp(state.index + delta, 0, exam.questions.length-1);
    if (k===state.index) return;
    state.index = k;
    save();
    render();
  }
  function toggleFlag(){
    if (state.reviewMode){ return; }
    const q=exam.questions[state.index];
    state.flags[q.id]=!state.flags[q.id];
    save();
    updateFlagVisuals();
    updatePillFlag();
    buildPopGrid();
    buildCheckGrid();
  }

  // Eliminate toggle
  if (el.elimToggle && el.elimHint){
    el.elimToggle.addEventListener('click', ()=>{
      state.eliminateMode = !state.eliminateMode;
      el.elimToggle.classList.toggle('on', state.eliminateMode);
      el.elimToggle.setAttribute('aria-pressed', String(state.eliminateMode));
      el.elimHint.style.display = state.eliminateMode ? 'block' : 'none';
    });
  }

  // Finish: save payload for summary page, then redirect
  function finishExam(){
    if(state.finished) return;
    state.finished=true;
    if (state.timerId) clearInterval(state.timerId);
    closePopover();

    const items = exam.questions.map((q,i)=>{
      const chosen = (typeof state.answers[q.id] === 'number') ? state.answers[q.id] : null;
      return {
        number: i+1,
        id: q.id,
        prompt: q.prompt,
        choices: q.choices,
        correctIndex: q.answerIndex,
        chosenIndex: chosen,
        correct: chosen === q.answerIndex,
        explanation: q.explanation || ''
      };
    });

    const totals = {
      answered: items.filter(it => it.chosenIndex !== null).length,
      correct:  items.filter(it => it.correct).length,
      total:    items.length,
      timeSpentSec: exam.timeLimitSec - state.remaining
    };

    const summary = {
      title: exam.sectionTitle,
      generatedAt: new Date().toISOString(),
      totals,
      items
    };

    try { localStorage.setItem(exam.summaryKey, JSON.stringify(summary)); } catch(e){}
    if (exam.summaryUrl){
      location.href = exam.summaryUrl;
    }
  }

  // Popover
  function openPopover(){
    if (!el.pop || !el.pill) return;
    el.pop.style.display='block';
    el.pill.setAttribute('aria-expanded','true');
  }
  function closePopover(){
    if (!el.pop || !el.pill) return;
    el.pop.style.display='none';
    el.pill.setAttribute('aria-expanded','false');
  }

  if (el.pill){
    el.pill.addEventListener('click', ()=>{
      if (el.pop.style.display==='block') closePopover();
      else openPopover();
    });
  }
  if (el.popClose){
    el.popClose.addEventListener('click', closePopover);
  }
  if (el.goReview){
    el.goReview.addEventListener('click', ()=>{
      state.reviewMode=true;
      closePopover();
      render();
    });
  }

  // Close popover when clicking outside
  document.addEventListener('click', (e)=>{
    if (!el.pill || !el.pop) return;
    const inside = e.target===el.pill || el.pill.contains(e.target) || e.target===el.pop || el.pop.contains(e.target);
    if (!inside) closePopover();
  });

  // Nav buttons
  if (el.back)   el.back.addEventListener('click', ()=>go(-1));
  if (el.next)   el.next.addEventListener('click', ()=>go(1));
  if (el.finish) el.finish.addEventListener('click', finishExam);

  // Flag button
  if (el.flagTop) el.flagTop.addEventListener('click', toggleFlag);

  // ===================== Init =====================
  (function init(){
    resetPractice();     // always start fresh for now
    // loadSaved();      // if you ever want resume, call this instead of resetPractice
    render();
    startTimer();
  })();
})();

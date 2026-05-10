/* ═══════════════════════════════════════════════
   SytFix — app.js
   ═══════════════════════════════════════════════ */
(function(){
'use strict';

/* ── Theme ── */
var TK='sf-theme';
var pref=localStorage.getItem(TK)||(window.matchMedia('(prefers-color-scheme:light)').matches?'light':'dark');
function applyTheme(t){
  document.documentElement.setAttribute('data-theme',t);
  localStorage.setItem(TK,t);
  document.querySelectorAll('.theme-btn').forEach(function(b){
    b.textContent=t==='dark'?'☀':'☾';
    b.setAttribute('aria-label','Switch to '+(t==='dark'?'light':'dark')+' mode');
  });
}
applyTheme(pref);
document.addEventListener('click',function(e){
  if(e.target.closest('.theme-btn')){
    applyTheme(document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark');
  }
});

/* ── Loader ── */
function initLoader(){
  var loader=document.getElementById('sf-loader');
  if(!loader)return;
  if(sessionStorage.getItem('sf-seen')){loader.style.display='none';document.body.style.overflow='';fireReady();return;}
  document.body.style.overflow='hidden';
  function dismiss(){
    loader.classList.add('out');
    document.body.style.overflow='';
    sessionStorage.setItem('sf-seen','1');
    setTimeout(fireReady,80);
    loader.removeEventListener('click',dismiss);
  }
  setTimeout(dismiss,2100);
  loader.addEventListener('click',dismiss);
}
function fireReady(){document.dispatchEvent(new Event('sf:ready'));}

/* ── Cursor ── */
function initCursor(){
  if(!window.matchMedia('(pointer:fine)').matches)return;
  var dot=document.createElement('div');var ring=document.createElement('div');
  dot.className='sf-dot';ring.className='sf-ring';
  document.body.appendChild(dot);document.body.appendChild(ring);
  var mx=-100,my=-100,rx=-100,ry=-100,first=false;
  document.addEventListener('mousemove',function(e){
    mx=e.clientX;my=e.clientY;
    dot.style.transform='translate('+mx+'px,'+my+'px)';
    if(!first){first=true;dot.classList.add('on');ring.classList.add('on');}
  });
  (function lerp(){
    rx+=(mx-rx)*0.11;ry+=(my-ry)*0.11;
    ring.style.transform='translate('+rx+'px,'+ry+'px)';
    requestAnimationFrame(lerp);
  })();
  var HV='a,button,.btn,input,select,textarea,.svc-card,.card,.blog-card,.price-card,.cs-card,.stat-card,.score-card';
  document.addEventListener('mouseover',function(e){if(e.target.closest(HV)){dot.classList.add('hv');ring.classList.add('hv');}});
  document.addEventListener('mouseout',function(e){if(e.target.closest(HV)){dot.classList.remove('hv');ring.classList.remove('hv');}});
  document.addEventListener('mouseleave',function(){dot.classList.remove('on');ring.classList.remove('on');});
  document.addEventListener('mouseenter',function(){if(first){dot.classList.add('on');ring.classList.add('on');}});
}

/* ── Scroll progress ── */
function initProgress(){
  var bar=document.getElementById('sf-bar');
  if(!bar)return;
  window.addEventListener('scroll',function(){
    var tot=document.documentElement.scrollHeight-window.innerHeight;
    bar.style.width=(tot>0?(window.scrollY/tot)*100:0)+'%';
  },{passive:true});
}

/* ── Nav ── */
function initNav(){
  var nav=document.querySelector('.nav');
  var burger=document.querySelector('.burger');
  var mob=document.querySelector('.nav-mob');
  if(!nav)return;
  window.addEventListener('scroll',function(){
    nav.classList.toggle('scrolled',window.scrollY>20);
  },{passive:true});
  if(burger&&mob){
    burger.addEventListener('click',function(){
      var open=mob.classList.toggle('open');
      burger.classList.toggle('open',open);
      burger.setAttribute('aria-expanded',open);
      document.body.style.overflow=open?'hidden':'';
    });
    mob.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click',function(){
        mob.classList.remove('open');burger.classList.remove('open');
        document.body.style.overflow='';
      });
    });
  }
  var page=window.location.pathname.split('/').pop()||'index.html';
  document.querySelectorAll('.nav-links a,.nav-mob a').forEach(function(a){
    if((a.getAttribute('href')||'').split('/').pop()===page)a.classList.add('active');
  });
}

/* ── Scramble ── */
var SC='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&';
function scramble(el,dur){
  if(!el)return;
  var tgt=el.getAttribute('data-text')||el.textContent;
  var chars=tgt.split('');dur=dur||950;
  var revAt=chars.map(function(_,i){return(i/chars.length)*dur*.65+Math.random()*dur*.35;});
  var st=null;
  function frame(ts){
    if(!st)st=ts;var el2=el;
    var elapsed=ts-st;
    el2.textContent=chars.map(function(ch,i){
      if(ch===' ')return ' ';
      if(elapsed>=revAt[i])return ch;
      return SC[Math.floor(Math.random()*SC.length)];
    }).join('');
    if(elapsed<dur)requestAnimationFrame(frame);else el2.textContent=tgt;
  }
  requestAnimationFrame(frame);
}

/* ── Counter ── */
function animCount(el){
  var tgt=parseFloat(el.dataset.target||el.textContent);
  var suf=el.dataset.suffix||'';var pre=el.dataset.prefix||'';
  var dur=parseInt(el.dataset.dur)||1500;var dec=el.dataset.dec==='1';
  var st=null;
  function frame(ts){
    if(!st)st=ts;
    var p=Math.min((ts-st)/dur,1);
    var ease=1-Math.pow(1-p,3);
    var v=tgt*ease;
    el.textContent=pre+(dec?v.toFixed(1):Math.round(v))+suf;
    if(p<1)requestAnimationFrame(frame);else el.textContent=pre+tgt+suf;
  }
  requestAnimationFrame(frame);
}

/* ── Magnetic ── */
function initMagnetic(){
  document.querySelectorAll('.btn-p.btn-xl,.btn-p.btn-lg').forEach(function(btn){
    btn.addEventListener('mousemove',function(e){
      var r=btn.getBoundingClientRect();
      btn.style.transform='translate('+(e.clientX-r.left-r.width/2)*.26+'px,'+(e.clientY-r.top-r.height/2)*.26+'px)';
    });
    btn.addEventListener('mouseleave',function(){btn.style.transform='';});
  });
}

/* ── Score Card animation ── */
function initTerminal(){
  var card=document.querySelector('.score-card');if(!card)return;
  var fill=card.querySelector('.t-ring-fill');
  var scoreEl=card.querySelector('.t-score-val');
  var checks=card.querySelectorAll('.score-check');
  var tgt=72,ran=false;
  /* circumference for r=60.5: 2*PI*60.5 ≈ 380 */
  var CIRC=380;
  var obs=new IntersectionObserver(function(en){
    if(en[0].isIntersecting&&!ran){
      ran=true;obs.disconnect();
      setTimeout(function(){
        if(fill)fill.style.strokeDashoffset=CIRC-(tgt/100)*CIRC;
      },280);
      if(scoreEl){var s=0;var iv=setInterval(function(){s=Math.min(s+2,tgt);scoreEl.textContent=s;if(s>=tgt)clearInterval(iv);},38);}
      checks.forEach(function(row,i){setTimeout(function(){row.classList.add('in');},480+i*140);});
    }
  },{threshold:0.35});
  obs.observe(card);
}

/* ── Reveal ── */
function initReveal(){
  var obs=new IntersectionObserver(function(en){
    en.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');obs.unobserve(e.target);}});
  },{threshold:0.09});
  document.querySelectorAll('.reveal').forEach(function(el){obs.observe(el);});
  var cObs=new IntersectionObserver(function(en){
    en.forEach(function(e){if(e.isIntersecting){animCount(e.target);cObs.unobserve(e.target);}});
  },{threshold:0.5});
  document.querySelectorAll('[data-counter]').forEach(function(el){cObs.observe(el);});
}

/* ── Parallax ── */
function initParallax(){
  var g=document.querySelector('.hero-grid');if(!g)return;
  window.addEventListener('scroll',function(){g.style.transform='translateY('+(window.scrollY*.08)+'px)';},{passive:true});
}

/* ── Calculator ── */
function initCalc(){
  var wrap=document.querySelector('.calc-grid');if(!wrap)return;
  function fmt(n){if(n>=1e6)return'$'+(n/1e6).toFixed(1)+'M';if(n>=1e3)return'$'+Math.round(n/1e3)+'K';return'$'+Math.round(n).toLocaleString();}
  function upd(){
    var vis=+document.getElementById('r-vis').value;
    var conv=+document.getElementById('r-conv').value/100;
    var val=+document.getElementById('r-val').value;
    var cls=+document.getElementById('r-cls').value/100;
    var tup=+document.getElementById('r-tup').value/100;
    var cup=+document.getElementById('r-cup').value/100;
    document.getElementById('v-vis').textContent=vis.toLocaleString();
    document.getElementById('v-conv').textContent=(conv*100).toFixed(1)+'%';
    document.getElementById('v-val').textContent='$'+val.toLocaleString();
    document.getElementById('v-cls').textContent=Math.round(cls*100)+'%';
    document.getElementById('v-tup').textContent='+'+Math.round(tup*100)+'%';
    document.getElementById('v-cup').textContent='+'+(cup*100).toFixed(1)+'%';
    var cL=Math.round(vis*conv),cC=Math.round(cL*cls),cR=cC*val;
    document.getElementById('c-leads').textContent=cL;
    document.getElementById('c-clients').textContent=cC;
    document.getElementById('c-rev').textContent=fmt(cR);
    var nL=Math.round(vis*(1+tup)*(conv+cup)),nC=Math.round(nL*cls),nR=nC*val;
    document.getElementById('n-leads').textContent=nL;
    document.getElementById('n-clients').textContent=nC;
    document.getElementById('n-rev').textContent=fmt(nR);
    document.getElementById('annual-gain').textContent=fmt((nR-cR)*12);
  }
  document.querySelectorAll('.range').forEach(function(r){r.addEventListener('input',upd);});
  upd();
}

/* ── Audit ── */
function initAudit(){
  var btn=document.getElementById('audit-start');if(!btn)return;
  btn.addEventListener('click',function(){
    var url=(document.getElementById('audit-url')||{}).value||'';
    if(!url){alert('Please enter your website URL.');return;}
    document.getElementById('audit-form').style.display='none';
    document.getElementById('audit-prog').style.display='block';
    var LABELS=['Crawlability & indexation','Core Web Vitals','Local SEO signals','Schema markup','AI visibility','Generating report'];
    var PCTS=[14,30,48,64,80,100];
    var fill=document.getElementById('prog-fill');
    var stepsEl=document.getElementById('prog-steps');
    var i=0;
    function adv(){
      if(i>0){var p=stepsEl.querySelector('[data-s="'+(i-1)+'"]');if(p){p.className='prog-step done';p.textContent='✓ '+LABELS[i-1];}}
      if(i<LABELS.length){
        var c=stepsEl.querySelector('[data-s="'+i+'"]');
        if(c){c.className='prog-step cur';c.textContent='▶ '+LABELS[i]+'...';}
        if(fill)fill.style.width=PCTS[i]+'%';
        i++;setTimeout(adv,600+Math.random()*480);
      }else{setTimeout(showResult,380);}
    }
    adv();
  });
  function showResult(){
    document.getElementById('audit-prog').style.display='none';
    var res=document.getElementById('audit-result');if(!res)return;
    res.style.display='block';
    var score=Math.floor(Math.random()*22)+56;
    document.getElementById('res-score').textContent=score;
    var issues=[
      {s:'c',t:'No LocalBusiness schema markup found',d:'Search engines and AI platforms cannot verify your business category, hours, or service area.'},
      {s:'c',t:'LCP: 4.9s — Google threshold exceeded (2.5s)',d:'Your main content loads too slowly. This is a direct ranking penalty and causes visitor bounce.'},
      {s:'w',t:'Google Business Profile missing 4 required fields',d:'Incomplete GBP profiles rank lower in the local map pack than competitors who fill them out.'},
      {s:'w',t:'NAP inconsistency across 12 directories',d:'Name, Address, Phone mismatches reduce local trust signals and confuse search engines.'},
      {s:'w',t:'Not cited in ChatGPT, Perplexity, or Google AI Overviews',d:'AI search is now a primary discovery channel for local services. You are currently invisible.'},
      {s:'i',t:'3 service pages share duplicate title tags',d:'Duplicate titles cause keyword cannibalization and reduce individual page authority.'},
    ];
    var ctr=document.getElementById('res-issues');
    if(ctr)ctr.innerHTML=issues.map(function(iss){
      var cls=iss.s==='c'?'ri-c':iss.s==='w'?'ri-w':'ri-i';
      var lbl=iss.s==='c'?'Critical':iss.s==='w'?'Warning':'Info';
      return'<div class="res-issue"><span class="ri-badge '+cls+'">'+lbl+'</span><div><strong style="font-size:.88rem;color:var(--t)">'+iss.t+'</strong><p style="font-size:.82rem;margin-top:3px">'+iss.d+'</p></div></div>';
    }).join('');
    res.scrollIntoView({behavior:'smooth',block:'start'});
  }
}

/* ── Contact ── */
function initContact(){
  var btn=document.getElementById('contact-btn');if(!btn)return;
  btn.addEventListener('click',function(){
    var name=(document.getElementById('c-name')||{}).value||'';
    var email=(document.getElementById('c-email')||{}).value||'';
    if(!name||!email){alert('Please enter your name and email.');return;}
    btn.textContent='Sending…';btn.disabled=true;
    setTimeout(function(){
      btn.style.display='none';
      var msg=document.getElementById('contact-success');
      if(msg)msg.classList.add('show');
    },1100);
  });
}

/* ── Boot ── */
function boot(){
  initLoader();initCursor();initProgress();initNav();
  initReveal();initTerminal();initParallax();
  initCalc();initAudit();initContact();initMagnetic();
  function doScramble(){
    document.querySelectorAll('[data-scramble]').forEach(function(el){scramble(el,950);});
  }
  if(sessionStorage.getItem('sf-seen'))setTimeout(doScramble,200);
  else document.addEventListener('sf:ready',function(){setTimeout(doScramble,150);});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);
else boot();
})();

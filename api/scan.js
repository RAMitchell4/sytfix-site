const crypto = require('crypto');
const dns = require('dns').promises;

const UA = 'SytFixAuditBot/2.0 (+https://sytfix.com; real technical scanner)';
const MAX_HTML = 1_200_000;
const MAX_PAGES = Number(process.env.SYTFIX_MAX_PAGES || 8);
const MAX_LINK_CHECKS = Number(process.env.SYTFIX_MAX_LINK_CHECKS || 25);
const FETCH_TIMEOUT = Number(process.env.SYTFIX_FETCH_TIMEOUT_MS || 12000);

function json(res, status, data){
  res.statusCode = status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(data));
}
function decode(s){return String(s||'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#x2F;/g,'/');}
function strip(s){return decode(String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());}
function allMatches(html, re){return Array.from(String(html||'').matchAll(re));}
function attrFromTag(tag, name){const m = String(tag||'').match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`,'i')) || String(tag||'').match(new RegExp(`${name}\\s*=\\s*([^\\s>]+)`,'i')); return m?decode(m[1]):'';}
function textBetween(html, tag){const m=String(html||'').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,'i')); return m?strip(m[1]):'';}
function tagAttr(html, re, name){const m=String(html||'').match(re); return m?attrFromTag(m[0],name):'';}
function uniq(arr){return Array.from(new Set(arr.filter(Boolean)));}
function clamp(n,min,max){return Math.max(min,Math.min(max,n));}
function normalizePathScore(u){try{const x=new URL(u); x.hash=''; x.search=''; return x.href.replace(/\/$/,'');}catch(e){return String(u||'');}}

async function cleanTarget(raw){
  if(!raw || typeof raw !== 'string') throw new Error('Missing URL.');
  let value = raw.trim();
  if(!/^https?:\/\//i.test(value)) value = 'https://' + value;
  const url = new URL(value);
  if(!['http:','https:'].includes(url.protocol)) throw new Error('Only HTTP/HTTPS URLs can be scanned.');
  if(!url.hostname || url.hostname.length > 253) throw new Error('Invalid hostname.');
  if(/(^|\.)localhost$/i.test(url.hostname) || /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) || url.hostname === '::1') throw new Error('Private/local hosts are blocked.');
  try{
    const records = await dns.lookup(url.hostname, {all:true, verbatim:true});
    if(records.some(r => /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(r.address) || r.address === '::1')) throw new Error('Target resolves to a private/local address and is blocked.');
  }catch(e){ if(/private\/local/i.test(e.message)) throw e; }
  return url;
}
async function fetchText(url, timeoutMs=FETCH_TIMEOUT, accept='text/html,application/xhtml+xml,text/plain,*/*'){
  const ctrl = new AbortController();
  const timeout = setTimeout(()=>ctrl.abort(), timeoutMs);
  const started = Date.now();
  try{
    const r = await fetch(url, {headers:{'user-agent':UA,'accept':accept}, signal:ctrl.signal, redirect:'follow'});
    const ct = r.headers.get('content-type') || '';
    const body = (await r.text()).slice(0, MAX_HTML);
    return {ok:r.ok,status:r.status,url:r.url,headers:Object.fromEntries(r.headers.entries()),contentType:ct,body,ms:Date.now()-started,bytes:body.length};
  } finally { clearTimeout(timeout); }
}
function sameHost(u, base){try{const x=new URL(u,base); const b=new URL(base); return x.hostname.replace(/^www\./,'')===b.hostname.replace(/^www\./,'') && /^https?:$/.test(x.protocol);}catch(e){return false;}}
function internalLinks(html, base){
  const out = new Set();
  for(const m of allMatches(html, /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>/gi)){
    try{
      const href = decode(m[1]).trim();
      if(!href || /^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
      const u = new URL(href, base); u.hash='';
      if(sameHost(u.href, base)) out.add(normalizePathScore(u.href));
    }catch(e){}
  }
  return Array.from(out);
}
function absoluteAssetUrls(html, base, tag, attr){
  const out=[]; const re = new RegExp(`<${tag}\\b[^>]*${attr}\\s*=\\s*["']([^"']+)["'][^>]*>`,'gi');
  for(const m of allMatches(html,re)){try{const v=decode(m[1]); if(!/^(data:|mailto:|tel:|javascript:)/i.test(v)) out.push(new URL(v, base).href);}catch(e){}}
  return uniq(out);
}
function extractJsonLd(html){return allMatches(html, /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi).map(m=>decode(m[1]).trim()).filter(Boolean);}
function schemaTypes(blocks){
  const types=new Set();
  function walk(x){
    if(!x) return;
    if(Array.isArray(x)) return x.forEach(walk);
    if(typeof x==='object'){
      if(x['@type']) (Array.isArray(x['@type'])?x['@type']:[x['@type']]).forEach(t=>types.add(String(t)));
      Object.values(x).forEach(walk);
    }
  }
  for(const b of blocks){try{walk(JSON.parse(b));}catch(e){for(const m of allMatches(b, /"@type"\s*:\s*"([^"]+)"/gi)) types.add(m[1]);}}
  return Array.from(types);
}
function analyzePage(fetchResult){
  const html = fetchResult.body || ''; const url = fetchResult.url;
  const title = textBetween(html,'title');
  const desc = tagAttr(html, /<meta\b(?=[^>]*name\s*=\s*["']description["'])[^>]*>/i, 'content');
  const viewport = tagAttr(html, /<meta\b(?=[^>]*name\s*=\s*["']viewport["'])[^>]*>/i, 'content');
  const canonical = tagAttr(html, /<link\b(?=[^>]*rel\s*=\s*["'][^"']*canonical[^"']*["'])[^>]*>/i, 'href');
  const robots = tagAttr(html, /<meta\b(?=[^>]*name\s*=\s*["']robots["'])[^>]*>/i, 'content');
  const ogTitle = tagAttr(html, /<meta\b(?=[^>]*property\s*=\s*["']og:title["'])[^>]*>/i, 'content');
  const ogDesc = tagAttr(html, /<meta\b(?=[^>]*property\s*=\s*["']og:description["'])[^>]*>/i, 'content');
  const h1s = allMatches(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi).map(m=>strip(m[1])).filter(Boolean);
  const h2s = allMatches(html, /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi).map(m=>strip(m[1])).filter(Boolean);
  const imgs = allMatches(html, /<img\b[^>]*>/gi).map(m=>m[0]);
  const missingAlt = imgs.filter(tag=>!(/\salt\s*=\s*["'][^"']+["']/i.test(tag))).length;
  const links = internalLinks(html, url);
  const jsonLd = extractJsonLd(html); const types = schemaTypes(jsonLd);
  const text = strip(html); const words = text.split(/\s+/).filter(Boolean);
  const hasPhone = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(text);
  const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);
  const scripts = absoluteAssetUrls(html, url, 'script', 'src');
  const styles = absoluteAssetUrls(html, url, 'link', 'href').filter(u=>/\.css($|\?)/i.test(u) || /stylesheet/i.test(html));
  return {url,status:fetchResult.status,finalUrl:fetchResult.url,ms:fetchResult.ms,bytes:fetchResult.bytes,headers:fetchResult.headers,title,desc,viewport,canonical,robots,ogTitle,ogDesc,h1s,h2s,imgs:imgs.length,missingAlt,links,jsonLdCount:jsonLd.length,types,wordCount:words.length,hasPhone,hasEmail,scripts,styles};
}
async function getSitemapUrls(baseUrl){
  const base = new URL(baseUrl); const candidates=[new URL('/sitemap.xml', base).href, new URL('/sitemap_index.xml', base).href];
  const urls=[]; let found=false;
  for(const sm of candidates){
    try{const r=await fetchText(sm,7000,'application/xml,text/xml,*/*'); if(r.ok && /<urlset|<sitemapindex/i.test(r.body)){found=true; for(const m of allMatches(r.body, /<loc>\s*([^<\s]+)\s*<\/loc>/gi)){const loc=decode(m[1]); if(sameHost(loc, base.href)) urls.push(normalizePathScore(loc));}}}catch(e){}
  }
  return {found, urls:uniq(urls).slice(0, MAX_PAGES*2)};
}
async function crawl(target){
  const sitemap = await getSitemapUrls(target.href);
  const queue = [normalizePathScore(target.href), ...sitemap.urls].slice(0, MAX_PAGES*2);
  const seen = new Set(); const fetched=[]; const discovered=new Set(queue);
  while(queue.length && fetched.length < MAX_PAGES){
    const u = queue.shift(); if(seen.has(u)) continue; seen.add(u);
    try{
      const r = await fetchText(u);
      if(!/text\/html|application\/xhtml/i.test(r.contentType) && r.body && !/<html|<title|<h1/i.test(r.body)) { fetched.push(r); continue; }
      fetched.push(r);
      const links=internalLinks(r.body, r.url).filter(x=>!seen.has(x));
      links.forEach(x=>discovered.add(x));
      for(const link of links){ if(queue.length < MAX_PAGES*3 && !queue.includes(link)) queue.push(link); }
    }catch(e){ fetched.push({ok:false,status:0,url:u,headers:{},body:'',ms:0,bytes:0,error:e.message}); }
  }
  return {sitemap, fetched, discovered:Array.from(discovered).slice(0,60)};
}
async function checkUrls(urls){
  const sample = urls.slice(0, MAX_LINK_CHECKS); const out=[];
  for(const u of sample){
    try{const r=await fetch(u,{method:'HEAD',headers:{'user-agent':UA},redirect:'follow',signal:AbortSignal.timeout(7000)}); out.push({url:u,status:r.status,ok:r.ok});}
    catch(e){try{const r=await fetch(u,{headers:{'user-agent':UA},redirect:'follow',signal:AbortSignal.timeout(7000)}); out.push({url:u,status:r.status,ok:r.ok});}catch(err){out.push({url:u,status:0,ok:false,error:err.message});}}
  }
  return out;
}
async function runPsi(url){
  const key = process.env.PAGESPEED_API_KEY ? `&key=${encodeURIComponent(process.env.PAGESPEED_API_KEY)}` : '';
  const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&category=seo&category=accessibility&category=best-practices${key}`;
  try{const r=await fetch(api,{headers:{'user-agent':UA},signal:AbortSignal.timeout(28000)}); if(!r.ok) return null; return await r.json();}catch(e){return null;}
}
function severityClass(points){return points>=12?'c':points>=6?'w':'i';}
function buildReport(target, crawlData, pages, checkedLinks, robots, psi){
  const home = pages[0]; const issues=[]; const deductions={Performance:0,Technical:0,Local:0,AI:0,Accessibility:0,Trust:0,Security:0};
  const add=(cat,pts,t,d,proof,urls)=>{issues.push({s:severityClass(pts),pts,t,d,proof:proof.filter(Boolean),pages:urls.filter(Boolean),cat}); deductions[cat]=(deductions[cat]||0)+pts;};
  const ok=(cat,t,d,proof,urls)=>issues.push({s:'p',pts:0,t,d,proof:proof.filter(Boolean),pages:urls.filter(Boolean),cat});
  const allTypes=uniq(pages.flatMap(p=>p.types));
  const businessTypes=allTypes.filter(t=>/LocalBusiness|ProfessionalService|Organization|Corporation|Service|WebSite|WebPage|FAQPage|BreadcrumbList/i.test(t));
  const broken=checkedLinks.filter(x=>!x.ok || x.status>=400);
  const titles=pages.map(p=>p.title).filter(Boolean); const dupTitles=titles.filter((t,i)=>titles.indexOf(t)!==i);
  const descMissing=pages.filter(p=>!p.desc); const noH1=pages.filter(p=>p.h1s.length!==1);
  const noCanon=pages.filter(p=>!p.canonical); const noViewport=pages.filter(p=>!p.viewport);
  const thin=pages.filter(p=>p.wordCount<300); const altTotal=pages.reduce((a,p)=>a+p.imgs,0); const altMiss=pages.reduce((a,p)=>a+p.missingAlt,0);
  const avgWords=Math.round(pages.reduce((a,p)=>a+p.wordCount,0)/Math.max(1,pages.length));
  const h=home.headers||{};
  ok('Technical','Live crawl completed','SytFix fetched the target and parsed real page responses. No simulated report fallback was used.',[`Pages fetched: ${pages.length}`,`Internal URLs discovered: ${crawlData.discovered.length}`,`Average HTML fetch: ${Math.round(pages.reduce((a,p)=>a+p.ms,0)/Math.max(1,pages.length))}ms`],pages.map(p=>p.url).slice(0,6));
  if(crawlData.sitemap.found) ok('Technical','Sitemap detected','The scanner found a sitemap and used it to expand crawl coverage.',[`Sitemap URLs sampled: ${crawlData.sitemap.urls.length}`],[new URL('/sitemap.xml', target).href]);
  else add('Technical',5,'Sitemap not detected','No standard sitemap.xml or sitemap_index.xml was found during the scan.', ['Checked /sitemap.xml and /sitemap_index.xml'], [target.href]);
  if(robots && robots.ok) ok('Technical','robots.txt detected','A robots.txt file responded successfully.',[`HTTP ${robots.status}`],[new URL('/robots.txt',target).href]);
  else add('Technical',3,'robots.txt not verified','The scanner could not verify a successful robots.txt response.',[robots?`HTTP ${robots.status}`:'No response'],[new URL('/robots.txt',target).href]);
  if(home.status>=400 || home.status===0) add('Technical',22,'Homepage HTTP failure','The homepage did not return a successful fetch response.',[`HTTP ${home.status}`], [home.url]);
  else ok('Technical','Homepage HTTP response is healthy','The homepage returned a successful HTTP response.',[`HTTP ${home.status}`,`Final URL: ${home.finalUrl}`],[home.url]);
  if(!home.title) add('Technical',10,'Homepage title missing','The homepage does not expose a crawlable title tag.', ['No <title> found'], [home.url]);
  else if(home.title.length<25 || home.title.length>70) add('Technical',5,'Homepage title length needs tuning','The homepage title exists, but it is outside the usual search-snippet comfort range.',[`Length: ${home.title.length}`,home.title],[home.url]);
  else ok('Technical','Homepage title is crawlable','The homepage exposes a reasonably sized title tag.',[`Length: ${home.title.length}`,home.title],[home.url]);
  if(descMissing.length) add('Technical',Math.min(10,4+descMissing.length*2),'Missing meta descriptions','One or more crawled pages are missing meta descriptions.',[`Missing descriptions: ${descMissing.length}/${pages.length}`],descMissing.map(p=>p.url).slice(0,8));
  else ok('Technical','Meta descriptions present','Every crawled page exposes a meta description.',[`Checked pages: ${pages.length}`],pages.map(p=>p.url).slice(0,6));
  if(dupTitles.length) add('Technical',8,'Duplicate page titles detected','Multiple crawled pages share identical title text, which weakens page differentiation.',[`Duplicate titles: ${uniq(dupTitles).length}`, ...uniq(dupTitles).slice(0,3)], pages.filter(p=>dupTitles.includes(p.title)).map(p=>p.url).slice(0,8));
  if(noH1.length) add('Technical',Math.min(12,4+noH1.length*2),'H1 structure issues detected','Every important page should expose exactly one primary H1.',[`Pages with non-ideal H1 count: ${noH1.length}/${pages.length}`],noH1.map(p=>`${p.url} (${p.h1s.length} H1s)`).slice(0,8));
  else ok('Technical','H1 structure is clean','Every crawled page has exactly one primary H1.',[`Checked pages: ${pages.length}`],pages.map(p=>p.url).slice(0,6));
  if(noCanon.length) add('Technical',Math.min(8,2+noCanon.length*2),'Canonical coverage incomplete','Canonical tags help consolidate duplicate URL variants and ranking signals.',[`Pages missing canonical: ${noCanon.length}/${pages.length}`],noCanon.map(p=>p.url).slice(0,8));
  if(noViewport.length) add('Technical',8,'Mobile viewport missing on crawled pages','Missing viewport tags can break mobile rendering and perceived quality.',[`Pages missing viewport: ${noViewport.length}/${pages.length}`],noViewport.map(p=>p.url).slice(0,8));
  if(broken.length) add('Technical',Math.min(14,5+broken.length*3),'Broken internal links found','The scanner checked internal links and found failing responses.',[`Broken/blocked links: ${broken.length}/${checkedLinks.length}`],broken.map(x=>`${x.url} — HTTP ${x.status}`).slice(0,10));
  else ok('Technical','Internal link sample passed','No broken internal links were found in the checked sample.',[`Links checked: ${checkedLinks.length}`],checkedLinks.map(x=>x.url).slice(0,6));
  if(!businessTypes.length) add('Local',14,'Entity schema not verified','No Organization, LocalBusiness, ProfessionalService, Service, WebSite, FAQPage, or Breadcrumb schema type was detected.',[`Schema types: ${allTypes.join(', ') || 'none'}`],pages.map(p=>p.url).slice(0,6));
  else ok('Local','Entity schema detected','Machine-readable entity/schema data was found.',[`Types: ${businessTypes.join(', ')}`],pages.filter(p=>p.types.length).map(p=>p.url).slice(0,6));
  const hasPhone=pages.some(p=>p.hasPhone), hasEmail=pages.some(p=>p.hasEmail);
  if(!hasPhone || !hasEmail) add('Trust',6,'Visible contact signals incomplete','The crawl could not verify both a phone number and email in visible page text.',[`Phone detected: ${hasPhone}`,`Email detected: ${hasEmail}`],pages.map(p=>p.url).slice(0,6));
  else ok('Trust','Visible contact signals verified','The crawl found both a phone number and an email address in visible text.',[`Phone detected: true`,`Email detected: true`],pages.filter(p=>p.hasPhone||p.hasEmail).map(p=>p.url).slice(0,6));
  if(altTotal && altMiss/altTotal>.2) add('Accessibility',Math.min(10,3+Math.round((altMiss/altTotal)*10)),'Image alt coverage is weak','More than 20% of detected images are missing alt text.',[`Images: ${altTotal}`,`Missing alt: ${altMiss}`],pages.filter(p=>p.missingAlt).map(p=>p.url).slice(0,8));
  else ok('Accessibility','Image alt coverage is acceptable','Detected image alt coverage passed the first-pass threshold.',[`Images: ${altTotal}`,`Missing alt: ${altMiss}`],pages.map(p=>p.url).slice(0,6));
  if(thin.length) add('AI',Math.min(10,3+thin.length*2),'Thin extractable content detected','AI retrieval and search systems need clear, crawlable explanatory text to understand offerings and entity context.',[`Thin pages: ${thin.length}/${pages.length}`,`Average words/page: ${avgWords}`],thin.map(p=>`${p.url} — ${p.wordCount} words`).slice(0,8));
  else ok('AI','Extractable content volume is healthy','Crawled pages expose enough text for first-pass AI/search retrieval analysis.',[`Average words/page: ${avgWords}`],pages.map(p=>p.url).slice(0,6));
  const aiSignals=(businessTypes.length?1:0)+(pages.some(p=>p.h2s.length>=3)?1:0)+(pages.some(p=>/FAQPage/i.test(p.types.join(' ')))?1:0)+(avgWords>500?1:0)+(pages.some(p=>p.ogTitle&&p.ogDesc)?1:0);
  if(aiSignals<3) add('AI',7,'AI-readiness structure is underdeveloped','The site lacks enough structured, citation-ready signals for strong AI retrieval confidence.',[`AI readiness signals: ${aiSignals}/5`,`Schema: ${businessTypes.length?'present':'weak'}`,`FAQ schema: ${allTypes.includes('FAQPage')}`],pages.map(p=>p.url).slice(0,6));
  else ok('AI','AI-readiness structure is credible','The site exposes multiple signals that help AI/search systems classify the business.',[`AI readiness signals: ${aiSignals}/5`],pages.map(p=>p.url).slice(0,6));
  if(!h['strict-transport-security']) add('Security',4,'HSTS header not detected','Strict-Transport-Security was not present on the homepage response.', ['Header missing: strict-transport-security'], [home.url]);
  else ok('Security','HSTS detected','The homepage response includes Strict-Transport-Security.', [h['strict-transport-security']], [home.url]);
  if(!h['content-security-policy']) add('Security',4,'Content Security Policy not detected','A CSP reduces exposure to script injection and asset loading risks.', ['Header missing: content-security-policy'], [home.url]);
  if(!h['x-content-type-options']) add('Security',2,'X-Content-Type-Options missing','This response header helps prevent MIME sniffing.', ['Header missing: x-content-type-options'], [home.url]);
  if(psi && psi.lighthouseResult){
    const cats=psi.lighthouseResult.categories||{}, audits=psi.lighthouseResult.audits||{};
    const perf=Math.round(((cats.performance||{}).score ?? 0)*100), seo=Math.round(((cats.seo||{}).score ?? 0)*100), acc=Math.round(((cats.accessibility||{}).score ?? 0)*100), bp=Math.round(((cats['best-practices']||{}).score ?? 0)*100);
    const lcp=audits['largest-contentful-paint']?.displayValue || 'unavailable'; const cls=audits['cumulative-layout-shift']?.displayValue || 'unavailable'; const tbt=audits['total-blocking-time']?.displayValue || 'unavailable';
    if(perf<70) add('Performance',16,'Mobile performance is weak','PageSpeed/Lighthouse reports a weak mobile performance category score.',[`Performance: ${perf}/100`,`LCP: ${lcp}`,`CLS: ${cls}`,`TBT: ${tbt}`],[home.url]);
    else if(perf<90) add('Performance',8,'Mobile performance can improve','PageSpeed/Lighthouse reports a usable but not elite mobile performance score.',[`Performance: ${perf}/100`,`LCP: ${lcp}`,`CLS: ${cls}`,`TBT: ${tbt}`],[home.url]);
    else ok('Performance','Mobile performance is strong','PageSpeed/Lighthouse reports a strong mobile performance score.',[`Performance: ${perf}/100`,`LCP: ${lcp}`,`CLS: ${cls}`,`TBT: ${tbt}`],[home.url]);
    if(seo<90) add('Technical',5,'Lighthouse SEO below 90','Google Lighthouse found SEO category gaps.',[`SEO: ${seo}/100`],[home.url]); else ok('Technical','Lighthouse SEO is strong','Google Lighthouse SEO category is strong.',[`SEO: ${seo}/100`],[home.url]);
    if(acc<90) add('Accessibility',5,'Lighthouse accessibility below 90','Lighthouse found accessibility gaps that may affect usability.',[`Accessibility: ${acc}/100`],[home.url]); else ok('Accessibility','Lighthouse accessibility is strong','Google Lighthouse accessibility category is strong.',[`Accessibility: ${acc}/100`],[home.url]);
    if(bp<90) add('Security',3,'Lighthouse best-practices below 90','Best-practices issues may indicate browser/security hygiene gaps.',[`Best Practices: ${bp}/100`],[home.url]);
  } else add('Performance',3,'PageSpeed receipt unavailable','The HTML crawl completed, but PageSpeed did not return a usable Lighthouse report during this request.', ['Source attempted: PageSpeed Insights API'], [home.url]);
  const categoryCaps={Performance:20,Technical:25,Local:15,AI:15,Accessibility:10,Trust:10,Security:5};
  let penalty=Object.keys(categoryCaps).reduce((sum,k)=>sum+Math.min(categoryCaps[k],deductions[k]||0),0);
  const score=clamp(100-penalty,0,100);
  const weights={}; Object.keys(categoryCaps).forEach(k=>weights[k]=Math.max(0,categoryCaps[k]-Math.min(categoryCaps[k],deductions[k]||0)));
  const status=score>=92?'Verified Strong':score>=80?'Strong, Needs Tuning':score>=65?'Needs Attention':'High Risk';
  return {score,status,issues,weights,categoryCaps,deductions,scanId:crypto.randomBytes(6).toString('hex'),scannedAt:new Date().toISOString(),target:target.href,finalUrl:home.finalUrl,sources:['Live HTML fetch','Multi-page internal crawl','Sitemap discovery','robots.txt check','HTTP response headers','DOM metadata parser','JSON-LD/schema parser','Internal link status sampling',psi?'PageSpeed Insights/Lighthouse':'PageSpeed attempted'],crawl:{pagesFetched:pages.length,urlsDiscovered:crawlData.discovered.length,linksChecked:checkedLinks.length,brokenLinks:broken.length,maxPages:MAX_PAGES}};
}
module.exports = async function handler(req,res){
  if(req.method==='OPTIONS') return json(res,200,{ok:true});
  if(req.method!=='POST') return json(res,405,{ok:false,error:'POST required'});
  try{
    let raw=''; for await (const chunk of req) raw += chunk;
    const input = raw ? JSON.parse(raw) : {};
    const target = await cleanTarget(input.url);
    const crawlData = await crawl(target);
    if(!crawlData.fetched.length || !crawlData.fetched[0].body) throw new Error('No crawlable HTML returned from target.');
    const pages = crawlData.fetched.map(analyzePage);
    let robots=null; try{robots=await fetchText(new URL('/robots.txt', target).href,7000,'text/plain,*/*');}catch(e){robots={ok:false,status:0,error:e.message};}
    const linkPool = uniq(pages.flatMap(p=>p.links)).filter(u=>sameHost(u,target.href));
    const checkedLinks = await checkUrls(linkPool);
    const psi = await runPsi(pages[0].finalUrl || target.href);
    const report = buildReport(target,crawlData,pages,checkedLinks,robots,psi);
    return json(res,200,{ok:true,report});
  }catch(e){return json(res,400,{ok:false,error:e.message || 'Scanner failed'});}
};

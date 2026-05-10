#!/usr/bin/env python3
"""
SytFix real-scanner deployer for Termux.

What it does:
1. Verifies/installs git, nodejs, npm with pkg when available.
2. Validates core site files and internal links.
3. Creates/updates a GitHub repo if GITHUB_TOKEN is set.
4. Deploys the complete frontend + /api/scan serverless scanner to Vercel if VERCEL_TOKEN is set.

Required for one-command production deploy:
  export VERCEL_TOKEN="..."
Optional but recommended:
  export GITHUB_TOKEN="..."
  export GITHUB_USER="RAMitchell4"
  export REPO_NAME="sytfix-real-scanner"
  export PAGESPEED_API_KEY="..."   # optional; unauthenticated PageSpeed works but rate-limits sooner

Run:
  python deploy_termux.py
"""
import os, sys, json, subprocess, pathlib, re, urllib.request
ROOT = pathlib.Path(__file__).resolve().parent

def sh(cmd, check=True, env=None):
    print("$", " ".join(cmd))
    return subprocess.run(cmd, cwd=ROOT, check=check, text=True, env=env or os.environ.copy())

def have(cmd):
    from shutil import which
    return which(cmd) is not None

def ensure_tools():
    if have('pkg'):
        missing=[x for x in ['git','node','npm'] if not have(x)]
        if missing:
            sh(['pkg','update','-y'], check=False)
            sh(['pkg','install','-y','git','nodejs'], check=False)
    for tool in ['git','node','npm']:
        if not have(tool):
            raise SystemExit(f"Missing {tool}. In Termux run: pkg install git nodejs python -y")

def validate_files():
    required=['index.html','audit.html','css/main.css','js/app.js','api/scan.js','package.json','vercel.json']
    missing=[p for p in required if not (ROOT/p).exists()]
    if missing: raise SystemExit('Missing required files: '+', '.join(missing))
    htmls=list(ROOT.glob('*.html'))
    files={p.name for p in htmls}
    broken=[]
    for p in htmls:
        txt=p.read_text(errors='ignore')
        for href in re.findall(r'href=["\']([^"\']+)["\']', txt):
            if href.startswith(('http','mailto:','tel:','#')) or href.startswith('javascript:'): continue
            clean=href.split('#')[0].split('?')[0].lstrip('./')
            if clean and clean.endswith('.html') and clean not in files:
                broken.append(f'{p.name} -> {href}')
    if broken: raise SystemExit('Broken internal links:\n'+'\n'.join(broken))
    sh(['node','-c','api/scan.js'])
    print('Preflight passed.')

def github_push():
    token=os.getenv('GITHUB_TOKEN')
    user=os.getenv('GITHUB_USER','RAMitchell4')
    repo=os.getenv('REPO_NAME','sytfix-real-scanner')
    if not token:
        print('GITHUB_TOKEN not set; skipping GitHub repo push.')
        return
    api=f'https://api.github.com/user/repos'
    data=json.dumps({'name':repo,'private':False,'auto_init':False}).encode()
    req=urllib.request.Request(api,data=data,headers={'Authorization':f'token {token}','Accept':'application/vnd.github+json','Content-Type':'application/json'})
    try: urllib.request.urlopen(req, timeout=20).read(); print('GitHub repo created.')
    except Exception as e: print('GitHub repo create skipped/exists:', e)
    if not (ROOT/'.git').exists(): sh(['git','init'])
    sh(['git','branch','-M','main'], check=False)
    sh(['git','add','.'])
    sh(['git','commit','-m','Deploy SytFix real scanner'], check=False)
    remote=f'https://{user}:{token}@github.com/{user}/{repo}.git'
    sh(['git','remote','remove','origin'], check=False)
    sh(['git','remote','add','origin',remote])
    sh(['git','push','-u','origin','main','--force'])
    print(f'GitHub pushed: https://github.com/{user}/{repo}')

def vercel_deploy():
    token=os.getenv('VERCEL_TOKEN')
    if not token:
        print('\nVERCEL_TOKEN not set. The scanner backend cannot deploy to GitHub Pages alone.')
        print('Set VERCEL_TOKEN, then rerun: python deploy_termux.py')
        print('Local test: npm i -g vercel && vercel dev')
        return
    if not have('vercel'):
        sh(['npm','i','-g','vercel'])
    env=os.environ.copy()
    if os.getenv('PAGESPEED_API_KEY'):
        sh(['vercel','env','rm','PAGESPEED_API_KEY','production','--yes','--token',token], check=False)
        p=subprocess.Popen(['vercel','env','add','PAGESPEED_API_KEY','production','--token',token], cwd=ROOT, text=True, stdin=subprocess.PIPE)
        p.communicate(os.getenv('PAGESPEED_API_KEY')+'\n')
    sh(['vercel','deploy','--prod','--yes','--token',token], env=env)
    print('\nProduction deploy complete. Test /audit.html and submit sytfix.com.')

if __name__=='__main__':
    ensure_tools(); validate_files(); github_push(); vercel_deploy()

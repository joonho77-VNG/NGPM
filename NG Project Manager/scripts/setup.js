#!/usr/bin/env node
// One-time setup of a PC to run the NG automation, and a health check afterwards.
//
//   node scripts/setup.js          install what is missing, then check everything
//   node scripts/setup.js --check  check only, change nothing
//
// It never touches credentials. The ATLASSIAN_* variables are set by the person, by hand.
// Safe to re-run at any time.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const CHECK = process.argv.includes('--check');
const HOME = path.join(os.homedir(), '.ng-pm');
const results = [];
const ok   = (s) => results.push(['OK  ', s]);
const fail = (s, fix) => results.push(['FAIL', s + (fix ? `\n        -> ${fix}` : '')]);
const warn = (s, fix) => results.push(['WARN', s + (fix ? `\n        -> ${fix}` : '')]);
const ps = (cmd) => execSync(`powershell -NoProfile -Command "${cmd}"`, { encoding: 'utf8' }).trim();

(async () => {
  // 1 - Node
  const major = +process.versions.node.split('.')[0];
  major >= 18 ? ok(`Node ${process.versions.node}`)
              : fail(`Node ${process.versions.node} is too old`, 'Install Node.js LTS (18 or newer), then restart Claude.');

  // 2 - the library
  let C;
  try { C = require('./config.js'); ok(`Library found: ${C.ROOT}`); }
  catch (e) {
    fail('Vision NG - Grouping library not found', 'In SharePoint, open the library and click "Add shortcut to My files", then wait for OneDrive to sync.');
    return report();
  }

  // 3 - files must be real files, not cloud placeholders (Always keep on this device)
  try {
    const attr = +ps(`[int](Get-Item -LiteralPath '${C.MASTER.replace(/'/g, "''")}').Attributes`);
    const PINNED = 0x80000, UNPINNED = 0x100000, RECALL = 0x400000;
    if (attr & PINNED) ok('Library is set to "Always keep on this device"');
    else if (attr & (UNPINNED | RECALL)) fail('Library files are online-only placeholders',
      'In File Explorer, right-click the "Vision NG - Grouping" folder -> "Always keep on this device".');
    else warn('Could not confirm "Always keep on this device"', 'Right-click the library folder in File Explorer and choose it to be sure.');
  } catch (e) { warn('Could not read file attributes: ' + e.message); }

  // 4 - node_modules in ~/.ng-pm (per PC, never synced)
  const pkg = path.join(__dirname, 'package.json');
  const hasDeps = () => { try { C.req.resolve('exceljs'); return true; } catch (e) { return false; } };
  if (!hasDeps() && !CHECK) {
    fs.mkdirSync(HOME, { recursive: true });
    fs.copyFileSync(pkg, path.join(HOME, 'package.json'));
    fs.copyFileSync(path.join(__dirname, 'package-lock.json'), path.join(HOME, 'package-lock.json'));
    console.log('Installing packages into ' + HOME + ' ...');
    try { execSync('npm ci --no-audit --no-fund', { cwd: HOME, stdio: 'inherit', shell: true }); }
    catch (e) { fail('npm install failed', 'Check network/proxy access to registry.npmjs.org, then re-run.'); }
  }
  hasDeps() ? ok(`Packages installed in ${HOME}`) : fail('exceljs is not installed', 'Run: node scripts/setup.js');
  fs.mkdirSync(path.join(HOME, 'work'), { recursive: true });

  // 5 - Excel desktop (uatwrite.ps1 writes the QA logs through Excel)
  try { ps("$x = New-Object -ComObject Excel.Application; $x.Quit()"); ok('Excel desktop is available'); }
  catch (e) { warn('Excel desktop not found', 'The UAT -> QA defect-log sync needs desktop Excel. Everything else works without it.'); }

  // 6 - Jira credentials
  const vars = ['ATLASSIAN_SITE_URL', 'ATLASSIAN_USER_EMAIL', 'ATLASSIAN_API_TOKEN'];
  const missing = vars.filter(v => !process.env[v]);
  if (missing.length) {
    const saved = missing.filter(v => { try { return !!ps(`[Environment]::GetEnvironmentVariable('${v}','User')`); } catch (e) { return false; } });
    if (saved.length === missing.length)
      fail(`${missing.join(', ')} saved but not loaded yet`, 'Fully quit the Claude app (system tray too) and reopen it.');
    else
      fail(`Not set: ${missing.join(', ')}`, 'Set them as Windows user environment variables (see the bootstrap guide), then restart Claude.');
  } else {
    try {
      const { jget } = require('./jira.js');
      const me = await jget('/rest/api/3/myself');
      ok(`Jira login works: ${me.displayName} (${me.emailAddress || process.env.ATLASSIAN_USER_EMAIL})`);
      const p = await jget('/rest/api/3/project/VISAR');
      ok(`Jira project ${p.key} is readable`);
    } catch (e) {
      fail('Jira rejected the credentials: ' + e.message.slice(0, 120),
        'Check the email matches your Atlassian login and the token is current (id.atlassian.com -> Security -> API tokens).');
    }
  }

  // 7 - shared state reachable
  for (const f of ['roster.json', 'activity-log.json']) {
    fs.existsSync(C.shared(f)) ? ok(`Shared state: ${f}`) : fail(`Missing shared state: ${f}`, 'Wait for OneDrive to finish syncing "NG Dashboard State".');
  }
  report();
})().catch(e => { fail('Setup crashed: ' + e.message); report(); });

function report() {
  console.log('\n================ NG SETUP ================');
  results.forEach(([k, s]) => console.log(`${k}  ${s}`));
  const bad = results.filter(r => r[0] === 'FAIL').length;
  console.log(bad ? `\n${bad} item(s) need attention.` : '\nAll set. Try: node scripts/refresh.js --dry-run');
  console.log('==========================================');
  process.exitCode = bad ? 1 : 0;
}

#!/usr/bin/env node
// Collect an exported notes file and present it for processing.
//
//   node decisions.js            find newest, move it into NG Meeting Decisions, print it
//   node decisions.js --list     show what is available, move nothing
//   node decisions.js --archive  mark the newest file processed (moves to processed/)
//
// Looks in NG Meeting Decisions first, then the Downloads folder.

const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('./config.js');

const ARGS = process.argv.slice(2);
const DOWNLOADS = path.join(os.homedir(), 'Downloads');
const PROCESSED = path.join(C.DECISIONS, 'processed');
const RX = /^ng-decisions-.*\.json$/i;

const scan = dir => {
  try {
    return fs.readdirSync(dir).filter(f => RX.test(f))
      .map(f => ({dir, f, full: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs}));
  } catch (e) { return []; }
};

const inFolder = scan(C.DECISIONS);
const inDownloads = scan(DOWNLOADS);
const all = [...inFolder, ...inDownloads].sort((a, b) => b.mtime - a.mtime);

if (ARGS.includes('--list')) {
  console.log(`NG Meeting Decisions: ${inFolder.length} file(s)`);
  inFolder.forEach(x => console.log(`   ${x.f}   ${new Date(x.mtime).toLocaleString()}`));
  console.log(`Downloads:            ${inDownloads.length} file(s)`);
  inDownloads.forEach(x => console.log(`   ${x.f}   ${new Date(x.mtime).toLocaleString()}`));
  process.exit(0);
}

if (!all.length) {
  console.log('No decisions file found.');
  console.log(`  looked in: ${C.DECISIONS}`);
  console.log(`  looked in: ${DOWNLOADS}`);
  console.log('Open the dashboard, enter notes, click "Save notes", then run this again.');
  process.exit(3);
}

const newest = all[0];

if (ARGS.includes('--archive')) {
  fs.mkdirSync(PROCESSED, {recursive: true});
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 13);
  const dest = path.join(PROCESSED, newest.f.replace(/\.json$/i, `_${stamp}.json`));
  fs.renameSync(newest.full, dest);
  console.log('archived -> ' + dest);
  process.exit(0);
}

// move into the decisions folder if it landed in Downloads
let src = newest.full;
if (newest.dir === DOWNLOADS) {
  fs.mkdirSync(C.DECISIONS, {recursive: true});
  const dest = path.join(C.DECISIONS, newest.f);
  fs.renameSync(src, dest);
  src = dest;
  console.log(`moved from Downloads -> NG Meeting Decisions`);
}

const j = JSON.parse(fs.readFileSync(src, 'utf8'));
const notes = j.notes || [];
console.log(`file     : ${path.basename(src)}`);
console.log(`exported : ${j.generated}`);
console.log(`notes    : ${notes.length}`);
console.log('');

const bySection = {};
notes.forEach(n => (bySection[n.section] = bySection[n.section] || []).push(n));
Object.keys(bySection).forEach(sec => {
  console.log(`=== ${sec} ===`);
  bySection[sec].forEach(n => {
    const who = n.w ? 'W#' + n.w : n.subtask;
    console.log(`  [${who}] ${n.window}  (${n.subtask})`);
    String(n.note).split(/\r?\n/).forEach(l => console.log(`        ${l}`));
  });
  console.log('');
});

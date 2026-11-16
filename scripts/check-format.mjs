// Formatting check for every file Git tracks (and new files not yet ignored). Enforces the conventions the code
// already follows, as written in .editorconfig: UTF-8 (and not double-encoded), LF line endings in the repository, no tab indentation, no
// trailing whitespace and exactly one final newline. Read-only by default; `--fix` rewrites what it safely can.
//   node scripts/check-format.mjs          check (exit 1 on any problem)
//   node scripts/check-format.mjs --fix    fix trailing whitespace and final newlines in the working tree
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const fix = process.argv.includes('--fix');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// Generated files keep whatever format their tool writes.
const SKIP = [/(^|\/)package-lock\.json$/, /\/migrations\/.*\.sql$/, /^server\/src\/generated\//];
// Markdown uses two trailing spaces as a line break; tabs are legitimate in these formats.
const KEEPS_TRAILING_SPACE = /\.md$/;
const TABS_ALLOWED = /(^|\/)Makefile$|\.(tsv|go)$/;

// `git ls-files --eol` reports how each file is stored in the index (i/lf, i/crlf, i/mixed, i/-text for binaries).
const indexEol = new Map(
  git('ls-files', '--eol', '-z').split('\0').filter(Boolean).map(line => {
    const [info, path] = line.split('\t');
    return [path, info.split(/\s+/)[0]];
  }),
);
const files = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean);

const problems = [];
let checked = 0, fixed = 0;
for (const file of files) {
  if (SKIP.some(re => re.test(file))) continue;
  let buf;
  try { buf = readFileSync(file); } catch { continue; } // deleted in the working tree
  if (indexEol.get(file) === 'i/-text' || buf.includes(0)) continue; // binary
  checked++;

  const text = buf.toString('utf8');
  const report = msg => problems.push(`${file}: ${msg}`);
  if (!Buffer.from(text, 'utf8').equals(buf)) { report('is not valid UTF-8'); continue; }
  if (text.charCodeAt(0) === 0xfeff) report('starts with a byte-order mark');
  // UTF-8 that was decoded as Windows-1252 and saved again, e.g. a middle dot turning into U+00C2 U+00B7 or an
  // e-acute into U+00C3 U+00A9. Legitimate text practically never contains these pairs.
  const mojibake = text.search(/[\u00C2\u00C3][\u0080-\u00BF]|\u00E2\u20AC/);
  if (mojibake >= 0) report(`line ${text.slice(0, mojibake).split('\n').length}: text that was double-encoded (mojibake), restore the original characters`);
  // CRLF in the working tree is fine when Git converts it on checkout (core.autocrlf); CRLF stored in the repository is not.
  if (['i/crlf', 'i/mixed'].includes(indexEol.get(file))) report('is committed with CRLF line endings (use LF)');

  const keepTrailing = KEEPS_TRAILING_SPACE.test(file);
  const normalised = text.replace(/\r\n/g, '\n');
  const lines = normalised.split('\n');
  lines.forEach((line, i) => {
    if (!keepTrailing && /[ \t]+$/.test(line)) report(`line ${i + 1}: trailing whitespace`);
    if (!TABS_ALLOWED.test(file) && /^ *\t/.test(line)) report(`line ${i + 1}: tab indentation (use spaces)`);
  });
  if (text.length && !text.endsWith('\n')) report('has no final newline');
  if (/\n[ \t]*\n$/.test(normalised)) report('ends with blank lines');

  if (fix) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n'; // keep autocrlf checkouts as Git wrote them
    const body = (keepTrailing ? lines : lines.map(l => l.replace(/[ \t]+$/, ''))).join('\n').replace(/\s+$/, '');
    let out = (body ? `${body}\n` : '').replace(/\n/g, eol);
    if (out.charCodeAt(0) === 0xfeff) out = out.slice(1); // drop a byte-order mark
    if (out !== text) { writeFileSync(file, out); fixed++; }
  }
}

if (fix) {
  console.log(`format: ${checked} files checked, ${fixed} fixed. Tab indentation and committed CRLF must be fixed by hand.`);
} else if (problems.length) {
  console.error(problems.slice(0, 200).join('\n'));
  if (problems.length > 200) console.error(`...and ${problems.length - 200} more`);
  console.error(`\nformat:check found ${problems.length} problem(s). \`npm run format\` fixes whitespace and final newlines.`);
  process.exit(1);
} else {
  console.log(`format:check: ${checked} files checked, no problems.`);
}

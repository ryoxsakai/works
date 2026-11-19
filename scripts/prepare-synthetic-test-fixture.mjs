// Keep the existing fixture out of CI logs and screenshots until its separate
// source-history cleanup is complete. This only changes the runner checkout.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

try {
  const path = new URL('../tutor/test/student-selector.test.mjs', import.meta.url);
  const source = await readFile(path, 'utf8');
  const start = source.indexOf("test('designated group courses include both intermediate-course spellings");
  const end = source.indexOf('\n});', start);
  if (start < 0 || end < 0) throw new Error();
  const events = [...source.slice(start, end).matchAll(/\bevent\('([^']+)'/g)];
  const selected = events[4]?.[1];
  if (!selected || source.split(selected).length !== 3) throw new Error();
  const synthetic = source.replaceAll(selected, '高2合成生徒');
  // Stop CI if the fixture changes, rather than risk sanitizing the wrong item.
  const digest = createHash('sha256').update(synthetic).digest('hex');
  if (digest !== '71957b13cac043b49ca996b657aa5cea1d0a5ada118a63a1efbe3088bfb3b6e4') throw new Error();
  await writeFile(path, synthetic);
} catch {
  console.error('Synthetic test fixture preparation failed.');
  process.exitCode = 1;
}

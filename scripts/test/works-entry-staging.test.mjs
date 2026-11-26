import test from 'node:test';
import assert from 'node:assert/strict';
import { isWorksEntryAsset } from '../stage-works-entry.mjs';
test('private Works asset staging permits the service UI, not source or tests', () => {
  for (const path of ['index.html','shared/auth.js','todo/index.html','tutor/calendar-migration.html','app/assets/app.eot','app/licenses/boxicons.txt']) assert.equal(isWorksEntryAsset(path), true, path);
  for (const path of ['CNAME','.git/config','shared/../worker/schema.sql','worker/src/index.js','docs/privacy.md','shared/ui/package.json','tutor/test/student-selector.test.mjs','app/assets/app.js.map','shared//auth.js'])
    assert.equal(isWorksEntryAsset(path), false, path);
});

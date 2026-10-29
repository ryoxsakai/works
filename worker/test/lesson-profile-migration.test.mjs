import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
test('exact additive mapping SQL restores with full legacy schema, preserves rows and blocks audit mutation',()=>{const r=spawnSync('python3',['-c',`import sqlite3,sys
c=sqlite3.connect(':memory:')
c.executescript(open(sys.argv[1]).read())
c.execute("INSERT INTO curriculum_entries(calendar_event_id,lesson_plan)VALUES('synthetic-preserved','keep')")
before=c.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
c.executescript(open(sys.argv[2]).read())
assert c.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0]==before+1
c.executescript(open(sys.argv[2]).read())
assert c.execute("SELECT lesson_plan FROM curriculum_entries WHERE calendar_event_id='synthetic-preserved'").fetchone()[0]=='keep'
assert c.execute("PRAGMA integrity_check").fetchone()[0]=='ok'
assert c.execute("SELECT count(*) FROM lesson_profile_mapping").fetchone()[0]==0
assert c.execute("SELECT count(*) FROM sqlite_master WHERE name IN ('lesson_profile_mapping','lesson_profile_mapping_source','lesson_profile_mapping_no_update','lesson_profile_mapping_no_delete')").fetchone()[0]==4
print('additive schema intact; zero bindings')`,fileURLToPath(new URL('../schema.sql',import.meta.url)),fileURLToPath(new URL('../migrations/20261029_lesson_profile_mapping.sql',import.meta.url))],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/zero bindings/);});

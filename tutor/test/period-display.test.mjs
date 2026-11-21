import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPeriodProfiles, lessonPeriodDisplay, lessonPeriodText, readPeriodProfiles } from '../../shared/tutor-period-display.mjs';

const common = [{ label: '1限', start_time: '08:00' }, { label: '2限', start_time: '12:00' }];
const iso = minute => '2026-11-21T' + minute + ':00+09:00';
const text = (...args) => lessonPeriodText(lessonPeriodDisplay(...args));
test('absent settings keep all legacy surfaces and the existing common periods', () => {
  const config = readPeriodProfiles(undefined);
  const options = { legacyTimeZone: 'Asia/Tokyo' };
  assert.deepEqual(config, defaultPeriodProfiles());
  assert.equal(text(iso('13:10'), 'any', common, config, options), '2限');
  assert.deepEqual(lessonPeriodDisplay(iso('13:10'), 'any', common, config, {...options, legacyMode:'legacy-list'}), {primary:'13:10',secondary:'2限'});
  assert.equal(text(iso('13:10'), 'any', common, config, {...options, legacyMode:'time'}), '13:10');
  assert.equal(text(iso('07:10'), 'any', common, config, options), '07:10');
});
test('same start is independent by calendar ID; same free label at two starts; non-matching time is real JST', () => {
  const config = defaultPeriodProfiles();
  config.schools.tomas = { mode: 'both', calendar_ids: ['sample-a'], periods: [
    { label: 'S限', start_time:'09:45' }, { label: 'A限', start_time:'10:05' },
    { label: 'A限', start_time:'11:10' },
  ] };
  config.schools.daikanyama = { mode: 'label', calendar_ids: ['sample-b','sample-b-group'], periods: [{label:'第3講',start_time:'09:45'}] };
  config.schools.shukutoku_yono = { mode: 'time', calendar_ids: ['sample-c'], periods:[{label:'授業',start_time:'09:45'}] };
  const date = '2026-11-21T00:45:00Z';
  const overseas = { legacyTimeZone:'America/Los_Angeles' };
  assert.equal(text(date,'sample-a',common,config,overseas), 'S限（09:45）');
  assert.equal(text(iso('10:05'),'sample-a',common,config,overseas), 'A限（10:05）');
  assert.equal(text(iso('11:10'),'sample-a',common,config,overseas), 'A限（11:10）');
  assert.equal(text(iso('10:06'),'sample-a',common,config,overseas), '10:06');
  assert.equal(text(date,'sample-b',common,config,overseas), '第3講');
  assert.equal(text(date,'sample-b-group',common,config,overseas), '第3講');
  assert.equal(text(date,'sample-c',common,config,overseas), '09:45');
  assert.equal(text(date,'sample-a-renamed-id',common,config,{ legacyTimeZone:'Asia/Tokyo'}), '1限');
  assert.equal(text('2026-11-21','sample-a',common,config,overseas), '終日');
  assert.equal(text('', 'sample-a', common, config, overseas), '');
});
test('explicit common display mode and stored revision are read without migration; invalid assignments fail closed', () => {
  const config = defaultPeriodProfiles();
  config.common_mode='both';
  config.revision=7;
  assert.deepEqual(readPeriodProfiles(config), config);
  assert.equal(text(iso('13:10'), 'unassigned', common, config, {legacyTimeZone:'UTC'}), '2限（13:10）');
  config.common_mode='time';
  assert.equal(text(iso('13:10'), 'unassigned', common, config), '13:10');
  config.schools.tomas.calendar_ids=['dup'];
  config.schools.daikanyama.calendar_ids=['dup'];
  assert.deepEqual(readPeriodProfiles(config), defaultPeriodProfiles());
});

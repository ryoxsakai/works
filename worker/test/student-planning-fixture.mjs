import {Miniflare} from 'miniflare';
import {ensureAttribution} from '../src/lesson-attribution.js';
export const target={id:'source',calendar_id:'calendar',title:'個別氏（振替）',start:'2026-10-28T01:00:00Z',end:'2026-10-28T02:00:00Z',etag:'v1',status:'confirmed',timed:true,event_type:'default',transparency:'opaque',declined:false};
export async function setup(t){const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-08-01',d1Databases:{DB:'student-planning'}});t.after(()=>mf.dispose());const DB=await mf.getD1Database('DB');for(const sql of [
'CREATE TABLE curriculum_entries(calendar_event_id TEXT PRIMARY KEY,completed INTEGER DEFAULT 0,lesson_plan TEXT,confirmation_test TEXT,homework TEXT,lesson_memo TEXT,updated_at TEXT)',
"CREATE TABLE goals(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,category TEXT,text TEXT,completed INTEGER DEFAULT 0,sort_order INTEGER DEFAULT 0,created_at TEXT DEFAULT 'seed')",
"CREATE TABLE goal_templates(id INTEGER PRIMARY KEY AUTOINCREMENT,category TEXT,text TEXT,sort_order INTEGER DEFAULT 0,created_at TEXT DEFAULT 'seed')",
"CREATE TABLE candidate_schools(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,school_name TEXT,school_type TEXT,rank INTEGER,created_at TEXT DEFAULT 'seed')",
'CREATE TABLE material_categories(id INTEGER PRIMARY KEY,name TEXT,sort_order INTEGER)',
'CREATE TABLE materials(id INTEGER PRIMARY KEY,name TEXT,category_id INTEGER,sort_order INTEGER)',
"CREATE TABLE student_materials(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,material_id INTEGER,sort_order INTEGER,created_at TEXT DEFAULT 'seed')",
'CREATE TABLE material_chapters(id INTEGER PRIMARY KEY,material_id INTEGER,name TEXT,sort_order INTEGER)',
'CREATE TABLE chapter_progress(name TEXT,chapter_id INTEGER,completed INTEGER,updated_at TEXT,PRIMARY KEY(name,chapter_id))',
"INSERT INTO goals(name,category,text,sort_order) VALUES('個別氏','short','a',0),('個別氏','short','b',1),('Other','short','untouched',0)",
"INSERT INTO goal_templates(category,text) VALUES('mid','Shared template')",
"INSERT INTO candidate_schools(name,school_name,school_type,rank) VALUES('個別氏','School A','national',1),('個別氏','School B','national',2),('Other','Other school','national',1)",
"INSERT INTO material_categories VALUES(1,'Category',0)","INSERT INTO materials VALUES(1,'Book 1',1,0),(2,'Book 2',NULL,1)",
"INSERT INTO student_materials(name,material_id,sort_order) VALUES('個別氏',1,0),('Other',1,0)",
"INSERT INTO material_chapters VALUES(1,1,'Chapter',0)","INSERT INTO chapter_progress VALUES('個別氏',1,1,'old')"
])await DB.prepare(sql).run();const env={DB};await ensureAttribution(env);let current={...target};return {env,DB,deps:{target:async()=>({...current}),excluded:async()=>[]},change:patch=>current={...current,...patch}};}

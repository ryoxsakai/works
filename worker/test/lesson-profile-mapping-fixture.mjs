import {readFileSync} from 'node:fs';
export const mappingSql=readFileSync(new URL('../migrations/20261029_lesson_profile_mapping.sql',import.meta.url),'utf8');
export async function applyMappingSchema(DB){const statements=mappingSql.match(/CREATE TABLE[\s\S]*?;\n|CREATE INDEX[^\n]+;|CREATE TRIGGER[^\n]+END;/g);if(statements.length!==4)throw Error('Unexpected mapping migration shape');for(const sql of statements)await DB.prepare(sql).run();}

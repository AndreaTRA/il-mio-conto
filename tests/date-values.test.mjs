import test from 'node:test';
import assert from 'node:assert/strict';
import {localDateValue,parseDateValue,dateButtonLabel} from '../public/date-values.js';
test('calendar preserves local date and precise time across years',()=>{
 for(const value of ['2026-11-16','2045-02-28','0001-01-01'])assert.equal(localDateValue(parseDateValue(value,'date'),'date'),value);
 assert.equal(localDateValue(parseDateValue('2026-11','month'),'month'),'2026-11');
 assert.equal(localDateValue(parseDateValue('2026-11-16T11:35:47.123','datetime-local'),'datetime-local'),'2026-11-16T11:35:47.123');
 assert.match(dateButtonLabel('2026-11','month'),/novembre 2026/i);
 for(const value of ['2026-02-30','2026-13-01','2026-11-16T25:00','2026-11-16T10:60'])assert.equal(parseDateValue(value,value.includes('T')?'datetime-local':'date'),null);
});

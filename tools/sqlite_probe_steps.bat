@echo off
setlocal

cd /d "%~dp0\.."

echo === STEP 1: node version ===
node -v
echo.

echo === STEP 2: node:sqlite availability ===
node -e "const { DatabaseSync } = require('node:sqlite'); console.log('sqlite-ok', typeof DatabaseSync)"
echo.

echo === STEP 3: open market.db ===
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('data\\market.db'); console.log('opened'); db.close(); console.log('closed');"
echo.

echo === STEP 4: quick_check market.db ===
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('data\\market.db'); const row = db.prepare('PRAGMA quick_check;').get(); console.log(JSON.stringify(row)); db.close();"
echo.

echo === STEP 5: integrity_check(1) market.db ===
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('data\\market.db'); const row = db.prepare('PRAGMA integrity_check(1);').get(); console.log(JSON.stringify(row)); db.close();"
echo.

echo === STEP 6: minimal write test on market.db ===
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('data\\market.db'); db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS __sqlite_probe (probe_id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT NOT NULL); BEGIN IMMEDIATE;'); const r = db.prepare('INSERT INTO __sqlite_probe (note) VALUES (?)').run('probe'); const id = Number(r.lastInsertRowid||0); console.log('inserted', id); db.prepare('DELETE FROM __sqlite_probe WHERE probe_id = ?').run(id); db.exec('COMMIT'); console.log('committed'); db.close();"
echo.

echo === STEP 7: full probe script ===
node tools\sqlite_probe.js --write-market > sql_probe_output.json 2>&1
type sql_probe_output.json
echo.

echo === DONE ===
endlocal

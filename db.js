const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'form_data' );

const db = new sqlite3.Database(dbPath, (err) => {
    if(err) {
        console.error("データベース接続エラー:", err.message)
    } else {
        console.log("SQLiteデータベースに接続しました")
    }
});

db.serialize(() => {
    db.run(`
    CREATE TABLE IF NOT EXISTS form_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        time TIMESTAMP,
        orderedtime TIMESTAMP,
        number NUMERIC NOT NULL,
        checked NUMERIC default 0,
        reservation INTEGER default 0
    )
    `);
});



module.exports = db;


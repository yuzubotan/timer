const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// DBパス（環境変数優先）
const dbPath =
  process.env.DB_PATH ||
  path.join(__dirname, 'data', 'form_data');

// ディレクトリが存在しない場合は作成
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("データベース接続エラー:", err.message);
  } else {
    console.log("SQLiteデータベースに接続しました:", dbPath);
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
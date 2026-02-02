
require('dotenv').config();
console.log(process.env.TZ);
console.log(new Date().toString());
const app = require('./index');
const http = require('http');
const db = require('./db');
const WebSocket = require('ws');

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.locals.wss = wss;

let reduceRemainderMs = 0;

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on ${PORT}`);
});



let timerValue = 60; // 初期値（例）

// タイマーを1秒ごとに減少
setInterval(() => {
    if (timerValue > 0) {
        timerValue--;
        broadcastTimer(); // すべてのクライアントに送信
    }
}, 1000);

wss.on('connection', (ws) => {
  console.log('クライアントが接続しました');

  ws.send(JSON.stringify({ type: 'update', timerValue }));
  ws.on('message', (message) => { 
    
    try {
      const data = JSON.parse(message);
      if (data.action === 'increase') {
        console.log('increase:', data.amount);
      
        timerValue += data.amount;
        broadcastTimer();
      } else if (data.action === 'reset') {
        timerValue = 0;
        broadcastTimer();
      } 
    } catch (e) {
      console.error('メッセージパースエラー', e);
    }
    
});

  ws.on('close', () => {
    console.log('クライアントが切断されました');
});
})

// すべてのクライアントにタイマー値を送信
function broadcastTimer() {
  const message = JSON.stringify({ type: 'update', timerValue });
  wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
          client.send(message);
      }
  });
}


app.get('/', (req,res) => {
    let sql = "select * from form_data where checked = 0 order by time asc"
    db.all(sql, (err, rows) => {
        let opt = {
            title: "new_timer",
            data: rows,
            timerValue
    }
    res.render('index.ejs', opt);
    })
    
})

app.get('/next-id', (req, res) => {
    const sql = "SELECT seq + 1 AS nextId FROM sqlite_sequence WHERE name='form_data'";
    db.get(sql, (err, row) => {
        if (err) {
            console.error('次のIDを取得できませんでした。', err);
            res.status(500).send('Internal Server Error');
        } else {
            const nextId = row ? row.nextId : 1; // データがない場合、次のIDは1
            res.json({ nextId });
        }
    });
});

app.get('/timeline', (req, res) => {
  const sql = "SELECT * FROM form_data WHERE done = 0 ORDER BY time ASC";
  db.all(sql, [], (err, rows) => {
    
      if (err) {
          console.log('Database query error:', err.message);
          return res.status(500).send('Database query error');
      }

      const data = rows.map(row => {
          let reserveTime = null;
          let completionTime = null;
          let startTime = null;

          const prepDurationMs = (row.number / 10) * 60000; // 調理時間

          if (row.reservation === 1) {
              // 予約注文
              reserveTime = new Date(Date.parse(row.time)); // DBに保存された予約時刻
              completionTime = new Date(reserveTime.getTime() - 5 * 60000); // 完了時刻は5分前
              startTime = new Date(completionTime.getTime() - prepDurationMs); // 開始時刻
          } else {
              // 非予約注文
              completionTime = new Date(Date.parse(row.time)); // DBに保存された完了時刻
              startTime = new Date(completionTime.getTime() - prepDurationMs); // 開始時刻
          }


          return {
              id: row.id,
              number: row.number,
              reservation: row.reservation,
              merged_from: row.merged_from,
              reserveTime: reserveTime ? reserveTime.toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'}) : null,
              completionTime: completionTime.toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'}),
              startTime: startTime.toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'}),
              hour: startTime.getHours(),
              minutes: startTime.getMinutes()
          };
      });

      // 開始時刻で並び替え
      data.sort((a, b) => {
          return (a.hour * 60 + a.minutes) - (b.hour * 60 + b.minutes);
      });

      res.render('timeline.ejs', { title: 'timeline', data });
  });
});


    
    
let gapMs = 0;
let previousGapMs = 0;
let gapPeriods = [];
let resStartList = [];
let newGapMs;


function calculateTimes(order, reservations, context) {
  
  const { now, resStartList, gapPeriods } = context;
  const prepDurationMs = (order.number / 10) * 60000;
  
  if (order.reservation === 1) {
    // 予約注文
    const resTime = new Date(new Date(order.time));       // ユーザー指定の予約時刻
    const endTime = new Date(resTime.getTime() - 5 * 60000); // 完成は予約の5分前
    const startTime = new Date(endTime.getTime() - prepDurationMs);
    return { startTime, endTime, saveTime: resTime, gapMs: 0, }; // DBには予約時刻を保存
  } else {
    // 非予約注文
    
    let startTime = new Date(new Date(order.time).getTime() - context.deletedOrderedMs);
    
    let endTime = new Date(startTime.getTime() + prepDurationMs);

  for (const row of reservations) {
    const resTime = new Date(row.time);
    const resEnd = new Date(resTime.getTime() - 5 * 60000);
    const resPrepMs = (row.number / 10) * 60000;
    const resStart = new Date(resEnd.getTime() - resPrepMs);
    const resStartStr = resStart.toISOString();
    if(!resStartList.includes(resStartStr)) {
      resStartList.push(resStartStr);
    }
  const overlap = startTime < resEnd && endTime > resStart;
  
  if (overlap) { 
    
    if (startTime < now) { 
      newGapMs = Math.max(0, resStart - now);
    
    } else { 
      newGapMs = Math.max(0, resStart - startTime);

} 
      gapMs += newGapMs;

        
        gapPeriods.push({
          gap: newGapMs,
          start: new Date(resStart.getTime() - newGapMs),
          endTime: resStart
        });

        startTime = new Date(resEnd); 
        endTime = new Date(startTime.getTime() + prepDurationMs); // gapMs は「待ち時間の追加」として送信 
        
        
    }
    
   
}
return { startTime, endTime, saveTime: endTime, gapMs, newGapMs }; // DBには完了時刻を保存
}
    
  }


let lastEndTime = null;

function updateTimes(order, reservations, context) {
  const {
    baseTime,
    deletedOrderedMs = 0,
    now = new Date(),
    timerValue = 0,
    resStartList = [],
    gapPeriods = [],
    deletedRow = new Date()
  } = context;
  console.log('baseTime:',baseTime)
  console.log('deletedOrderedMs:',deletedOrderedMs)
  console.log('timerValue:', timerValue)
  console.log('resStartList:',resStartList)
  console.log('gapPeriods:',gapPeriods)
  console.log('deletedRow:',deletedRow)
  console.log('---------order.id:', order.id)
  const prepDurationMs = (order.number / 10) * 60000;

  /** -------------------------
   * 予約注文
   * ------------------------- */
  if (order.reservation === 1) {
    const resTime = new Date(order.time);
    const endTime = new Date(resTime.getTime() - 5 * 60000);
    const startTime = new Date(endTime.getTime() - prepDurationMs);

    
    return { startTime, endTime, saveTime: resTime, gapMs: 0 };
  }

  /** -------------------------
   * 非予約注文
   * ------------------------- */

  let startTime;
  

  if (lastEndTime) {
    startTime = new Date(lastEndTime);
  } else {
    startTime = new Date(context.baseTime);
  }

  let endTime = new Date(startTime.getTime() + prepDurationMs);
  console.log('update:startTime', startTime)
  console.log('update:endTime:',endTime)
  /** -------------------------
   * 予約との重複回避（核心）
   * ------------------------- */
  let overlapFound;

  do {
    overlapFound = false;

    for (const row of reservations) {
      const resTime = new Date(row.time);
      const resEnd = new Date(resTime.getTime() - 5 * 60000);
      const resPrepMs = (row.number / 10) * 60000;
      const resStart = new Date(resEnd.getTime() - resPrepMs);

      // ログ用
      const resStartStr = resStart.toISOString();
      if (!resStartList.includes(resStartStr)) {
        resStartList.push(resStartStr);
      }

      const overlap = startTime < resEnd && endTime > resStart;

      if (overlap) {
        // 予約に当たったら予約の直後へ
        if (startTime < now) { 
      newGapMs = Math.max(0, resStart - now);
    
    } else { 
      newGapMs = Math.max(0, resStart - startTime);

} 
      gapMs += newGapMs;

        
        gapPeriods.push({
          gap: newGapMs,
          start: new Date(resStart.getTime() - newGapMs),
          endTime: resStart
        });

        startTime = new Date(resEnd);
        endTime = new Date(startTime.getTime() + prepDurationMs);

        overlapFound = true;
        break; // ← 時間が変わったので最初から再チェック
      }
    }

  } while (overlapFound);

  /** -------------------------
   * 確定
   * ------------------------- */
  
  
    lastEndTime = endTime;
  
  console.log('lastEndTime:', toDatetimeLocalString(lastEndTime))
  console.log('lastEndTime:', lastEndTime)
  return {
    startTime,
    endTime,
    saveTime: endTime,
    gapMs: gapMs,
  };
}

    
  

function calculateGapTime(gapMs, newGapMs, wss) {
  
      console.log('gapMs:',gapMs/1000/60)
      console.log('previousGapMs:', previousGapMs/1000/60)
      if (gapMs > previousGapMs && wss) {
        console.log('gapMs:',gapMs/1000/60)
        const message = JSON.stringify({ type: 'gap', amount: Math.floor(newGapMs / 1000)});
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
              client.send(message);
          }
        
        
      });


      }
      previousGapMs = gapMs;
}

  function getReservationWindow(time, number) {
    const t = (time instanceof Date) ? time : new Date(time);
    const prepMs = number / 10 * 60 * 1000;
    const endAt = new Date(t.getTime() - 5 * 60 * 1000);
    const startAt = new Date(endAt.getTime() - prepMs);
    return { startAt, endAt };
  }

  function isOverlapping(a, b) {
    return a.startAt < b.endAt && b.startAt < a.endAt;
  }

  function mergeReservationChain(newOrder, existingRows) {
  let merged = {
    time: newOrder.time,
    number: 0
  };

  let absorbedIds = [];
  let changed = true;

  while (changed) {
    changed = false;

    const mergedWindow = getReservationWindow(
      merged.time,
      merged.number || newOrder.number
    );

    for (const row of existingRows) {
      if (absorbedIds.includes(row.id)) continue;

      const rowWindow = getReservationWindow(
        row.time,
        row.number
      );

      if (isOverlapping(mergedWindow, rowWindow)) {
        // 吸収
        merged.number += row.number;
        merged.time = new Date(
          Math.min(
            new Date(merged.time).getTime(),
            new Date(row.time).getTime()
          )
        );

        absorbedIds.push(row.id);
        changed = true;
      }
    }
  }

  merged.number += newOrder.number;

  return { merged, absorbedIds };
}

  

  app.post('/submit', (req, res) => {
    
    deletedOrderedMs = 0;
    const { time, number, reservation } = req.body;
    const orderedtime = new Date();

    const order = {
        time: new Date(time),
        number: Number(number),
        reservation: Number(reservation)
      };


  
    if(order.reservation == 0) {
      const sqlSelect = `SELECT time, number FROM form_data WHERE reservation = 1 ORDER BY time ASC`;
      db.all(sqlSelect, [], (err, reservations) => {
        if (err) {
          console.error("予約データ取得エラー:", err.message);
          return res.status(500).send("予約データ取得中にエラーが発生しました。");
        }
      
        const context = {
          deletedOrderedMs: 0,      // 削除再計算ではないため常に 0
          now: new Date(),
          timerValue,
          resStartList: [],
          gapPeriods: gapPeriods,
          gapMs: 0
        };
        const { saveTime, gapMs, newGapMs } = calculateTimes(order, reservations, context);
      console.log('newGap:', newGapMs)
        const wss = req.app.locals.wss;
        calculateGapTime(gapMs, newGapMs, wss);
      
      
        const sqlInsert = `
          INSERT INTO form_data (time, orderedtime, number, reservation)
          VALUES (?, ?, ?, ?)
        `;
      
        const values = [
          saveTime.toISOString(),     // 予約なら予約時刻、非予約なら完了時刻
          orderedtime.toISOString(),
          order.number,
          order.reservation
        ];
        db.run(sqlInsert, values, (err) => {
          if (err) {
            console.error("データ保存エラー:", err.message);
            return res.status(500).send("データ保存中にエラーが発生しました。");
          }
          res.redirect("/");
        });
      });
      return;
    }
  
    db.all(
      `SELECT * FROM form_data WHERE reservation = 1 AND done = 0 AND absorbed = 0 ORDER BY time ASC`,
      [],(err, rows) => {
      if (err) {
        console.error(err);
        return res.sendStatus(500);
      }

    // ★① まず新規予約を INSERT（必ず）
    db.run(
      `INSERT INTO form_data (time, orderedtime, number, reservation)
       VALUES (?, ?, ?, 1)`,
      [
        order.time.toISOString(),
        orderedtime.toISOString(),
        order.number
      ],
      function (err) {
        if (err) {
          console.error(err);
          return res.sendStatus(500);
        }

        const newId = this.lastID;

        // ★② 新規予約を rows に追加
        const newRow = {
          id: newId,
          time: order.time,
          number: order.number,
          merged_from: null
        };

        const rowsWithNew = [...rows, newRow];

        // ★③ マージ判定
        const { merged, absorbedIds } = mergeReservationChain(order, rows);

        // ★ 新規予約IDを吸収対象に追加
        absorbedIds.push(newId);

        if (absorbedIds.length > 0) {

          const keepRow = rows
            .filter(r => absorbedIds.includes(r.id))
            .concat({ id: newId, time: order.time }) // newRowも考慮
            .sort((a, b) => new Date(a.time) - new Date(b.time))[0];

          const keepId = keepRow.id;

          const prevMergedIds = keepRow.merged_from
            ? keepRow.merged_from.split(',').map(Number)
            : [];

          const mergedIds = Array.from(
            new Set([keepId, ...prevMergedIds, ...absorbedIds])
          );

          const mergedFromStr = mergedIds.join(',');

          const absorbedOnlyIds =
            absorbedIds.filter(id => id !== keepId);

          db.serialize(() => {

            db.run(
              `UPDATE form_data SET number = ?, time = ?, merged_from = ?, absorbed = 0 WHERE id = ?`,
              [
                merged.number,
                merged.time.toISOString(),
                mergedFromStr,
                keepId
              ]
            );

            if (absorbedOnlyIds.length > 0) {
              db.run(
                `UPDATE form_data SET absorbed = 1, done = 1 WHERE id IN (${absorbedOnlyIds.map(() => '?').join(',')})`,
                absorbedOnlyIds
              );
            }
          });

          return res.redirect('/');
        }


        // 吸収がなければ INSERT 済みなのでそのまま
        return res.redirect('/');
      }
    );
  }
);
  
  });
  








app.get("/order", (req,res) => {
    db.all("select * from form_data order by time asc", (err, rows) => {
      
      let opt = {
        title: 'order',
        data: rows.map(row => ({
          ...row,
          startTime: new Date(new Date(row.time).getTime() - (row.number / 10 + 5) * 60 * 1000)
        })),
      };
      
      res.render('order.ejs', opt);
    })
  })

  app.get('/order/del', (req, res) => {
    let id = req.query.id;
    let sql = 'delete from form_data where id =' + id;
    db.run(sql, (err) => {
      res.redirect('/');
    })
  })

  function recalcAfterDelete(orders, reservations, context) {
    const results = [];

    for (const order of orders) {
    
                  
    const info = updateTimes(order, reservations, context);

    

    // DBを更新するならここで
    results.push({
      id: order.id,
      startTime: info.startTime,
      endTime: info.endTime,
      saveTime: info.saveTime
    });
    }

    return results;
}


  // 削除処理
app.get('/timeline/del', (req, res) => {
  lastEndTime = null;
  const id = req.query.id;

  // まず削除対象を取得
  const sqlGet = `SELECT * FROM form_data WHERE id = ?`;
  db.get(sqlGet, [id], (err, deletedRow) => {
      if (err) {
          console.error('削除対象取得エラー:', err.message);
          return res.status(500).send('削除対象取得エラー');
      }

      if (!deletedRow) {
          return res.redirect('/timeline');
      }

      // 削除実行
      const sqlDelete = `DELETE FROM form_data WHERE id = ?`;
      db.run(sqlDelete, [id], (err) => {
          if (err) {
              console.error('削除エラー:', err.message);
              return res.status(500).send('削除中にエラーが発生しました');
          }
          

        
          // 削除後に再計算
          const sqlAll = `SELECT * FROM form_data where time >= ? ORDER BY time ASC`;
        
          db.all(sqlAll, [deletedRow.time], (err, rows) => {
              if (err) {
                  console.error('再計算用データ取得エラー:', err.message);
                  return res.status(500).send('再計算用データ取得中にエラーが発生しました');
              }

              rows.map(row => {
                    console.log('rows:',rows)
                    const prepDurationMs = row.number / 10 * 60 * 1000;
                    if(row.reservation == 0) {
                      let startTime = new Date(new Date(row.time).getTime() - prepDurationMs)
                      row.startTime = startTime;
                      
                    } else {
                      let startTime = new Date(new Date(row.time).getTime() - prepDurationMs - 5 * 60 * 1000)
                      row.startTime = startTime;
                    }
                    
                  })
                  rows.sort((a, b) => a.startTime - b.startTime);
                  console.log('map:rows:',rows)

              let targetTime = deletedRow.time;
              console.log('target1:',targetTime)
              console.log(typeof targetTime)
              if(deletedRow.reservation == 1) {
                targetTime = new Date(new Date(deletedRow.time).getTime() - 5 * 60 * 1000).toISOString();
                console.log('target2:',targetTime);
                console.log(typeof targetTime);
              }
              
              db.get("SELECT * FROM form_data WHERE time < ? ORDER BY time DESC LIMIT 1",
                [targetTime],(err, prevRow) => {
                  console.log('prevRow:',prevRow)
                // prevRow が null の場合もある
                  
                  let baseTime;

                  if (prevRow) {
                    console.log('prevRowはある')
                    if (prevRow.reservation === 1) {
                      // 予約は time が「予約時刻」なので endTime を計算
                      const resTime = new Date(prevRow.time);
                      const end = new Date(resTime.getTime() - 5 * 60000);
                      const prepMs = (prevRow.number / 10) * 60000;
                      baseTime = new Date(end.getTime()); // ← 完成時刻
                      console.log('prevRowはあるres1:',baseTime)
                    } else {
                      // 非予約は time = 完了時刻
                      baseTime = new Date(prevRow.time);
                       console.log('prevRowはあるres0:',baseTime)
                    }
                  } else {
                    console.log('prevRowはない')
                    baseTime = new Date(); // 先頭を消した場合
                  }
                  console.log('baseTime結果:', baseTime)
                  const reservations = rows.filter(o => o.reservation === 1);
           
                  const context = {
                    baseTime,
                    now: new Date(),
                    timerValue,
                    deletedOrderedMs: deletedRow.number / 10 * 60 * 1000,
                    resStartList: resStartList,
                    deletedRow: deletedRow,
                    gapPeriods: gapPeriods,
                    gapMs: gapMs,
                    newGapMs: newGapMs
                  };
                  console.log('timeline/del:context:',context)
                  const wss = req.app.locals.wss;

                  const totalReduceMs =
                    (context.deletedOrderedMs || 0) +
                    (context.gapMs || 0);

                  if (totalReduceMs > 0) {
                    const message = JSON.stringify({
                      type: 'modify',
                      amount: Math.floor(-totalReduceMs / 1000)
                    });

                    wss.clients.forEach(client => {
                      if (client.readyState === WebSocket.OPEN) {
                        client.send(message);
                      }
                    });

                    console.log('timerValue total reduce:', -totalReduceMs / 1000);
                    gapMs = 0;
                  }

                  
                  
                  console.log('context.deletedOrderedMs:', context.deletedOrderedMs)
            // 5. まとめて再計算！
                  const results = recalcAfterDelete(rows, reservations, context);
                  console.log('results:', results)
            // 6. DBに保存
                  for (const item of results) {
                    if (!(item.saveTime instanceof Date)) {
                      console.error('invalid saveTime:', item);
                      continue;
                    }
                    db.run("UPDATE form_data SET time = ? WHERE id = ?", [
                      item.saveTime.toISOString(),
                      item.id
                    ]);
                  }

              
              
             

                  res.redirect('/timeline');
  
              }
);

              
              
          });
      });
  });
});




// ISOをdatetime-local形式に変換
function toDatetimeLocalString(utcString) {
  const date = new Date(utcString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

  app.get("/timeline/modify", (req, res) => {
    lastEndTime = null;
    let id = req.query.id;
    console.log('id:',id)
    let sql = "select * from form_data where id = ?";
    db.get(sql, [id], (err, finishedOrder) => {
      if(err) {
        console.error('修正データの取得に失敗しました', err)
      }
        
      console.log('finishedOrder:',finishedOrder)

      const finishedTimeRaw = new Date(finishedOrder.time);
      const finishedEndTime =
        finishedOrder.reservation == 1
          ? new Date(finishedTimeRaw.getTime() - 5 * 60 * 1000)
          : finishedTimeRaw;
      console.log('finishedEndTime:',finishedEndTime)

      db.run(
        "UPDATE form_data SET done = 1 WHERE id = ?",
        [id],
        err => {
          if (err) {
            console.error('done更新失敗', err);
            return res.sendStatus(500);
          }

          console.log('finishedOrder:',finishedOrder)


        
          console.log('finishedOrder.Time:',finishedOrder.time)
      db.all("select * from form_data where time >= ? and done = 0 order by time asc",
        [finishedEndTime.toISOString()],
        (err, subsequentOrders) => {
          if (err) {
            console.error('注文取得エラー:', err.message);
            return res.status(500).send('後続注文取得に失敗しました。');
        }

            subsequentOrders.map(row => {
                    const prepDurationMs = row.number / 10 * 60 * 1000;
                    if(row.reservation == 0) {
                      let startTime = new Date(new Date(row.time).getTime() - prepDurationMs)
                      row.startTime = startTime.getTime();
                      
                    } else {
                      let startTime = new Date(new Date(row.time).getTime() - prepDurationMs - 5 * 60 * 1000)
                      row.startTime = startTime.getTime();
                    }
                    
                  })
            subsequentOrders.sort((a, b) => a.startTime - b.startTime);
              

              const now = new Date();

              
              
              db.get("SELECT * FROM form_data WHERE time < ? and done = 0 ORDER BY time DESC LIMIT 1",
                [finishedEndTime.toISOString()],(err, prevRow) => {
                  console.log('prevRow:',prevRow)
                // prevRow が null の場合もある

                
                  
                  let baseTime;
                  let deletedOrderedMs;

                  const wss = req.app.locals.wss;
                  calculateGapTime(gapMs, newGapMs, wss);

                  if (prevRow) {
                    console.log('prevRowはある')
                    if (prevRow.reservation === 1) {
                      // 予約は time が「予約時刻」なので endTime を計算
                      const resTime = new Date(prevRow.time);
                      const end = new Date(resTime.getTime() - 5 * 60000);
                      const prepMs = (prevRow.number / 10) * 60000;
                      baseTime = new Date(end.getTime()); // ← 完成時刻
                      deletedOrderedMs = finishedOrder.number / 10 * 60 * 1000;
                      
                      console.log('prevRowはあるres1:',baseTime)
                      console.log('prevrow&&res1:', deletedOrderedMs)
                    } else {
                      // 非予約は time = 完了時刻
                      baseTime = new Date(prevRow.time);
                      deletedOrderedMs = finishedOrder.number / 10 * 60 * 1000;
                       
                      console.log('prevRowはあるres0:',baseTime)
                      console.log('prevrow&&res0:', deletedOrderedMs)
                    }
                  } else {
                    console.log('prevRowはない')
                    deletedOrderedMs = new Date(finishedEndTime).getTime() - new Date().getTime();
                    baseTime = new Date(); // 先頭を消した場合
                    gapMs = 0;
                    console.log('prevrowなし:', deletedOrderedMs)
                    console.log('prevrowはない内gapMs:',gapMs)
                  }
                  console.log('baseTime結果:', baseTime)
                  
            const reservations = subsequentOrders.filter(o => o.reservation === 1);

            const context = {
                    baseTime,
                    now: new Date(),
                    timerValue,
                    deletedOrderedMs: deletedOrderedMs ,
                    resStartList: resStartList,
                    deletedRow: finishedOrder,
                    gapPeriods: gapPeriods,
                    gapMs: gapMs,
                    newGapMs: newGapMs
                  };

    
            
             
    


                    
                  
                  
                  console.log('subsequentOrders:',subsequentOrders);
                  
              
        // 5. まとめて再計算！
              const results = recalcAfterDelete(subsequentOrders, reservations, context);
              
             


        // 6. DBに保存
              for (const item of results) {
                db.run("UPDATE form_data SET time = ? WHERE id = ?", [
                  item.saveTime.toISOString(),
                  item.id
                ]);
              }

               db.get("SELECT * FROM form_data where checked = 1 and done = 0 order by time desc limit 1",
                  (err, lastOrder) => {
                    if(err) {
                      console.error(err);
                      return;
                    }

                    if (!lastOrder) {
                      console.log('未完了注文が存在しない');

                      timerValue = 0;
                    } else {
                    console.log('lastOrder', lastOrder)
                    const lastFinishedTimeRaw = new Date(lastOrder.time);
                    const lastFinishedEndTime =
                      lastOrder.reservation == 1
                        ? new Date(lastFinishedTimeRaw.getTime() - 5 * 60 * 1000)
                        : lastFinishedTimeRaw;
                      console.log('lastFinishedEndTime:',toDatetimeLocalString(lastFinishedEndTime))
                    const trueTimerValue = lastFinishedEndTime.getTime() - new Date().getTime();
                    console.log('trueTimerValue:', trueTimerValue / 1000 / 60);
                    if(!prevRow) {
                      const before = timerValue;
                      const after = Math.max(0, Math.floor(trueTimerValue / 1000));
                      const diff = after - before;

                      if (diff !== 0) {
                        const message = JSON.stringify({
                          type: 'modify',
                          amount: diff
                        });
                        console.log('diff:', diff)
                        wss.clients.forEach(client => {
                          if (client.readyState === WebSocket.OPEN) {
                            client.send(message);
                          }
                        });

                        timerValue = after; // サーバー側の値も同期

                      
                      console.log('timerValue:',timerValue)
                      console.log('id:',id)
                      console.log('lastOrder.id:',lastOrder.id);
                      if(id == lastOrder.id) {
                        console.log(123)
                      timerValue = 0;
                    }
                    }
                  }
                    }
                  })  
            })
        console.log('-------------------------------------------')
          res.json({ success: true });

          })
        }
      )
    })
    })


     

  // サーバーサイドのエンドポイント
  app.post("/reset", (req, res) => {
    previousGapMs = 0;
    gapPeriods = [];
    resStartList = [];
    newGapMs = 0;
    gapMs = 0;
    let sql = "DELETE FROM form_data";
    db.run(sql, (err) => {
      if (err) {
        console.error('データベースのリセットに失敗しました。', err);
        res.status(500).send('Internal Server Error');
      } else {
        // IDシーケンスをリセット
        db.run("DELETE FROM sqlite_sequence WHERE name='form_data'", (seqErr) => {
            if (seqErr) {
                console.error('IDシーケンスのリセットに失敗しました。', seqErr);
                res.status(500).send('Internal Server Error');
            } else {
              
        console.log('データベースをリセットしました。');
        res.status(200).send('OK');
      }})}
        
      
    });
  });
  
  app.get('/checked', (req, res) => {
    let id = req.query.id;
    let sql = "update form_data set checked = 1 where id =" + id;
    db.run(sql, (err) => {
      
      res.redirect('/');
    })
  })

  app.get('/customer', (req, res) => {
    res.render('customer');
  })



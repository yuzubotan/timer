
const app = require('./index');
const port = 3001;
const http = require('http');
const db = require('./db');
const WebSocket = require('ws');

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.locals.wss = wss;

server.listen(port, () => {
    console.log(`Server is running on ${port} `);
})

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
    console.log("🧾 受信メッセージ:", message);
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
  const sql = "SELECT * FROM form_data ORDER BY time ASC";
  db.all(sql, [], (err, rows) => {
    console.log(
      rows.map(r => ({ id: r.id, done: r.done })))
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
let newGap;
let resStartList = [];
let newGapMs;
let deletedOrderedMs = 0;

function calculateTimes(order, reservations, context) {
  console.log(context)
  const { deletedOrderedMs, now, timerValue, resStartList, gapPeriods } = context;
  const prepDurationMs = (order.number / 10) * 60000;
  
  console.log('newGap:', newGap);
  if (order.reservation === 1) {
    // 予約注文
    const resTime = new Date(new Date(order.time));       // ユーザー指定の予約時刻
    const endTime = new Date(resTime.getTime() - 5 * 60000); // 完成は予約の5分前
    const startTime = new Date(endTime.getTime() - prepDurationMs);
    return { startTime, endTime, saveTime: resTime, gapMs: 0, }; // DBには予約時刻を保存
  } else {
    // 非予約注文
    
    let startTime = new Date(new Date(order.time).getTime() - context.deletedOrderedMs);
    console.log('first:', startTime)
    console.log(deletedOrderedMs)
    
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
  console.log(resStartList);
  const overlap = startTime < resEnd && endTime > resStart;
  
  if (overlap) { 
    
    if (startTime < now) { 
      newGapMs = Math.max(0, resStart - now);
      console.log('gapMs:', gapMs)
      console.log('ovelap:', gapMs) // 実際の残り時間 
    
    } else { 
      newGapMs = Math.max(0, resStart - startTime);

      console.log('ovelap2:', gapMs) // 予定上の gap }
} 
      gapMs += newGapMs;
      console.log('GapMs:', gapMs);
        
        gapPeriods.push({
          gap: newGapMs,
          start: new Date(resStart.getTime() - newGapMs),
          endTime: resStart
        });

        startTime = new Date(resEnd); 
        endTime = new Date(startTime.getTime() + prepDurationMs); // gapMs は「待ち時間の追加」として送信 
        console.log('gapp:', gapMs);
        
        console.log('pregap:', previousGapMs);
        
        console.log(gapPeriods);
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
    gapMs: 0,
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


  app.post('/submit', (req, res) => {
    deletedOrderedMs = 0;
    const { time, number, reservation } = req.body;
    const orderedtime = new Date();
    console.log('previousGapMs:', previousGapMs/1000/60)
  
    const sqlSelect = `SELECT time, number FROM form_data WHERE reservation = 1 ORDER BY time ASC`;
  
    db.all(sqlSelect, [], (err, reservations) => {
      if (err) {
        console.error("予約データ取得エラー:", err.message);
        return res.status(500).send("予約データ取得中にエラーが発生しました。");
      }
  
      const order = {
        time,
        number: Number(number),
        reservation: Number(reservation)
      };

      const context = {
        deletedOrderedMs: 0,      // 削除再計算ではないため常に 0
        now: new Date(),
        timerValue,
        resStartList: [],
        gapPeriods: gapPeriods,
        gapMs: 0
      };
  
      const { saveTime, gapMs, newGapMs } = calculateTimes(order, reservations, context);
      
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
                      amount: -totalReduceMs / 1000
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


// 後続注文を調整する関数（予約優先＋通常注文は調理時間分ずらす）
function adjustOrders(subsequentOrders, canceledOrder, callback) {
    let reservedTimes = []; // 予約注文のcompletion_timeを記録

    // 1. 予約注文のcompletion_timeだけ記録
    subsequentOrders.forEach(order => {
        if (order.reservation == 1) {
            reservedTimes.push(new Date(order.time));
            
        }
        
    });

    let index = 0;
    let lastAvailableTime = new Date(canceledOrder.time);

    
    function processNext(err) {

        if (err || index >= subsequentOrders.length) {
            callback(err);
            return;
        }

        let order = subsequentOrders[index++];

        if (order.reservation == 1) {
            processNext();
        } else {
            const cookMinutes = Math.ceil(order.number * 6 / 60); // 1本6秒換算
           
            let proposedStartTime = new Date(lastAvailableTime);

            let proposedEndTime = new Date(proposedStartTime.getTime() + cookMinutes * 60 * 1000);
                                  

            let overlap;
            do {
                overlap = reservedTimes.some(reservedDate => {
                    let reservedStart = new Date(reservedDate.getTime() - cookMinutes * 60 * 1000);
        
                    return (proposedEndTime > reservedStart && proposedStartTime < reservedDate);
                });
              
                if (overlap) {
                    // 重なってたら、調理時間分後ろにずらす
                    let nearestReserved = reservedTimes.find(reservedDate => {
                      let reservedStart = new Date(reservedDate.getTime() - cookMinutes * 60 * 1000);
                      return (proposedEndTime > reservedStart && proposedStartTime < reservedDate);
                    })
                    proposedStartTime = new Date(nearestReserved.getTime());
                    proposedEndTime = new Date(proposedStartTime.getTime() + cookMinutes * 60 * 1000);    
                }
            } while (overlap);


            let formattedTime = toDatetimeLocalString(lastAvailableTime);
            const updateSql = `UPDATE form_data SET time = ? WHERE id = ?`;
            db.run(updateSql, [formattedTime, order.id], (err) => {
                if (err) return callback(err);

                  console.log(`注文ID:${order.id} 更新 → ${formattedTime}`);
                    
                  lastAvailableTime = proposedEndTime
                  processNext();
                });
        }
    }

    processNext();

}

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
    console.log('modify called, id=', req.query.id);
    lastEndTime = null;
    let id = req.query.id;
    let sql = "select * from form_data where id = ?";
    db.get(sql, [id], (err, finishedOrder) => {
      if(err) {
        console.error('修正データの取得に失敗しました', err)
      }
        console.log(finishedOrder.time.toLocaleString())

      db.run(
        "UPDATE form_data SET done = 1 WHERE id = ?",
        [id],
        err => {
          if (err) {
            console.error('done更新失敗', err);
            return res.sendStatus(500);
          }

      db.all("select * from form_data where time > ? order by time asc",
        [finishedOrder.time],
        (err, subsequentOrders) => {
          if (err) {
            console.error('注文取得エラー:', err.message);
            return res.status(500).send('後続注文取得に失敗しました。');
        }
        console.log(subsequentOrders)

            subsequentOrders.map(row => {
                    const prepDurationMs = row.number / 10 * 60 * 1000;
                    if(row.reservation == 0) {
                      let startTime = new Date(new Date(row.time).getTime() - prepDurationMs)
                      row.startTime = startTime;
                      
                    } else {
                      let startTime = new Date(new Date(row.time).getTime() - prepDurationMs - 5 * 60 * 1000)
                      row.startTime = startTime;
                    }
                    
                  })
            subsequentOrders.sort((a, b) => a.startTime - b.startTime);
            let targetTime = finishedOrder.time;
              console.log('target1:',targetTime)
              if(finishedOrder.reservation == 1) {
                targetTime = new Date(new Date(finishedOrder.time).getTime() - 5 * 60 * 1000).toISOString();
                console.log('target2:',targetTime);
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
                  
            const reservations = subsequentOrders.filter(o => o.reservation === 1);

            const context = {
                    baseTime,
                    now: new Date(),
                    timerValue,
                    deletedOrderedMs: finishedOrder.number / 10 * 60 * 1000,
                    resStartList: resStartList,
                    deletedRow: finishedOrder,
                    gapPeriods: gapPeriods,
                    gapMs: gapMs,
                    newGapMs: newGapMs
                  };

            console.log('modifydeletedOrderedMs:',deletedOrderedMs)
            const wss = req.app.locals.wss;
            const totalReduceMs =
                    (context.deletedOrderedMs || 0) +
                    (context.gapMs || 0);

                  if (totalReduceMs > 0) {
                    const message = JSON.stringify({
                      type: 'modify',
                      amount: -totalReduceMs / 1000
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
              const results = recalcAfterDelete(subsequentOrders, reservations, context);

        // 6. DBに保存
              for (const item of results) {
                db.run("UPDATE form_data SET time = ? WHERE id = ?", [
                  item.saveTime.toISOString(),
                  item.id
                ]);
              }
  
            })
        
          res.json({ success: true });

          })
        }
      )
    })
    })
  
let difference = 0;
function modifyOrders(subsequentOrders, finishedOrder, wss, callback) {
  let now = new Date();
  difference = now - new Date(finishedOrder.time);
  if(difference !== 0 && wss) {
    console.log('wss:', difference)
        const message = JSON.stringify({ type:'modify', amount: Math.floor(difference / 1000) });
        

        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            console.log("WS send:", message);
            
              client.send(message);
          }
        });
      };

  if(finishedOrder.reservation == 1) {
    difference = now - new Date(new Date(finishedOrder.time).getTime() - 5 * 60 * 1000);
  } 

  
  let reservedTimes = [];
  subsequentOrders.forEach(order => {
    
    if(order.reservation === 1) {
      reservedTimes.push(order.time);
    }
  })

   

    
    let diff = Math.floor(difference / 60000);
    
    console.log(difference)
    console.log(diff);
    console.log(`now: ${now}`);
  

    let index = 0;
    let modifiedTime = new Date();
    let proposedStartTime;
    let proposedEndTime;
    let overlapTimes = 0;
    function processNext(err) {
    
      if (err || index >= subsequentOrders.length) {
        callback(err);
        return;
      }
      let order = subsequentOrders[index];
      let unreservedTimes =[];
      if(order.reservation === 1) {
        
        index++;
        processNext();
      } else if(order.reservation === 0) {
        console.log(1)
        const cookMs = Math.ceil(order.number / 10 * 60 * 1000); // 1本6秒換算
          if(index == 0) {
            modifiedTime = new Date(new Date(order.time).getTime() - cookMs + difference);
            console.log(`modifiedTime: ${modifiedTime}`);
              console.log(2)
            } else {
              console.log('modifiedTime(before):',modifiedTime)
            modifiedTime = new Date(modifiedTime.getTime());
              console.log('modifiedTime(after):',modifiedTime)
                console.log(3)
            }
            index++;
      
           
            proposedStartTime = new Date(modifiedTime);
            proposedEndTime = new Date(proposedStartTime.getTime() + cookMs);
                                   

            let overlap;
            let overlapCount = 0;
            do {
                overlap = reservedTimes.some(resTime => {
                    let resDate = new Date(resTime);
                    let resEnd = new Date(resDate.getTime() - 5 * 60 * 1000);
                    let resStart = new Date(resEnd.getTime() - cookMs);
                    console.log('reservedTimes', reservedTimes)
                    console.log('reservedDate',toDatetimeLocalString(resDate))
                    console.log('reservedEnd',toDatetimeLocalString(resEnd))
                    console.log('reservedStart', toDatetimeLocalString(resStart));
                    console.log('proposedStartTime',toDatetimeLocalString(proposedStartTime));
                    console.log('proposedEndTime', toDatetimeLocalString(proposedEndTime));
                    return (proposedEndTime > resStart && proposedStartTime < resEnd);
                });
                console.log('overlap',overlap)
                if (overlap) {
                    if (proposedStartTime < now) { 
                      newGapMs = Math.max(0, resStart - now);
                      console.log('modifynewgapMs:', newGapMs)
                      console.log('ovelap:', gapMs) // 実際の残り時間 
    
              } else { 
                      newGapMs = Math.max(0, resStart - proposedStartTime);

                      console.log('ovelap2:', gapMs) // 予定上の gap }
                    } 
                    // 重なってたら、調理時間分後ろにずらす
                    proposedStartTime = new Date(proposedStartTime.getTime() + 1 * 60 * 1000);
                    proposedEndTime = new Date(proposedStartTime.getTime() + cookMs);    
                    console.log('proposedStartTime:',proposedStartTime)
                    
                }
                    
                  
            } while (overlap);
                    console.log('proposedStartTime(overlap1):', proposedStartTime);
                    console.log(unreservedTimes);
                    console.log('overlapCount:', overlapCount)
            let overlap2;
            do {
                overlap2 = unreservedTimes.some(Time => {
                    let unreservedEnd = new Date(Time);
                    let unreservedStart = new Date(unreservedEnd.getTime() - cookMs);
                    
                    return (proposedEndTime > unreservedStart && proposedStartTime < unreservedEnd);
                });
                console.log('overlap',overlap)
                if (overlap2) {
                    // 重なってたら、調理時間分後ろにずらす
                    proposedStartTime = new Date(proposedStartTime.getTime() + 1 * 60 * 1000);
                    proposedEndTime = new Date(proposedStartTime.getTime() + cookMs);    
                    
                }
                    unreservedTimes.push({start:proposedStartTime,end:proposedEndTime})
            } while (overlap2);
              console.log('proposedStartTime(overlap2):', proposedStartTime);
              
              
                    modifiedTime = proposedEndTime;
      let formattedTime = toDatetimeLocalString(modifiedTime);
      const updateSql = `UPDATE form_data SET time = ? WHERE id = ?`;
            db.run(updateSql, [formattedTime, order.id], (err) => {
                if (err) {
                    console.error('更新エラー:', err.message);
                    callback(err);
                } else {
                  console.log(`注文ID:${order.id} 更新 → ${formattedTime}`);
                    console.log('ok')
                  console.log('modifiedTime(end):',modifiedTime)
                   processNext();
                }
                
            });
          }
    }
    processNext();
    
  

}

     

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
    console.log('come on')
    db.run(sql, (err) => {
      
      res.redirect('/');
    })
  })





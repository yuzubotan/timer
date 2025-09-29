
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
      } else if (data.action === 'gap') {
        timerValue += data.amount;
        console.log('gappp:', data.amount);
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


    
    


function calculateTimes(order, reservations) {
  const prepDurationMs = (order.number / 10) * 60000;
  let gapMs = 0;
  if (order.reservation === 1) {
    // 予約注文
    const resTime = new Date(order.time);       // ユーザー指定の予約時刻
    const endTime = new Date(resTime.getTime() - 5 * 60000); // 完成は予約の5分前
    const startTime = new Date(endTime.getTime() - prepDurationMs);
    return { startTime, endTime, saveTime: resTime }; // DBには予約時刻を保存
  } else {
    // 非予約注文
    let startTime = new Date(order.time);
    let endTime = new Date(startTime.getTime() + prepDurationMs);

    for (const row of reservations) {
      const resTime = new Date(row.time);          // DBに保存された予約時刻
      const resEnd = new Date(resTime.getTime() - 5 * 60000); // 実際の完成時刻
      const resPrepMs = (row.number / 10) * 60000;
      const resStart = new Date(resEnd.getTime() - resPrepMs);

      const overlap = startTime < resEnd && endTime > resStart;
      if (overlap) {
        gapMs = resStart - startTime;
        
        if (prepDurationMs <= gapMs) {
          // gap に収まる → gap 内に補正して保存
          endTime = new Date(startTime.getTime() - gapMs + prepDurationMs);
          gapMs = 0; // timerValue は増やさない
        } else {
          // gap に収まらない → gap 分ずらして保存
          startTime = new Date(resEnd);
          endTime = new Date(startTime.getTime() + prepDurationMs);
          // gapMs は「待ち時間の追加」として送信
        }
        
      }
    }
    return { startTime, endTime, saveTime: endTime, gapMs }; // DBには完了時刻を保存
  }
}




  app.post('/submit', (req, res) => {
    const { time, number, reservation } = req.body;
    const orderedtime = new Date();
    
  
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
  
      const { saveTime, gapMs } = calculateTimes(order, reservations);

      const wss = req.app.locals.wss;
      
      if (gapMs > 0 && wss) {
        console.log("gapMs:",gapMs)
        const message = JSON.stringify({ type: 'gap', amount: Math.floor(gapMs / 1000)});
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
              client.send(message);
          }
      });


      }
      
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

  // 削除処理
app.get('/timeline/del', (req, res) => {
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
          const sqlAll = `SELECT * FROM form_data ORDER BY time ASC`;
          db.all(sqlAll, [], (err, rows) => {
              if (err) {
                  console.error('再計算用データ取得エラー:', err.message);
                  return res.status(500).send('再計算用データ取得中にエラーが発生しました');
              }

              // 予約だけ抽出
              const reservations = rows.filter(r => r.reservation === 1).map(r => {
                  const reserveTime = new Date(r.time); // 予約時刻
                  const cookMs = (r.number / 10) * 60000;
                  const readyTime = new Date(reserveTime.getTime() - 5 * 60000);
                  const startTime = new Date(readyTime.getTime() - cookMs);
                  return { id: r.id, startTime, readyTime, reserveTime, cookMs };
              });

              // 非予約を削除対象の orderedtime より後ろだけ調整
              const deletedOrdered = new Date(deletedRow.orderedtime);
              let updatedRows = [];

              let timeline = []; // 調整後タイムライン

              for (const row of rows) {
                  const cookMs = (row.number / 10) * 60000;

                  if (row.reservation === 1) {
                      // 予約はそのまま
                      timeline.push({
                          ...row,
                          completion: new Date(new Date(row.time).getTime() - 5 * 60000)
                      });
                      continue;
                  }

                  // 非予約
                  const ordered = new Date(row.orderedtime);
                  let completion = new Date(row.time); // 保存されている完了時刻
                  let start = new Date(completion.getTime() - cookMs);

                  // 削除対象より後だけ再調整
                  if (ordered > deletedOrdered) {
                      for (const resv of reservations) {
                          const overlap = start < resv.readyTime && completion > resv.startTime;
                          if (overlap) {
                              // 予約の直後に開始
                              start = new Date(resv.readyTime);
                              completion = new Date(start.getTime() + cookMs);
                          }
                      }
                  }

                  timeline.push({ ...row, completion, start });
                  updatedRows.push({ id: row.id, completion });
              }

              // DBを更新
              const sqlUpdate = `UPDATE form_data SET time = ? WHERE id = ?`;
              updatedRows.forEach(u => {
                  db.run(sqlUpdate, [u.completion.toISOString(), u.id], (err) => {
                      if (err) {
                          console.error('再計算更新エラー:', err.message);
                      }
                  });
              });

              res.redirect('/timeline');
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
    let id = req.query.id;
    let sql = "select * from form_data where id = ?";
    db.get(sql, [id], (err, finishedOrder) => {
      if(err) {
        console.error('修正データの取得に失敗しました', err)
      }
        console.log(finishedOrder.time.toLocaleString())
      db.all("select * from form_data where time > ? order by time asc",
        [finishedOrder.time],
        (err, subsequentOrders) => {
          if (err) {
            console.error('注文取得エラー:', err.message);
            return res.status(500).send('後続注文取得に失敗しました。');
        }
        console.log(subsequentOrders)

        modifyOrders(subsequentOrders, finishedOrder, () => {
          res.redirect('/timeline');
        });
                      
          
        
        }
      )
      

    })
  })

function modifyOrders(subsequentOrders, finishedOrder, callback) {
  let now = new Date();
  let difference = now - new Date(finishedOrder.time);
  let reservedTimes = [];
  subsequentOrders.forEach(order => {
    if(order.reservation === 1) {
      reservedTimes.push(order.time);
    }
  })

    function toDatetimeLocalString(utcString) {
      const date = new Date(utcString); // UTCからDateを生成（内部的にローカル時刻に変換される）
    
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
    
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    
    let diff = Math.floor(difference / 60000);
    
    console.log(difference)
    console.log(diff);
    console.log(`now: ${now}`);
  

    let index = 0;
    let modifiedTime = new Date();

    function processNext(err) {
      if (err || index >= subsequentOrders.length) {
        callback(err);
        return;
      }
      let order = subsequentOrders[index++];

      if(order.reservation === 1) {
        modifiedTime = new Date(order.time);
        processNext();
      } else if(order.reservation === 0) {
        modifiedTime = new Date(new Date(order.time).getTime() + difference);
        console.log(`modifiedTime: ${modifiedTime}`);
      

      const cookMinutes = Math.ceil(order.number * 6 / 60); // 1本6秒換算
           
            let proposedStartTime = new Date(finishedOrder.time);

            let proposedEndTime = new Date(proposedStartTime.getTime() + order.number / 10 * 60 * 1000);
                                   

            let overlap;
            do {
                overlap = reservedTimes.some(resTime => {
                    let reservedDate = new Date(resTime);
                    let reservedStart = new Date(reservedDate.getTime() - cookMinutes * 60 * 1000);
                    console.log('reservedTimes', reservedTimes)
                    console.log('reservedDate',toDatetimeLocalString(reservedDate))
                    console.log('reservedStart', toDatetimeLocalString(reservedStart));
                    console.log('proposedStartTime',toDatetimeLocalString(proposedStartTime));
                    console.log('proposedEndTime', toDatetimeLocalString(proposedEndTime));
                    return (proposedEndTime > reservedStart && proposedStartTime < reservedDate);
                });
                console.log('overlap',overlap)
                if (overlap) {
                    // 重なってたら、調理時間分後ろにずらす
                    proposedStartTime = new Date(proposedStartTime.getTime() + cookMinutes * 60 * 1000);
                    proposedEndTime = new Date(proposedStartTime.getTime() + cookMinutes * 60 * 1000);    
                }
            } while (overlap);

      let formattedTime = toDatetimeLocalString(modifiedTime);
      const updateSql = `UPDATE form_data SET time = ? WHERE id = ?`;
            db.run(updateSql, [formattedTime, order.id], (err) => {
                if (err) {
                    console.error('更新エラー:', err.message);
                    callback(err);
                } else {
                  console.log(`注文ID:${order.id} 更新 → ${formattedTime}`);
                    console.log('ok')
                   processNext();
                }
                
            });
          }
    }
    processNext();
  

  

}

     

  // サーバーサイドのエンドポイント
  app.post("/reset", (req, res) => {
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





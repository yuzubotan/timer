
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
    const sql = "select * from form_data order by orderedtime asc";
    db.all(sql, [], (err, rows) => {
        if(err) {
            console.log('Database query error:', err.message);
            return res.status(500).send('Database query error');
        }
        
        const data = rows.map(row => {
            
            const date = new Date(Date.parse(row.time)); // まず正しいDateを得る

            const formattedTime = date.toLocaleString('jp-JP', {
              hour: '2-digit',
              minute: '2-digit'
             });
             
            return {
              id: row.id,
              datetime: formattedTime,
              number: row.number,
              hour: date.getHours(),
              minutes: date.getMinutes(),
              reservation: row.reservation
            };
          });
          
      res.render('timeline.ejs', { title: 'timeline', data });
    })
    
    
})

function calculateTimes(order, reservations) {
  const prepDurationMs = (order.number / 10) * 60000;

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
        // 非予約を予約完成直後にずらす
        startTime = new Date(resEnd);
        endTime = new Date(startTime.getTime() + prepDurationMs);
      }
    }
    return { startTime, endTime, saveTime: endTime }; // DBには完了時刻を保存
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

    const { saveTime } = calculateTimes(order, reservations);

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

  app.get('/timeline/del', (req, res) => {
    const id = req.query.id;
    
    if (!id) {
        return res.status(400).send('IDが指定されていません。');
    }

    // 1. 削除対象の注文を取得
    db.get('SELECT * FROM form_data WHERE id = ?', [id], (err, canceledOrder) => {
        if (err) {
            console.error('注文取得エラー:', err.message);
            return res.status(500).send('注文取得に失敗しました。');
        }

        if (!canceledOrder) {
            return res.status(404).send('注文が存在しません。');
        }


        // 2. 削除処理
        db.run('DELETE FROM form_data WHERE id = ?', [id], (err) => {
            if (err) {
                console.error('削除エラー:', err.message);
                return res.status(500).send('削除に失敗しました。');
            } else {
              const wss = req.app.locals.wss;
              if(wss) {
                const message = JSON.stringify({ type: 'del', amount: -canceledOrder.number / 10 * 60 });
                wss.clients.forEach((client) => {
                  if(client.readyState === WebSocket.OPEN) {
                    client.send(message);
                  }
                })
              }
            }

            // 3. キャンセルされたcompletion_time以降の注文を取得
            db.all(
                'SELECT * FROM form_data WHERE time >= ? ORDER BY time ASC',
                [canceledOrder.time],
                (err, subsequentOrders) => {
                    if (err) {
                        console.error('注文取得エラー:', err.message);
                        return res.status(500).send('後続注文取得に失敗しました。');
                    }
                    console.log('canceledOrder;', canceledOrder);
                    console.log('subsequentOrders:', subsequentOrders);
                    // 4. 後続注文の調整
                    adjustOrders(subsequentOrders, canceledOrder, () => {
                      
                        res.redirect('/timeline');
                    });
                }
            );
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





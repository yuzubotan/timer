const app = require('./index');
const port = 3001;
const http = require('http');
const db = require('./db');
const WebSocket = require('ws');

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

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
    try {
      const data = JSON.parse(message);
      if (data.action === 'increase') {
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
    let sql = "select * from form_data where checked = 0 order by orderedtime asc limit 1"
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
            const date = new Date(new Date(row.time).getTime() + row.number / 10 * 60 * 1000);

            const formattedTime = date.toLocaleTimeString('ja-JP', {
                hour: '2-digit',
                minute: '2-digit',
            })

            const orderedDate = new Date(row.time);

            const formattedTime2 = orderedDate.toLocaleString('jp-JP', {
              hour: '2-digit',
              minute: '2-digit'
             });

            return {
              id: row.id,
              datetime: formattedTime,
              datetime2: formattedTime2,
              number: row.number,
              hour: date.getHours(),
              minutes: date.getMinutes(),
              reservation: row.reservation
            };
          });

      res.render('timeline.ejs', { title: 'timeline', data });
    })
    
    
})

app.post('/submit', (req, res) => {
    const { time, number, reservation} = req.body;
    const orderedtime = new Date();
    const sql = `INSERT INTO form_data (time, orderedtime, number, reservation) VALUES (?, ?, ?, ?)`;
    const values = [time, orderedtime, number, reservation];
    db.run(sql, values, (err) => {
        if(err) {
            console.error('データ保存エラー:', err.message);
      return res.status(500).send('データ保存中にエラーが発生しました。');
        }
        res.redirect('/')
    })

   

  
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
    let id = req.query.id;

    // 1. 削除対象の注文情報を取得
    let sqlGetOrder = 'SELECT * FROM form_data WHERE id = ?';
    db.get(sqlGetOrder, [id], (err, canceledOrder) => {
        if (err) {
            console.log('Error retrieving order:', err);
            return res.status(500).send('Database error');
        }

        if (!canceledOrder) {
            return res.status(404).send('Order not found');
        }

        // 2. 予約注文なら `completion_time` を変更せず削除のみ
        if (canceledOrder.reservation === 1) {
          db.run('DELETE FROM form_data WHERE id = ?', [id], (err) => {
              if (err) {
                  console.log('Delete error:', err);
                  return res.status(500).send('Database error');
              }
              return res.redirect('/timeline');
          });
          return;
      } 

        // 2. 影響を受ける後続の注文を取得
        let sqlGetSubsequent = 'SELECT * FROM form_data WHERE time > ? AND reservation === 0 ORDER BY id';
        db.all(sqlGetSubsequent, [canceledOrder.time], (err, subsequentOrders) => {
            if (err) {
                console.log('Error retrieving subsequent orders:', err);
                return res.status(500).send('Database error');
            }

            // 3. 注文を削除
            let sqlDelete = 'DELETE FROM form_data WHERE id = ?';
            db.run(sqlDelete, [id], (err) => {
                if (err) {
                    console.log('Delete error:', err);
                    return res.status(500).send('Database error');
                }

                // 4. 後続の注文の `completion_time` を繰り上げ
                let currentTime = new Date(new Date(canceledOrder.time) - canceledOrder.number / 10 * 60 * 1000);
                
                const updateOrder = (order, next) => {
                    let cookingTime = Math.floor((order.number * 6) / 60); // 調理時間（分）
                    currentTime = new Date(currentTime.getTime() + cookingTime * 60 * 1000);
                    

                    let sqlUpdate = 'UPDATE form_data SET time = ? WHERE id = ?';
                    db.run(sqlUpdate, [currentTime, order.id], (err) => {
                        if (err) {
                            console.log('Error updating order:', err);
                            next(err);
                            return;
                        }
                        next(null);
                    });
                };

                let index = 0;
                const processNext = (err) => {
                    if (err || index >= subsequentOrders.length) {
                        return res.redirect('/timeline');
                    }
                    updateOrder(subsequentOrders[index++], processNext);
                };

                processNext();
            });
        });
    });
});


     

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






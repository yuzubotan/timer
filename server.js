const app = require('./index');
const port = 3001;
const { insertFormData } = require('./db');
const db = require('./db');

app.get('/', (req,res) => {
    let sql = "select * from form_data where checked = 0 order by time asc limit 1"
    db.all(sql, (err, rows) => {
        let opt = {
            title: "new_timer",
            data: rows
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
    const sql = "select * from form_data order by time asc";
    db.all(sql, [], (err, rows) => {
        if(err) {
            console.log('Database query error:', err.message);
            return res.status(500).send('Database query error');
        }

        const data = rows.map(row => {
            const date = new Date(row.time);

            const formattedTime = date.toLocaleTimeString('ja-JP', {
                hour: '2-digit',
                minute: '2-digit',
            })
            return {
                id: row.id,
              datetime: formattedTime,
              number: row.number,
              hour: date.getHours(),
              minutes: date.getMinutes(),
            };
          });

      res.render('timeline.ejs', { title: 'timeline', data });
    })
    
    
})

app.post('/submit', (req, res) => {
    const { time, number } = req.body;
    const sql = `INSERT INTO form_data (time, number) VALUES (?, ?)`;
    const values = [time, number];
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
    let sql = 'delete from form_data where id =' + id;
    db.run(sql, (err) => {
      res.redirect('/timeline');
    })
  })

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





app.listen(port, () => {
    console.log(`Server is running on ${port} `);
})
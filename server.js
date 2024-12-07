const app = require('./index');
const port = 3001;
const { insertFormData } = require('./db');
const db = require('./db');

app.get('/', (req,res) => {
    let opt = {
        title: "new_timer"
    }
    res.render('index.ejs', opt);
})

app.get('/timeline', (req, res) => {
    let opt = {
        title: "timeline"
    }
    res.render('timeline.ejs', opt);
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

  // サーバーサイドのエンドポイント
  app.post("/reset", (req, res) => {
    let sql = "DELETE FROM form_data";
    db.run(sql, (err) => {
      if (err) {
        console.error('データベースのリセットに失敗しました。', err);
        res.status(500).send('Internal Server Error');
      } else {
        console.log('データベースをリセットしました。');
        res.status(200).send('OK');
      }
    
      
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
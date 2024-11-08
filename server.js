const app = require('./index');
const port = 3001;

app.get('/', (req,res) => {
    let opt = {
        title: "new_timer"
    }
    res.render('index.ejs', opt);
})

app.listen(port, () => {
    console.log(`Server is running on ${port} `);
})
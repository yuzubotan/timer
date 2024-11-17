const app = require('./index');
const port = 3001;

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

app.listen(port, () => {
    console.log(`Server is running on ${port} `);
})
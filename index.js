const express = require('express');
const app = express();



app.set("view engine", "ejs");
app.set("views", "views");
app.use(express.urlencoded({ extended: true })); // URLエンコードされたデータを解析
app.use(express.json()); // JSONデータを解析
app.use(express.static('public'));



module.exports = app;
var proxy = require("./server.js");
var express = require('express');

var app = express();
// 포트 지정
var port = (process.env.PORT || 3000);

// 미들 웨어
app.use("/", proxy());

app.listen(port, () => {
    console.log(`Server runing on port --- ${port}`)
})
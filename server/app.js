var proxy = require("./server.js");
var express = require('express');

var app = express();
var port = (process.env.PORT || 3001);

app.use("/", proxy());

console.log("Server running on port", port);
app.listen(port);
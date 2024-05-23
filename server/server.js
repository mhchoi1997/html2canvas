const express = require('express');
const url = require('url');
const cors = require('cors');
const request = require('request');

// 파라미터 검사
function validUrl(req, res, next) {
    console.log("Received URL:", req.query.url); // 로그 추가
    if (!req.query.url) {
        next(new Error('No url specified'));
    } else if (typeof req.query.url !== 'string' || url.parse(req.query.url).host === null) {
        next(new Error(`Invalid url specified: ${req.query.url}`));
    } else {
        next();
    }
}

function process(req, res, next) {
    switch (req.query.responseType) {
        case 'blob':
            req.pipe(request(req.query.url).on('error', next)).pipe(res);
            break;
        default:
            request({url: req.query.url, encoding: 'binary'}, (error, response, body) => {
                if (error) return next(error);
                const contentType = response.headers['content-type'];
                const dataURL = Buffer.from(body, 'binary').toString('base64');
                res.send(`data:${contentType};base64,${dataURL}`)
            });
    }
}

module.exports = () => {
    const app = express();
    // 루트 경로에 대한 cors활성화
    app.get('/', cors(), validUrl, process);

    return app;
};
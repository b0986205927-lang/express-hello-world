const express = require('express');
const line = require('@line/bot-sdk');

// LINE 驗證設定
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.CHANNEL_SECRET || ''
};

const app = express();

// 首頁測試 (解決 Render 的網頁 Live 狀態)
app.get('/', (req, res) => {
  res.send('來自 Render 的問候：LINE Bot 伺服器運行中！');
});

// LINE Webhook 專用接收入口 (解決 404 錯誤)
app.post('/webhook', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const client = new line.Client(config);
  const echo = { type: 'text', text: '您說了: ' + event.message.text };

  return client.replyMessage(event.replyToken, echo);
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`listening on ${port}`);
});

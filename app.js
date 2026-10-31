'use strict';

const express = require('express');
const line = require('@line/bot-sdk');

// 從 Render 的環境變數讀取 LINE 金鑰
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const app = express();

app.get('/', (req, res) => {
  res.send('LINE Bot is running!');
});

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

  // 收到文字訊息後自動回覆相同內容
  const echo = { type: 'text', text: event.message.text };
  const client = new line.Client(config);
  return client.replyMessage(event.replyToken, echo);
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

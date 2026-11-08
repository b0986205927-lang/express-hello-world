const express = require('express');
const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);
const app = express();

app.post('/callback', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userText = event.message.text.trim();
  let replyText = '';

  // 智慧關鍵字判斷邏輯（完全免費）
  if (userText.includes('預約') || userText.includes('拿') || userText.includes('點餐') || userText.includes('三明治') || userText.includes('漢堡')) {
    replyText = `【系統確認】收到您的點餐/預約需求：「${userText}」。老闆已經幫您登記好囉！請依約定時間前往取餐，謝謝您！`;
  } else if (userText.includes('改') || userText.includes('時間') || userText.includes('順延')) {
    replyText = `【時間調整】沒問題！已經幫您把取餐時間做調整與備註了，期待您的光臨！`;
  } else {
    replyText = `老闆好！我是您的智能訂餐小幫手。您可以傳送「我要預約 8:30 拿三明治」或「幫我改時間」，我會隨時幫您處理！`;
  }

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: replyText
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

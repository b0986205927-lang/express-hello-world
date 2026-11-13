const express = require('express');
const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);
const app = express();

// 接收 LINE Webhook 請求
app.post('/callback', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// 處理客人傳來的訊息與按鈕點擊
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userText = event.message.text.trim();

  // 1. 當客人點擊圖文選單的「線上點餐」
  if (userText === '我要點餐') {
    return sendMenuFlexMessage(client, event.replyToken);
  }

  // 2. 當客人點擊卡片上的「起司蛋餅」
  if (userText === '我要點起司蛋餅') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '【系統確認】已幫您記錄一份「起司蛋餅 ($35)」，老闆開始為您準備囉！'
    });
  }

  // 3. 當客人點擊卡片上的「大杯冰奶茶」
  if (userText === '我要點大杯冰奶茶') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '【系統確認】已幫您記錄一杯「大杯冰奶茶 ($25)」，老闆開始為您準備囉！'
    });
  }

  // 4. 其他預設回覆
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: `【系統確認】收到您的需求：「${userText}」。請點擊下方選單開始點餐！`
  });
}

// 產生精美早餐菜單圖卡 (Flex Message)
async function sendMenuFlexMessage(client, replyToken) {
  const flexMessage = {
    type: 'flex',
    altText: '請選擇您的美味早餐！',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '🍳 晨間廚房 - 線上點餐',
            weight: 'bold',
            size: 'lg',
            color: '#1DB446'
          },
          {
            type: 'separator',
            margin: 'md'
          },
          {
            type: 'text',
            text: '請直接點擊下方按鈕選擇餐點：',
            size: 'sm',
            color: '#666666',
            margin: 'md'
          },
          {
            type: 'button',
            style: 'primary',
            color: '#FF6b6b',
            action: {
              type: 'message',
              label: '🔥 起司蛋餅 ($35)',
              text: '我要點起司蛋餅'
            },
            margin: 'md'
          },
          {
            type: 'button',
            style: 'primary',
            color: '#FF6b6b',
            action: {
              type: 'message',
              label: '🥤 大杯冰奶茶 ($25)',
              text: '我要點大杯冰奶茶'
            },
            margin: 'sm'
          }
        ]
      }
    }
  };

  return client.replyMessage(replyToken, flexMessage);
}

// 啟動伺服器
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

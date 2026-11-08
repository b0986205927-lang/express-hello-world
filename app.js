const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// 動態資料庫：可由店家的控制後台隨時切換 isBusy 狀態
const db = {
  stores: {
    'store_megawind': { 
      name: '麥味登', 
      balance: 500, 
      isBusy: false // 預設為「不忙碌」（正常接單），只有當真的爆單時才設為 true
    },
    'store_superman': { 
      name: '美而美 (12公尺旁)', 
      balance: 300, 
      isBusy: false 
    }
  }
};

app.get('/', (req, res) => {
  res.send('Smart F&B Dispatch Bot is running with dynamic capacity!');
});

// LINE Webhook 接收端點
app.post('/webhook', async (req, res) => {
  res.status(200).send('OK');

  const events = req.body.events;
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      await handleIncomingMessage(event);
    }
  }
});

// 動態智慧調度與產能判斷核心
async function handleIncomingMessage(event) {
  const userMessage = event.message.text.trim();
  const replyToken = event.replyToken;
  let replyText = '';

  const targetStore = db.stores['store_megawind'];

  // 測試用小工具指令：讓你可以隨時在 LINE 打「模擬爆單」來切換麥味登狀態
  if (userMessage === '模擬爆單') {
    targetStore.isBusy = true;
    replyText = `【系統管理】已強制將麥味登狀態切換為：【忙碌中 (Busy)】。現在客人點餐將會觸發 A/B 分流！`;
  } 
  else if (userMessage === '解除爆單') {
    targetStore.isBusy = false;
    replyText = `【系統管理】已將麥味登狀態恢復為：【正常營業】。`;
  }
  // 正常點餐流程
  else if (userMessage.includes('我要點餐') || userMessage.includes('麥味登')) {
    
    // 檢查是不是真的處於忙碌狀態
    if (targetStore.isBusy) {
      // 真的忙碌時，才啟動 A/B 智慧分流
      replyText = `【智慧分流通知】\n目前麥味登現場訂單滿載（尖峰忙碌中）。\n\n` +
                  `為讓您準時取餐，提供您以下方案：\n` +
                  `【方案 A】麥味登於 08:17 為您製作完成。\n` +
                  `【方案 B】位於 12 公尺旁的美而美可於 07:40 準時為您做好！\n\n` +
                  `回覆「選擇A」或「選擇B」以確認訂單與扣除 50% 訂金。`;
    } else {
      // 不忙碌時，正常順暢接單！
      replyText = `【麥味登】點餐成功！\n目前店內產能充足，您的餐點已為您排入 07:40 的製作排程，期待您的蒞臨！`;
    }
  } 
  // 選擇方案 B（跨店分流與金流轉移）
  else if (userMessage.includes('選擇B')) {
    const depositAmount = 50; 
    db.stores['store_megawind'].balance -= depositAmount;
    db.stores['store_superman'].balance += depositAmount;

    replyText = `【分流成功】\n已為您切換至美而美（12公尺旁），預定 07:40 取餐。\n` +
                `50% 訂金已自動從麥味登轉入美而美帳戶！`;
  }
  else {
    replyText = `您說的是：「${userMessage}」\n(提示：傳送「我要點餐」測試正常接單；傳送「模擬爆單」可測試 A/B 分流機制)`;
  }

  await sendLineReply(replyToken, replyText);
}

async function sendLineReply(replyToken, text) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
      replyToken: replyToken,
      messages: [{ type: 'text', text: text }]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}`
      }
    });
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

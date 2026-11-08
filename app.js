const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

// 搭配 LINE Webhook 驗證，保留原始 Body Buffer
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// 模擬店家資料庫與儲值帳戶餘額、產能狀態
const db = {
  stores: {
    'store_megawind': { name: '麥味登', balance: 500, capacityStatus: 'busy' }, // busy 代表 07:00~08:15 忙碌
    'store_superman': { name: '美而美 (12公尺旁)', balance: 300, capacityStatus: 'available' }
  }
};

// 根目錄測試路由
app.get('/', (req, res) => {
  res.send('Smart F&B Dispatch Bot is running smoothly!');
});

// LINE Webhook 接收端點
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  const bodyString = req.rawBody.toString('utf8');

  // 簡單簽章驗證（正式環境建議啟用）
  // if (!validateSignature(bodyString, process.env.CHANNEL_SECRET, signature)) {
  //   return res.status(401).send('Invalid signature');
  // }

  res.status(200).send('OK');

  const events = req.body.events;
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      await handleIncomingMessage(event);
    }
  }
});

// 核心訊息與智慧調度邏輯
async function handleIncomingMessage(event) {
  const userMessage = event.message.text.trim();
  const replyToken = event.replyToken;
  let replyText = '';

  // 模擬情境 1：點餐與產能檢核
  if (userMessage.includes('我要點餐') || userMessage.includes('麥味登')) {
    const targetStore = db.stores['store_megawind'];
    
    if (targetStore.capacityStatus === 'busy') {
      // 觸發 A/B 智慧分流演算法
      replyText = `【系統通知】\n您預約的時段（07:00～08:15）麥味登目前處於【忙碌狀態】。\n\n` +
                  `為確保您能準時取餐，為您提供以下方案：\n` +
                  `【方案 A】麥味登於 08:17 為您製作完成。\n` +
                  `【方案 B】位於 12 公尺旁的美而美可於 07:40 準時為您做好！\n\n` +
                  `回覆「選擇A」或「選擇B」以確認訂單與扣除 50% 訂金。`;
    } else {
      replyText = `【麥味登】預約成功！7:40 的餐點已為您排入產能排程中。`;
    }
  } 
  // 模擬情境 2：選擇方案 B（跨店分流與金流轉移）
  else if (userMessage.includes('選擇B')) {
    // 執行資料庫交易模擬：從麥味登帳戶轉移訂金到美而美帳戶
    const depositAmount = 50; // 假設訂金 50 元
    db.stores['store_megawind'].balance -= depositAmount;
    db.stores['store_superman'].balance += depositAmount;

    replyText = `【分流成功】\n已為您切換至美而美（12公尺旁），預定 07:40 取餐。\n` +
                `50% 訂金已自動從麥味登轉入美而美帳戶，店家端已同步接單！`;
  }
  // 模擬情境 3：動態改期（例如延後至 8 點）
  else if (userMessage.includes('改到8點') || userMessage.includes('延到8點')) {
    replyText = `【改期成功】\n已為您將取餐時間調整為 08:00。廚房產能已重新排程，期待您的蒞臨！`;
  }
  // 預設：鸚鵡回話模式 (Echo)
  else {
    replyText = `您剛剛說的是：「${userMessage}」\n(提示：傳送「我要點餐」可體驗智慧分流與產能控管測試)`;
  }

  // 透過 LINE Messaging API 回傳訊息
  await sendLineReply(replyToken, replyText);
}

// 發送 LINE 回覆的共用函式
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
    console.error('Error sending LINE reply:', error.response?.data || error.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

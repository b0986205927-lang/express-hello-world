const express = require('express');
const axios = require('axios');

const app = express();

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// 動態資料庫與店家狀態
const db = {
  stores: {
    'store_megawind': { 
      name: '麥味登', 
      balance: 500, 
      isBusy: false,
      orders: [] // 用來儲存店家收到的真實預約單
    },
    'store_superman': { 
      name: '美而美 (12公尺旁)', 
      balance: 300, 
      isBusy: false,
      orders: []
    }
  }
};

app.get('/', (req, res) => {
  res.send('Smart F&B Dispatch Bot with OpenAI is running!');
});

app.post('/webhook', async (req, res) => {
  res.status(200).send('OK');

  const events = req.body.events;
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      await handleIncomingMessageWithAI(event);
    }
  }
});

// 核心：結合 OpenAI 語意解析與智慧排程
async function handleIncomingMessageWithAI(event) {
  const userMessage = event.message.text.trim();
  const replyToken = event.replyToken;
  let replyText = '';

  const targetStore = db.stores['store_megawind'];

  // 系統管理指令（測試用）
  if (userMessage === '模擬爆單') {
    targetStore.isBusy = true;
    return await sendLineReply(replyToken, `【系統管理】已將麥味登切換為：【忙碌中】。`);
  } else if (userMessage === '解除爆單') {
    targetStore.isBusy = false;
    return await sendLineReply(replyToken, `【系統管理】已將麥味登恢復為：【正常營業】。`);
  } else if (userMessage === '查看店家訂單') {
    const orderList = targetStore.orders.length > 0 
      ? targetStore.orders.map((o, idx) => `${idx+1}. 時間: ${o.time} | 內容: ${o.content}`).join('\n')
      : `目前沒有新訂單。`;
    return await sendLineReply(replyToken, `【店家後台通知面板】\n麥味登收到的預約清單：\n${orderList}`);
  }

  // 呼叫 OpenAI API 讓 AI 判斷客人的意圖與預約時間
  try {
    const aiAnalysis = await parseUserIntentWithOpenAI(userMessage);
    
    // 如果 AI 判斷這是一則「點餐或預約」的訊息
    if (aiAnalysis.isOrderOrBooking) {
      const bookedTime = aiAnalysis.time || '未指定時間';

      if (targetStore.isBusy) {
        // 麥味登忙碌中 -> 啟動 A/B 分流
        replyText = `【智慧分流通知】\n目前麥味登現場訂單滿載（尖峰忙碌中）。\n\n` +
                    `您希望預約 ${bookedTime} 取餐，為您提供以下方案：\n` +
                    `【方案 A】麥味登於 08:17 為您製作完成。\n` +
                    `【方案 B】位於 12 公尺旁的美而美可於 ${bookedTime} 準時為您做好！\n\n` +
                    `回覆「選擇A」或「選擇B」以確認訂單與扣除 50% 訂金。`;
      } else {
        // 麥味登不忙碌 -> 成功接單，並寫入店家後台！
        targetStore.orders.push({ time: bookedTime, content: userMessage, timestamp: new Date() });
        
        replyText = `【麥味登】預約成功！🎉\n` +
                    `已為您排入 ${bookedTime} 的製作排程。\n` +
                    `✅ **店家已即時收到您的預約通知**，請準時蒞臨取餐！`;
      }
    } else {
      // 如果不是點餐，就讓 AI 自由對話回覆
      replyText = aiAnalysis.reply || `您說的是：「${userMessage}」`;
    }
  } catch (error) {
    console.error('AI Processing Error:', error);
    replyText = `系統接收到您的訊息：「${userMessage}」，排程系統處理中！`;
  }

  await sendLineReply(replyToken, replyText);
}

// 呼叫 OpenAI 進行智慧語意解析
async function parseUserIntentWithOpenAI(message) {
  // 如果你有設定 OPENAI_API_KEY 環境變數，這裡就會真正呼叫 ChatGPT
  if (!process.env.OPENAI_API_KEY) {
    // 簡易防呆模擬（如果還沒填 Key 的備用方案）
    if (message.includes('預約') || message.includes('拿') || message.includes('點')) {
      return { isOrderOrBooking: true, time: '08:30' };
    }
    return { isOrderOrBooking: false, reply: `收到您的訊息：${message}` };
  }

  const response = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `你是一個智慧餐飲助理。請分析使用者的訊息，並回傳純 JSON 格式（不要包在 markdown 裡面）：
        {
          "isOrderOrBooking": true/false, // 是否為點餐或預約取餐
          "time": "抓取到的時間，例如 08:30 (若無則填 null)",
          "reply": "如果不是點餐，請用親切的口吻回覆使用者"
        }`
      },
      { role: 'user', content: message }
    ],
    response_format: { type: "json_object" }
  }, {
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  return JSON.parse(response.data.choices[0].message.content);
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

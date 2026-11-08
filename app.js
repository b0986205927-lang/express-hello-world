const express = require('express');
const line = require('@line/bot-sdk');
const { OpenAI } = require('openai');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

  const userText = event.message.text;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `你是一個專業且親切的台灣早餐/餐廳訂購系統助手。請分析顧客訊息，判斷意圖（預約取餐、修改時間、查詢訂單或一般對話），並以繁體中文親切回覆。若為點餐/預約，請整理出預約時間、品項與數量、取餐方式。`
        },
        { role: 'user', content: userText }
      ],
    });

    const replyText = completion.choices[0].message.content;

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: replyText
    });
  } catch (error) {
    console.error('OpenAI Error:', error);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '拍謝！系統處理您的訂單時發生一點小狀況，請稍後再試一次！'
    });
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const express = require('express');
const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);
const app = express();

const menuDB = [
  { item_id: 'B01', category: '主食便當區', name: '招牌排骨飯', price: 110, is_sold_out: false, need_drink_options: false },
  { item_id: 'B02', category: '主食便當區', name: '香酥雞腿飯', price: 120, is_sold_out: false, need_drink_options: false },
  { item_id: 'S01', category: '單點炸物區', name: '黃金雞塊', price: 50, is_sold_out: false, need_drink_options: false },
  { item_id: 'D01', category: '飲料湯品區', name: '古早味紅茶', price: 30, is_sold_out: false, need_drink_options: true },
  { item_id: 'D02', category: '飲料湯品區', name: '鮮奶茶', price: 50, is_sold_out: false, need_drink_options: true },
];

const cartDB = new Map();

function addToCart(userId, item, options) {
  const list = cartDB.get(userId) || [];
  const existing = list.find((c) => c.item_id === item.item_id && c.options === options);
  if (existing) {
    existing.qty += 1;
  } else {
    list.push({
      item_id: item.item_id,
      name: item.name,
      price: item.price,
      qty: 1,
      options: options || '',
    });
  }
  cartDB.set(userId, list);
}

function getCartSummary(userId) {
  const list = cartDB.get(userId) || [];
  const totalAmount = list.reduce((sum, item) => sum + item.price * item.qty, 0);
  const summaryText = list
    .map((item) => {
      const opt = item.options ? ' (' + item.options + ')' : '';
      return '・' + item.name + opt + ' x' + item.qty + ' = $' + item.price * item.qty;
    })
    .join('\n');
  return { list, totalAmount, summaryText };
}

function sendMenuFlex(replyToken) {
  const buttons = menuDB
    .filter((m) => !m.is_sold_out)
    .map((item) => ({
      type: 'button',
      style: 'primary',
      color: '#FF6B6B',
      margin: 'sm',
      height: 'sm',
      action: {
        type: 'postback',
        label: item.name + ' $' + item.price,
        data: 'action=add_item&item_id=' + encodeURIComponent(item.item_id),
      },
    }));

  return client.replyMessage(replyToken, {
    type: 'flex',
    altText: '請選擇餐點',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '線上點餐菜單', weight: 'bold', size: 'lg', color: '#1DB446' },
          { type: 'separator', margin: 'md' },
          ...buttons,
        ],
      },
    },
  });
}

function sendCartFlex(replyToken, userId, titleText) {
  const { totalAmount, summaryText } = getCartSummary(userId);
  return client.replyMessage(replyToken, {
    type: 'flex',
    altText: '購物車狀態',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: titleText || '購物車狀態', weight: 'bold', size: 'md', color: '#1DB446' },
          { type: 'text', text: summaryText || '購物車是空的', size: 'sm', margin: 'md', wrap: true },
          { type: 'text', text: '目前小計：$' + totalAmount, weight: 'bold', size: 'md', margin: 'md' },
          {
            type: 'button',
            style: 'secondary',
            margin: 'md',
            height: 'sm',
            action: { type: 'postback', label: '+ 繼續加點', data: 'action=open_menu' },
          },
          {
            type: 'button',
            style: 'secondary',
            color: '#999999',
            margin: 'sm',
            height: 'sm',
            action: { type: 'postback', label: '清空購物車', data: 'action=clear_cart' },
          },
        ],
      },
    },
  });
}

async function handleEvent(event) {
  if (!event || !event.source) {
    return Promise.resolve(null);
  }
  const userId = event.source.userId;

  if (event.type === 'postback') {
    const params = new URLSearchParams(event.postback.data);
    const action = params.get('action');

    if (action === 'open_menu') {
      return sendMenuFlex(event.replyToken);
    }

    if (action === 'add_item') {
      const itemId = params.get('item_id');
      const item = menuDB.find((m) => m.item_id === itemId && !m.is_sold_out);
      if (!item) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '不好意思，這道餐點暫時售完囉！',
        });
      }
      addToCart(userId, item, '');
      return sendCartFlex(event.replyToken, userId, '已加入 ' + item.name);
    }

    if (action === 'clear_cart') {
      cartDB.delete(userId);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '購物車已清空！輸入「我要點餐」可重新點餐。',
      });
    }

    return Promise.resolve(null);
  }

  if (event.type === 'message' && event.message.type === 'text') {
    const userText = event.message.text.trim();
    if (userText === '我要點餐') {
      return sendMenuFlex(event.replyToken);
    }
    if (userText === '購物車') {
      return sendCartFlex(event.replyToken, userId, '目前購物車');
    }
  }

  return Promise.resolve(null);
}

app.post('/callback', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('Server is running on port ' + port);
});

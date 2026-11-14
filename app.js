const express = require('express');
const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);
const app = express();

// 老闆接收訂單的 LINE User ID（測試階段可先填你自己的 LINE User ID，留空則只回覆點餐者）
const OWNER_USER_ID = process.env.OWNER_USER_ID || '';

// 1. 菜單表 (Menu) 範例資料
const menuDB = [
  { item_id: 'B01', category: '主食便當區', name: '招牌排骨飯', price: 110, is_sold_out: false, need_drink_options: false },
  { item_id: 'B02', category: '主食便當區', name: '香酥雞腿飯', price: 120, is_sold_out: false, need_drink_options: false },
  { item_id: 'S01', category: '單點炸物區', name: '黃金雞塊', price: 50, is_sold_out: false, need_drink_options: false },
  { item_id: 'D01', category: '飲料湯品區', name: '古早味紅茶', price: 30, is_sold_out: false, need_drink_options: true },
  { item_id: 'D02', category: '飲料湯品區', name: '鮮奶茶', price: 50, is_sold_out: false, need_drink_options: true },
];

// 2. 購物車暫存表 (Cart) & 3. 正式訂單紀錄表 (Orders)
const cartDB = new Map(); // key: userId, value: Array<{ item_id, name, price, qty, options }>
const ordersDB = [];

app.post('/callback', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

async function handleEvent(event) {
  // 處理按鈕 Postback 事件
  if (event.type === 'postback') {
    const userId = event.source.userId;
    const params = new URLSearchParams(event.postback.data);
    const action = params.get('action');

    if (action === 'add_item') {
      const itemId = params.get('item_id');
      const item = menuDB.find((m) => m.item_id === itemId && !m.is_sold_out);
      if (!item) {
        return client.replyMessage(event.replyToken, { type: 'text', text: '不好意思，這道餐點剛售完囉！' });
      }

      // 飲料先跳出冰塊選擇
      if (item.need_drink_options) {
        return sendDrinkIceFlex(event.replyToken, item.item_id, item.name);
      }

      addToCart(userId, item, '');
      return sendCartPromptFlex(event.replyToken, userId, `已加入「${item.name}」`);
    }

    if (action === 'drink_ice') {
      const itemId = params.get('item_id');
      const ice = params.get('ice');
      return sendDrinkSugarFlex(event.replyToken, itemId, ice);
    }

    if (action === 'drink_sugar') {
      const itemId = params.get('item_id');
      const ice = params.get('ice');
      const sugar = params.get('sugar');
      const item = menuDB.find((m) => m.item_id === itemId);
      const options = `${ice} / ${sugar}`;
      addToCart(userId, item, options);
      return sendCartPromptFlex(event.replyToken, userId, `已加入「${item.name}（${options}）」`);
    }

    if (action === 'open_menu') {
      return sendCategoryCarouselFlex(event.replyToken);
    }

    if (action === 'checkout_time') {
      return sendPickupTimeFlex(event.replyToken, userId);
    }

    if (action === 'select_pickup') {
      const pickupTime = params.get('time');
      return handleDepositCheck(event, userId, pickupTime);
    }

    if (action === 'confirm_order') {
      const pickupTime = params.get('time');
      const paymentStatus = params.get('pay');
      return finalizeOrder(event, userId, pickupTime, paymentStatus);
    }
  }

  // 處理文字訊息（圖文選單點「我要點餐」或老闆指令）
  if (event.type === 'message' && event.message.type === 'text') {
    const userText = event.message.text.trim();
    const userId = event.source.userId;

    if (userText === '我要點餐') {
      return sendCategoryCarouselFlex(event.replyToken);
    }

    // 老闆快速改售完狀態：#售完 雞腿飯
    if (userText.startsWith('#售完 ')) {
      const targetName = userText.replace('#售完 ', '').trim();
      const target = menuDB.find((m) => m.name === targetName);
      if (target) {
        target.is_sold_out = true;
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: `✅ 已將「${target.name}」標記為售完。`,
        });
      }
    }

    // 老闆快速恢復上架：#上架 雞腿飯
    if (userText.startsWith('#上架 ')) {
      const targetName = userText.replace('#上架 ', '').trim();
      const target = menuDB.find((m) => m.name === targetName);
      if (target) {
        target.is_sold_out = false;
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: `✅ 已將「${target.name}」重新上架。`,
        });
      }
    }
  }

  return Promise.resolve(null);
}

// 加入購物車（相同品項＋相同備註合併數量）
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
      options,
    });
  }
  cartDB.set(userId, list);
}

function getCartSummary(userId) {
  const list = cartDB.get(userId) || [];
  const totalAmount = list.reduce((sum, item) => sum + item.price * item.qty, 0);
  const summaryText = list
    .map((item) => {
      const opt = item.options ? `（${item.options}）` : '';
      return `• ${item.name}${opt} x${item.qty} = $${item.price * item.qty}`;
    })
    .join('\n');
  return { list, totalAmount, summaryText };
}

// 步驟 1：左右滑動分類卡片 (Carousel Flex Message)
function sendCategoryCarouselFlex(replyToken) {
  const categories = ['主食便當區', '單點炸物區', '飲料湯品區'];
  const bubbles = categories.map((cat) => {
    const items = menuDB.filter((m) => m.category === cat && !m.is_sold_out);
    const buttons = items.map((item) => ({
      type: 'button',
      style: 'primary',
      color: '#FF6B6B',
      margin: 'sm',
      height: 'sm',
      action: {
        type: 'postback',
        label: `${item.name} $${item.price}`,
        data: `action=add_item&item_id=${item.item_id}`,
      },
    }));

    return {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `🍱 ${cat}`, weight: 'bold', size: 'lg', color: '#1DB446' },
          { type: 'separator', margin: 'md' },
          ...buttons,
        ],
      },
    };
  });

  return client.replyMessage(replyToken, {
    type: 'flex',
    altText: '請滑動選擇餐點分類',
    contents: { type: 'carousel', contents: bubbles },
  });
}

// 步驟 2A：飲料冰塊按鈕
function sendDrinkIceFlex(replyToken, itemId, itemName) {
  return client.replyMessage(replyToken, {
    type: 'flex',
    altText: '請選擇冰塊',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `🥤 ${itemName} - 請選冰塊`, weight: 'bold', size: 'md' },
          ...['正常冰', '少冰', '去冰'].map((ice) => ({
            type: 'button',
            style: 'secondary',
            margin: 'sm',
            height: 'sm',
            action: {
              type: 'postback',
              label: ice,
              data: `action=drink_ice&item_id=${itemId}&ice=${encodeURIComponent(ice)}`,
            },
          })),
        ],
      },
    },
  });
}

// 步驟 2B：飲料甜度按鈕
function sendDrinkSugarFlex(replyToken, itemId, ice) {
  return client.replyMessage(replyToken, {
    type: 'flex',
    altText: '請選擇甜度',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `甜度選擇（目前：${ice}）`, weight: 'bold', size: 'md' },
          ...['全糖', '半糖', '無糖'].map((sugar) => ({
            type: 'button',
            style: 'secondary',
            margin: 'sm',
            height: 'sm',
            action: {
              type: 'postback',
              label: sugar,
              data: `action=drink_sugar&item_id=${itemId}&ice=${encodeURIComponent(ice)}&sugar=${encodeURIComponent(sugar)}`,
            },
          })),
        ],
      },
    },
  });
}

// 步驟 2C：加入購物車後詢問 [繼續加點] 或 [去結帳]
function sendCartPromptFlex(replyToken, userId, headerMsg) {
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
          { type: 'text', text: headerMsg, weight: 'bold', size: 'md', color: '#1DB446' },
          { type: 'text', text: summaryText || '購物車是空的', size: 'sm', margin: 'md', wrap: true },
          { type: 'text', text: `目前小計：$${totalAmount}`, weight: 'bold', size: 'md', margin: 'md' },
          {
            type: 'button',
            style: 'secondary',
            margin: 'md',
            height: 'sm',
            action: { type: 'postback', label: '➕ 繼續加點', data: 'action=open_menu' },
          },
          {
            type: 'button',
            style: 'primary',
            color: '#FF6B6B',
            margin: 'sm',
            height: 'sm',
            action: { type: 'postback', label: '🛒 去結帳', data: 'action=checkout_time' },
          },
        ],
      },
    },
  });
}

// 步驟 3A：選擇取餐時間
function sendPickupTimeFlex(replyToken, userId) {
  const { totalAmount, summaryText } = getCartSummary(userId);
  if (!summaryText) {
    return client.replyMessage(replyToken, { type: 'text', text: '您的購物車目前沒有餐點喔！' });
  }

  return client.replyMessage(replyToken, {
    type: 'flex',
    altText: '請選擇取餐時間',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '⏰ 請選擇預計取餐時間', weight: 'bold', size: 'md' },
          { type: 'text', text: `${summaryText}\n總金額：$${totalAmount}`, size: 'sm', margin: 'md', wrap: true },
          ...['15分鐘後', '30分鐘後', '45分鐘後'].map((t) => ({
            type: 'button',
            style: 'primary',
            color: '#1DB446',
            margin: 'sm',
            height: 'sm',
            action: {
              type: 'postback',
              label: t,
              data: `action=select_pickup&time=${encodeURIComponent(t)}`,
 

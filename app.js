const express = require('express');
const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);
const app = express();

const OWNER_USER_ID = process.env.OWNER_USER_ID || '';

// 1. 菜單表 (Menu)
const menuDB = [
  { item_id: 'B01', category: '主食便當區', name: '招牌排骨飯', price: 110, is_sold_out: false, need_drink_options: false },
  { item_id: 'B02', category: '主食便當區', name: '香酥雞腿飯', price: 120, is_sold_out: false, need_drink_options: false },
  { item_id: 'S01', category: '單點炸物區', name: '黃金雞塊', price: 50, is_sold_out: false, need_drink_options: false },
  { item_id: 'D01', category: '飲料湯品區', name: '古早味紅茶', price: 30, is_sold_out: false, need_drink_options: true },
  { item_id: 'D02', category: '飲料湯品區', name: '鮮奶茶', price: 50, is_sold_out: false, need_drink_options: true },
];

// 2. 購物車暫存表 (Cart) & 3. 正式訂單紀錄表 (Orders)
const cartDB = new Map();
const ordersDB = [];
const pendingDepositDB = new Map();

app.post('/callback', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

async function handleEvent(event) {
  if (!event || !event.source) {
    return Promise.resolve(null);
  }

  const userId = event.source.userId;

  if (event.type === 'postback') {
    const params = new URLSearchParams(event.postback.data);
    const action = params.get('action');

    if (action === 'add_item') {
      const itemId = params.get('item_id');
      const item = menuDB.find((m) => m.item_id === itemId && !m.is_sold_out);
      if (!item) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '不好意思，這道餐點暫時售完囉！',
        });
      }
      if (item.need_drink_options) {
        return sendDrinkIceFlex(event.replyToken, item.item_id, item.name);
      }
      addToCart(userId, item, '');
      return sendCartPromptFlex(event.replyToken, userId, '已加入「' + item.name + '」');
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
      if (!item) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '找不到這杯飲品，請重新點餐。',
        });
      }
      const options = ice + ' / ' + sugar;
      addToCart(userId, item, options);
      return sendCartPromptFlex(event.replyToken, userId, '已加入「' + item.name + ' (' + options + ')」');
    }

    if (action === 'open_menu') {
      return sendCategoryCarouselFlex(event.replyToken);
    }

    if (action === 'clear_cart') {
      cartDB.delete(userId);
      pendingDepositDB.delete(userId);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '🗑️ 購物車已清空！想重新點餐請點下方「線上點餐」或輸入「我要點餐」。',
      });
    }

    if (action === 'cancel_order') {
      const cancelId = params.get('orderId') || '';
      const idx = ordersDB.findIndex((o) => o.order_id === cancelId && o.user_id === userId);
      if (idx !== -1) {
        const canceledOrder = ordersDB[idx];
        ordersDB.splice(idx, 1);
        pendingDepositDB.delete(userId);
        if (OWNER_USER_ID) {
          await client.pushMessage(OWNER_USER_ID, {
            type: 'text',
            text: '⚠️ 顧客已取消訂單：' + cancelId + '（' + canceledOrder.user_name + '）',
          });
        }
      }
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '❌ 訂單 ' + cancelId + ' 已為您取消！若需重新點餐，請點選下方「線上點餐」。',
      });
    }

    if (action === 'checkout_time') {
      const { list, totalAmount } = getCartSummary(userId);
      if (!list.length || totalAmount <= 0) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '您的購物車目前是空的喔！請重新點選「我要點餐」選購餐點。',
        });
      }
      return sendPickupTimeFlex(event.replyToken, userId);
    }

    if (action === 'select_pickup') {
      const pickupTime = params.get('time') || '15分鐘後';
      return handleDepositCheck(event, userId, pickupTime);
    }

    if (action === 'confirm_order') {
      const pickupTime = params.get('time') || '15分鐘後';
      const paymentStatus = params.get('pay') || '現場付';
      return finalizeOrder(event, userId, pickupTime, paymentStatus);
    }

    if (action === 'ask_last5') {
      const pickupTime = params.get('time') || '15分鐘後';
      const payLabel = params.get('label') || '全額付清';
      pendingDepositDB.set(userId, { pickupTime, payLabel });
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '請直接輸入您的「轉帳帳號末五碼」（例如：12345），方便店家核對【' + payLabel + '】帳款。',
      });
    }

    return Promise.resolve(null);
  }

  if (event.type === 'message' && event.message.type === 'text') {
    const userText = event.message.text.trim();

    if (pendingDepositDB.has(userId)) {
      if (!/^\d{5}$/.test(userText)) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '請輸入 5 碼數字的「轉帳末五碼」（例如：12345）。',
        });
      }
      const { pickupTime, payLabel } = pendingDepositDB.get(userId);
      pendingDepositDB.delete(userId);
      return finalizeOrder(event, userId, pickupTime, payLabel + '（末五碼：' + userText + '）');
    }

    if (userText === '查詢訂單') {
      const myOrders = ordersDB.filter((o) => o.user_id === userId);
      if (myOrders.length === 0) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '您目前還沒有成立的訂單喔！想點餐請輸入「我要點餐」。',
        });
      }
      const latest = myOrders[myOrders.length - 1];
      const itemsText = latest.items_detail
        .map((item) => {
          const opt = item.options ? ' (' + item.options + ')' : '';
          return '・' + item.name + opt + ' x' + item.qty + ' = $' + item.price * item.qty;
        })
        .join('\n');

      return client.replyMessage(event.replyToken, {
        type: 'flex',
        altText: '🧾 您的最新訂單',
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '🧾 您的最新訂單', weight: 'bold', size: 'lg', color: '#1DB446' },
              { type: 'text', text: '單號：' + latest.order_id, size: 'sm', margin: 'md', weight: 'bold' },
              { type: 'text', text: '預計取餐：' + latest.pickup_time, size: 'sm', margin: 'xs' },
              { type: 'text', text: '付款方式：' + latest.payment_status, size: 'sm', margin: 'xs' },
              { type: 'separator', margin: 'md' },
              { type: 'text', text: itemsText, size: 'sm', margin: 'md', wrap: true },
              { type: 'text', text: '總金額：$' + latest.total_amount, weight: 'bold', size: 'md', margin: 'md' },
              {
                type: 'button',
                style: 'secondary',
                margin: 'lg',
                height: 'sm',
                action: {
                  type: 'postback',
                  label: '❌ 取消此筆訂單',
                  data: 'action=cancel_order&orderId=' + latest.order_id,
                },
              },
            ],
          },
        },
      });
    }

    if (userText === '我要點餐') {
      return sendCategoryCarouselFlex(event.replyToken);
    }

    if (userText.startsWith('#售完 ')) {
      const targetName = userText.replace('#售完 ', '').trim();
      const target = menuDB.find((m) => m.name === targetName);
      if (target) {
        target.is_sold_out = true;
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '⛔ 已將「' + target.name + '」標記為售完。',
        });
      }
    }

    if (userText.startsWith('#上架 ')) {
      const targetName = userText.replace('#上架 ', '').trim();
      const target = menuDB.find((m) => m.name === targetName);
      if (target) {
        target.is_sold_out = false;
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '✅ 已將「' + target.name + '」重新上架。',
        });
      }
    }
  }

  return Promise.resolve(null);
}

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
      options: options,
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
        label: item.name + ' $' + item.price,
        data: 'action=add_item&item_id=' + item.item_id,
      },
    }));

    return {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '🍽️ ' + cat, weight: 'bold', size: 'lg', color: '#1DB446' },
          { type: 'text', text: '🍽️ ' + cat, weight: 'bold', size: 'lg', color: '#1DB446' },

const express = require('express');
const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const OWNER_USER_ID = process.env.OWNER_USER_ID || '';
const BANK_INFO = '銀行代號：807 (永豐)\n帳號：請填入老闆帳號';
const TWQR_INFO = 'TWQR 掃碼／行動銀行轉帳：請填入 TWQR 帳號或收款說明';
const LINEPAY_PERSONAL_INFO = 'LINE Pay 個人轉帳：請填入您的 LINE ID 或收款連結／說明';

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
const ordersDB = [];
const pendingDepositDB = new Map();

app.get('/', (req, res) => {
  res.send('OK');
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
          {
            type: 'button',
            style: 'primary',
            color: '#FF6B6B',
            margin: 'sm',
            height: 'sm',
            action: { type: 'postback', label: '去結帳', data: 'action=checkout_time' },
          },
        ],
      },
    },
  });
}
 function sendPickupTimeFlex(replyToken, userId) {
  const { list, totalAmount, summaryText } = getCartSummary(userId);
  if (!list.length || totalAmount <= 0) {
    return client.replyMessage(replyToken, {
      type: 'text',
      text: '您的購物車目前是空的喔！請輸入「我要點餐」選購餐點。',
    });
  }

  const timeButtons = ['15分鐘後', '30分鐘後', '45分鐘後'].map((t) => ({
    type: 'button',
    style: 'primary',
    color: '#1DB446',
    margin: 'sm',
    height: 'sm',
    action: {
      type: 'postback',
      label: t,
      data: 'action=select_pickup&time=' + encodeURIComponent(t),
    },
  }));

  return client.replyMessage(replyToken, {
    type: 'flex',
    altText: '請選擇預計取餐時間',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '請選擇預計取餐時間', weight: 'bold', size: 'md', color: '#1DB446' },
          { type: 'text', text: summaryText + '\n總金額：$' + totalAmount, size: 'sm', margin: 'md', wrap: true },
          ...timeButtons,
        ],
      },
    },
  });
} 
  function sendPaymentMethodFlex(replyToken, pickupTime, totalAmount, isOver500) {
  const deposit = Math.ceil(totalAmount * 0.5);
  const amountNote = isOver500
    ? '總金額：$' + totalAmount + '（滿 $500 需先轉帳，訂金一半 $' + deposit + ' 或全額 $' + totalAmount + '）'
    : '總金額：$' + totalAmount;

  const buttons = [
    {
      type: 'button',
      style: 'primary',
      color: '#FF6B6B',
      margin: 'md',
      height: 'sm',
      action: {
        type: 'postback',
        label: '銀行轉帳／TWQR',
        data:
          'action=pay_method&method=' +
          encodeURIComponent('銀行轉帳／TWQR') +
          '&time=' +
          encodeURIComponent(pickupTime) +
          '&over500=' +
          (isOver500 ? '1' : '0'),
      },
    },
    {
      type: 'button',
      style: 'primary',
      color: '#06C755',
      margin: 'sm',
      height: 'sm',
      action: {
        type: 'postback',
        label: 'LINE Pay 個人轉帳',
        data:
          'action=pay_method&method=' +
          encodeURIComponent('LINE Pay 個人轉帳') +
          '&time=' +
          encodeURIComponent(pickupTime) +
          '&over500=' +
          (isOver500 ? '1' : '0'),
      },
    },
  ];

  if (!isOver500) {
    buttons.push({
      type: 'button',
      style: 'secondary',
      margin: 'sm',
      height: 'sm',
      action: {
        type: 'postback',
        label: '現場付款 $' + totalAmount,
        data: 'action=pay_cash&time=' + encodeURIComponent(pickupTime),
      },
    });
  }

  return client.replyMessage(replyToken, {
    type: 'flex',
    altText: '請選擇付款方式',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '請選擇付款方式', weight: 'bold', size: 'lg', color: '#1DB446' },
          { type: 'text', text: amountNote, size: 'sm', margin: 'md', wrap: true },
          ...buttons,
        ],
      },
    },
  });
}
  function sendTransferOptionsFlex(replyToken, pickupTime, totalAmount, method, isOver500) {
  const deposit = Math.ceil(totalAmount * 0.5);
  const detailText =
    method === 'LINE Pay 個人轉帳'
      ? LINEPAY_PERSONAL_INFO
      : BANK_INFO + '\n' + TWQR_INFO;

  const amountText = isOver500
    ? '・訂金一半：$' + deposit + '\n・全部一次付清：$' + totalAmount
    : '・應付金額：$' + totalAmount;

  const buttons = isOver500
    ? [
        {
          type: 'button',
          style: 'primary',
          color: '#FF6B6B',
          margin: 'md',
          height: 'sm',
          action: {
            type: 'postback',
            label: '訂金付一半 $' + deposit,
            data:
              'action=ask_last5&time=' +
              encodeURIComponent(pickupTime) +
              '&label=' +
              encodeURIComponent(method + ' - 訂金一半 $' + deposit),
          },
        },
        {
          type: 'button',
          style: 'primary',
          color: '#2A9D8F',
          margin: 'sm',
          height: 'sm',
          action: {
            type: 'postback',
            label: '全部付清 $' + totalAmount,
            data:
              'action=ask_last5&time=' +
              encodeURIComponent(pickupTime) +
              '&label=' +
              encodeURIComponent(method + ' - 全部付清 $' + totalAmount),
          },
        },
      ]
    : [
        {
          type: 'button',
          style: 'primary',
          color: '#2A9D8F',
          margin: 'md',
          height: 'sm',
          action: {
            type: 'postback',
            label: '已完成轉帳 $' + totalAmount,
            data:
              'action=ask_last5&time=' +
              encodeURIComponent(pickupTime) +
              '&label=' +
              encodeURIComponent(method + ' - 已付清 $' + totalAmount),
          },
        },
      ];

  return client.replyMessage(replyToken, {
    type: 'flex',
    altText: method + ' 付款資訊',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: method, weight: 'bold', size: 'lg', color: '#E63946' },
          {
            type: 'text',
            text: '訂單總額：$' + totalAmount + '\n' + amountText + '\n\n' + detailText,
            size: 'sm',
            margin: 'md',
            wrap: true,
          },
          ...buttons,
        ],
      },
    },
  });
}

async function handleDepositCheck(event, userId, pickupTime) {
  const { list, totalAmount } = getCartSummary(userId);
  if (!list.length || totalAmount <= 0) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '您的購物車目前是空的喔！請輸入「我要點餐」選購餐點。',
    });
  }

  return sendPaymentMethodFlex(event.replyToken, pickupTime, totalAmount, totalAmount >= 500);
}
 async function finalizeOrder(event, userId, pickupTime, paymentStatus) {
  const { list, totalAmount, summaryText } = getCartSummary(userId);
  if (!list.length || totalAmount <= 0) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '您的購物車目前是空的喔！請輸入「我要點餐」選購餐點。',
    });
  }

  let userName = 'LINE 顧客';
  try {
    const profile = await client.getProfile(userId);
    if (profile && profile.displayName) {
      userName = profile.displayName;
    }
  } catch (_) {}

  const now = new Date();
  const orderId =
    'ORD-' +
    now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    '-' +
    String(ordersDB.length + 1).padStart(3, '0');

  ordersDB.push({
    order_id: orderId,
    created_at: now.toISOString(),
    pickup_time: pickupTime,
    user_id: userId,
    user_name: userName,
    items_detail: list,
    total_amount: totalAmount,
    payment_status: paymentStatus,
  });

  cartDB.delete(userId);

  if (OWNER_USER_ID) {
    await client.pushMessage(OWNER_USER_ID, {
      type: 'text',
      text:
        '新訂單！' +
        orderId +
        '\n顧客：' +
        userName +
        '\n取餐時間：' +
        pickupTime +
        '\n付款狀態：' +
        paymentStatus +
        '\n---\n' +
        summaryText +
        '\n---\n總金額：$' +
        totalAmount,
    });
  }

  return client.replyMessage(event.replyToken, {
    type: 'flex',
    altText: '訂單成立通知',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '訂單成立！', weight: 'bold', size: 'lg', color: '#1DB446' },
          { type: 'text', text: '單號：' + orderId, size: 'sm', margin: 'md', weight: 'bold' },
          { type: 'text', text: '預計取餐：' + pickupTime, size: 'sm', margin: 'xs' },
          { type: 'text', text: '付款方式：' + paymentStatus, size: 'sm', margin: 'xs' },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: summaryText, size: 'sm', margin: 'md', wrap: true },
          { type: 'text', text: '總金額：$' + totalAmount, weight: 'bold', size: 'md', margin: 'md' },
          {
            type: 'button',
            style: 'secondary',
            margin: 'lg',
            height: 'sm',
            action: {
              type: 'postback',
              label: '取消此筆訂單',
              data: 'action=cancel_order&orderId=' + encodeURIComponent(orderId),
            },
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
      pendingDepositDB.delete(userId);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '購物車已清空！輸入「我要點餐」可重新點餐。',
      });
    }

    if (action === 'checkout_time') {
      return sendPickupTimeFlex(event.replyToken, userId);
    }

    if (action === 'select_pickup') {
      const pickupTime = params.get('time') || '15分鐘後';
      return handleDepositCheck(event, userId, pickupTime);
    }

    if (action === 'pay_cash') {
      const pickupTime = params.get('time') || '15分鐘後';
      return finalizeOrder(event, userId, pickupTime, '現場付');
    }

    if (action === 'pay_method') {
      const pickupTime = params.get('time') || '15分鐘後';
      const method = params.get('method') || '銀行轉帳／TWQR';
      const isOver500 = params.get('over500') === '1';
      const { list, totalAmount } = getCartSummary(userId);
      if (!list.length || totalAmount <= 0) {
        return client.replyMessage(event.replyToken, {
          type: 'text',
          text: '您的購物車目前是空的喔！請輸入「我要點餐」選購餐點。',
        });
      }
      return sendTransferOptionsFlex(event.replyToken, pickupTime, totalAmount, method, isOver500);
    }

    if (action === 'ask_last5') {
      const pickupTime = params.get('time') || '15分鐘後';
      const payLabel = params.get('label') || '已轉帳';
      pendingDepositDB.set(userId, { pickupTime, payLabel });
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '請直接輸入您的「轉帳帳號末五碼」（例如：12345），方便店家核對【' + payLabel + '】款項。',
      });
    }

    if (action === 'cancel_order') {
      const cancelId = params.get('orderId') || '';
      const idx = ordersDB.findIndex((o) => o.order_id === cancelId && o.user_id === userId);
      if (idx !== -1) {
        ordersDB.splice(idx, 1);
      }
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '訂單 ' + cancelId + ' 已為您取消！若需重新點餐請輸入「我要點餐」。',
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
      return finalizeOrder(event, userId, pickupTime, payLabel + ' (末五碼：' + userText + ')');
    }

    if (userText === '我要點餐') {
      return sendMenuFlex(event.replyToken);
    }

    if (userText === '購物車') {
      return sendCartFlex(event.replyToken, userId, '目前購物車');
    }

    if (userText === '去結帳' || userText === '結帳') {
      return sendPickupTimeFlex(event.replyToken, userId);
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
        altText: '您的最新訂單',
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: '您的最新訂單', weight: 'bold', size: 'lg', color: '#1DB446' },
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
                  label: '取消此筆訂單',
                  data: 'action=cancel_order&orderId=' + encodeURIComponent(latest.order_id),
                },
              },
            ],
          },
        },
      });
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
});

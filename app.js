async function handleDepositCheck(event, userId, pickupTime) {
  const { totalAmount } = getCartSummary(userId);

  if (totalAmount >= 500) {
    const deposit = Math.ceil(totalAmount * 0.5);
    return client.replyMessage(event.replyToken, {
      type: 'flex',
      altText: '滿 500 元需先付 50% 訂金',
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            { type: 'text', text: '💳 大單訂金提醒', weight: 'bold', size: 'lg', color: '#E63946' },
            {
              type: 'text',
              text:
                '訂單總額 $' +
                totalAmount +
                '（滿 $500）\n請先轉帳 50% 訂金：$' +
                deposit +
                '\n\n🏦 銀行代號：807（永豐）\n帳號：請填入老闆帳號',
              size: 'sm',
              margin: 'md',
              wrap: true,
            },
            {
              type: 'button',
              style: 'primary',
              color: '#FF6B6B',
              margin: 'md',
              action: {
                type: 'postback',
                label: '✅ 我已轉帳 $' + deposit,
                data:
                  'action=confirm_order&time=' +
                  encodeURIComponent(pickupTime) +
                  '&pay=' +
                  encodeURIComponent('已轉一半訂金'),
              },
            },
          ],
        },
      },
    });
  }

  return finalizeOrder(event, userId, pickupTime, '現場付');
}

async function finalizeOrder(event, userId, pickupTime, paymentStatus) {
  const { list, totalAmount, summaryText } = getCartSummary(userId);
  let userName = 'LINE 顧客';
  try {
    const profile = await client.getProfile(userId);
    userName = profile.displayName;
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
        '🔔 新訂單 ' +
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
    type: 'text',
    text:
      '🎉 訂單成立！\n單號：' +
      orderId +
      '\n預計取餐：' +
      pickupTime +
      '\n付款方式：' +
      paymentStatus +
      '\n\n' +
      summaryText +
      '\n總金額：$' +
      totalAmount,
  });
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('Server is running on port ' + port);
});

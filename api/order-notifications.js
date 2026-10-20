const bakerEmail = 'amans66@gmail.com';
const orderIdPattern = /^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/i;

export function createOrderNotificationHandler({
  pool,
  getOrder,
  sendEmail,
  notificationEmail = bakerEmail
}) {
  return async (request, response) => {
    const orderId = request.body?.orderId;
    if (typeof orderId !== 'string' || !orderIdPattern.test(orderId)) {
      return response.status(400).json({ error: 'Order reference is invalid.' });
    }

    try {
      const order = await getOrder(orderId, request.firebaseToken);
      if (!order) return response.status(404).json({ error: 'Order not found or access denied.' });

      const caller = request.firebaseUser;
      const isBaker = caller.email?.toLowerCase() === bakerEmail;
      if (!isBaker && order.customerUid !== caller.uid) {
        return response.status(403).json({ error: 'You are not authorized to notify for this order.' });
      }

      const reservation = await pool.query(
        `INSERT INTO order_email_notifications (order_ref, status, attempts, lock_expires_at)
         VALUES ($1, 'sending', 1, NOW() + INTERVAL '2 minutes')
         ON CONFLICT (order_ref) DO UPDATE
         SET status = 'sending',
             attempts = order_email_notifications.attempts + 1,
             lock_expires_at = NOW() + INTERVAL '2 minutes',
             last_error = NULL,
             updated_at = NOW()
         WHERE order_email_notifications.status = 'failed'
            OR (order_email_notifications.status = 'sending'
                AND order_email_notifications.lock_expires_at < NOW())
         RETURNING order_ref`,
        [orderId]
      );

      if (!reservation.rowCount) {
        const existing = await pool.query(
          'SELECT status FROM order_email_notifications WHERE order_ref = $1',
          [orderId]
        );
        if (existing.rows[0]?.status === 'sent') {
          return response.json({ sent: true, duplicate: true });
        }
        return response.status(202).json({ sent: false, pending: true });
      }

      try {
        const messageId = await sendEmail(order, orderId, notificationEmail);
        await pool.query(
          `UPDATE order_email_notifications
           SET status = 'sent', message_id = $2, lock_expires_at = NULL,
               sent_at = NOW(), updated_at = NOW()
           WHERE order_ref = $1`,
          [orderId, messageId || null]
        );
        return response.json({ sent: true });
      } catch (emailError) {
        await pool.query(
          `UPDATE order_email_notifications
           SET status = 'failed', last_error = $2, lock_expires_at = NULL, updated_at = NOW()
           WHERE order_ref = $1`,
          [orderId, String(emailError.message || emailError).slice(0, 1000)]
        );
        console.error('Could not send baker order notification:', emailError.message || emailError);
        return response.status(502).json({ error: 'The order was saved, but the baker email could not be sent.' });
      }
    } catch (error) {
      console.error('Could not process baker order notification:', error.message || error);
      return response.status(502).json({ error: 'Could not verify the order or process its email notification.' });
    }
  };
}

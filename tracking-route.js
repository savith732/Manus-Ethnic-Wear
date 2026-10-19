module.exports = function registerTracking(app, dbQuery) {
  app.get('/api/orders/track', async (req, res) => {
    try {
      const orderId = String(req.query.orderId || '').trim().toUpperCase();
      const provided = String(req.query.contact || '').replace(/\D/g, '');

      if (!orderId || !provided) {
        return res.status(400).json({ error: 'Order ID and phone number are required.' });
      }

      const orders = await dbQuery(
        'SELECT id, customer_name, phone, total, status, created_at FROM orders WHERE id = $1',
        [orderId]
      );
      const order = orders[0];

      if (!order || String(order.phone || '').replace(/\D/g, '') !== provided) {
        return res.status(404).json({ error: 'Order not found. Check your details and try again.' });
      }

      order.items = await dbQuery(
        'SELECT product_name, price, qty, size FROM order_items WHERE order_id = $1 ORDER BY id',
        [order.id]
      );

      res.json({ order });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not track order.' });
    }
  });
};

const { Resend } = require('resend');

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY||'re_JAXqTr8L_K8UtSat6ZBSD7GM2nHAMB3Ey');

// Send order confirmation email
const sendOrderConfirmationEmail = async (email, orderData, customerName) => {
  try {
    const { data, error } = await resend.emails.send({
      from: process.env.FROM_EMAIL || 'Premium Quality Foods <noreply@premiumqualityfoods.com>',
      to: [email],
      subject: 'Order Confirmation - Premium Quality Foods',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Order Confirmation - Premium Quality Foods</title>
          <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
          <style>
            body {
              margin: 0;
              padding: 10px 0;
              font-family: 'Open Sans', 'HelveticaNeue-Light', 'Helvetica Neue Light', 'Helvetica Neue', Helvetica, Arial, 'Lucida Grande', sans-serif;
              background-color: #f6f9fc;
            }
            .container {
              max-width: 37.5em;
              margin: 0 auto;
              background-color: #ffffff;
              border: 1px solid #f0f0f0;
              padding: 45px;
            }
            .header {
              text-align: center;
              margin-bottom: 40px;
            }
            .logo {
              width: 200px;
              margin: 0 auto 20px;
              display: block;
            }
            .order-number {
              background: #00B4D8;
              color: #ffffff;
              font-size: 24px;
              font-weight: 600;
              padding: 16px 40px;
              border-radius: 8px;
              display: inline-block;
              margin: 20px 0;
            }
            .order-details {
              background: #f8f9fa;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
            }
            .item {
              display: flex;
              justify-content: space-between;
              margin: 10px 0;
              padding: 10px 0;
              border-bottom: 1px solid #e9ecef;
            }
            .total {
              font-weight: 600;
              font-size: 18px;
              color: #28a745;
            }
            .status {
              display: inline-block;
              padding: 8px 16px;
              border-radius: 20px;
              font-weight: 600;
              font-size: 14px;
            }
            .status.pending {
              background: #fff3cd;
              color: #856404;
            }
            .status.shipped {
              background: #cce5ff;
              color: #004085;
            }
            .status.delivered {
              background: #d4edda;
              color: #155724;
            }
            .footer {
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #e9ecef;
              text-align: center;
              color: #6c757d;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="color: #00B4D8; margin-bottom: 10px;">Premium Quality Foods</h1>
              <p style="color: #6c757d; margin: 0;">Thank you for your order!</p>
            </div>
            
            <div>
              <p style="font-size: 18px; font-weight: 500; margin: 20px 0; line-height: 28px; color: #404040;">
                Hi ${customerName || 'there'},
              </p>
              
              <p style="font-size: 16px; font-weight: 300; color: #404040; line-height: 26px; margin: 16px 0;">
                Thank you for placing your order with Premium Quality Foods. We're excited to prepare your fresh, high-quality products!
              </p>
              
              <div style="text-align: center; margin: 30px 0;">
                <div class="order-number">Order #${String(orderData.orderId).slice(-8)}</div>
              </div>
              
              <div class="order-details">
                <h3 style="margin-top: 0; color: #404040;">Order Details</h3>
                <div class="item">
                  <span>Order Type:</span>
                  <span style="text-transform: capitalize;">${orderData.orderType}</span>
                </div>
                <div class="item">
                  <span>Payment Method:</span>
                  <span style="text-transform: capitalize;">${orderData.paymentMethod}</span>
                </div>
                <div class="item">
                  <span>Payment Status:</span>
                  <span class="status ${orderData.paymentStatus === 'paid' ? 'delivered' : 'pending'}">
${orderData.paymentStatus === 'paid' ? 'Paid' : 'Pending'}
                  </span>
                </div>
                <div class="item">
                  <span>Tracking Number:</span>
                  <span style="font-weight: 600;">${orderData.trackingNumber}</span>
                </div>
                ${orderData.shippingAddress ? `
                <div style="margin-top: 20px;">
                  <h4 style="margin-bottom: 10px; color: #404040;">Shipping Address</h4>
                  <p style="margin: 5px 0; color: #6c757d;">
                    ${orderData.shippingAddress.address}<br>
                    ${orderData.shippingAddress.city}, ${orderData.shippingAddress.state} ${orderData.shippingAddress.postalCode}
                  </p>
                </div>
                ` : ''}
                
                ${orderData.deliveryTimeSlot && orderData.deliveryDate ? `
                <div style="margin-top: 20px;">
                  <h4 style="margin-bottom: 10px; color: #404040;">Delivery Time</h4>
                  <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; border-left: 4px solid #2196f3;">
                    <p style="margin: 5px 0; color: #1976d2; font-weight: 600;">
                      ${new Date(orderData.deliveryDate).toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      })}
                    </p>
                    <p style="margin: 5px 0; color: #1976d2; font-weight: 600;">
                      ${(() => {
                        const timeSlots = {
                          '9-12': '9:00 AM - 12:00 PM',
                          '12-3': '12:00 PM - 3:00 PM',
                          '3-6': '3:00 PM - 6:00 PM',
                          '6-9': '6:00 PM - 9:00 PM'
                        };
                        return timeSlots[orderData.deliveryTimeSlot] || orderData.deliveryTimeSlot;
                      })()}
                    </p>
                    <p style="margin: 5px 0; color: #1976d2; font-size: 14px;">
                      We'll deliver your order during this time window
                    </p>
                  </div>
                </div>
                ` : ''}
              </div>
              
              <div style="margin: 30px 0;">
                <h3 style="color: #404040;">Order Items</h3>
                ${orderData.orderItems.map(item => `
                  <div class="item">
                    <span>${item.name} x${item.quantity}</span>
                    <span>${(item.price * item.quantity).toFixed(2)} AED</span>
                  </div>
                `).join('')}
                <div class="item total">
                  <span>Total:</span>
                  <span>${orderData.totalPrice.toFixed(2)} AED</span>
                </div>
              </div>
              
              <p style="font-size: 16px; font-weight: 300; color: #404040; line-height: 26px; margin: 16px 0;">
                We'll keep you updated on your order status. You can track your order using the tracking number above.
              </p>
              
              <p style="font-size: 16px; font-weight: 300; color: #404040; line-height: 26px; margin: 16px 0;">
                ${orderData.deliveryTimeSlot && orderData.deliveryDate ? 
                  `Your order will be delivered on ${new Date(orderData.deliveryDate).toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    month: 'long', 
                    day: 'numeric' 
                  })} during your selected time slot.` : 
                  orderData.orderType === 'pickup' ? 'Ready for pickup' : 'Estimated delivery: 3-5 business days'
                }
              </p>
              
              <p style="font-size: 16px; font-weight: 300; color: #404040; line-height: 26px; margin: 16px 0;">
                If you have any questions, please contact us at 
                <a href="mailto:support@premiumqualityfoods.com" style="color: #00B4D8; text-decoration: underline;">
                  support@premiumqualityfoods.com
                </a>.
              </p>
              
              <p style="font-size: 16px; font-weight: 300; color: #404040; line-height: 26px; margin: 16px 0;">
                Thank you for choosing Premium Quality Foods!
              </p>
            </div>
            
            <div class="footer">
              <p style="margin: 0;">Premium Quality Foods Team</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('Error sending order confirmation email:', error);
      return false;
    }

    console.log('Order confirmation email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error in sendOrderConfirmationEmail:', error);
    return false;
  }
};

// Send order status update email
const sendOrderStatusUpdateEmail = async (email, orderData, customerName, newStatus, previousStatus) => {
  try {
    const statusMessages = {
      'pending': 'Your order is being processed',
      'confirmed': 'Your order has been confirmed',
      'preparing': 'Your order is being prepared',
      'shipped': 'Your order has been shipped',
      'out_for_delivery': 'Your order is out for delivery',
      'delivered': 'Your order has been delivered',
      'cancelled': 'Your order has been cancelled'
    };

    const statusColors = {
      'pending': '#ffc107',
      'confirmed': '#17a2b8',
      'preparing': '#007bff',
      'shipped': '#28a745',
      'out_for_delivery': '#fd7e14',
      'delivered': '#28a745',
      'cancelled': '#dc3545'
    };

    const { data, error } = await resend.emails.send({
      from: process.env.FROM_EMAIL || 'Premium Quality Foods <noreply@premiumqualityfoods.com>',
      to: [email],
      subject: `Order Status Update - ${statusMessages[newStatus] || newStatus}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Order Status Update - Premium Quality Foods</title>
          <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
          <style>
            body {
              margin: 0;
              padding: 10px 0;
              font-family: 'Open Sans', 'HelveticaNeue-Light', 'Helvetica Neue Light', 'Helvetica Neue', Helvetica, Arial, 'Lucida Grande', sans-serif;
              background-color: #f6f9fc;
            }
            .container {
              max-width: 37.5em;
              margin: 0 auto;
              background-color: #ffffff;
              border: 1px solid #f0f0f0;
              padding: 45px;
            }
            .header {
              text-align: center;
              margin-bottom: 40px;
            }
            .status-badge {
              display: inline-block;
              padding: 12px 24px;
              border-radius: 25px;
              font-weight: 600;
              font-size: 16px;
              color: #ffffff;
              margin: 20px 0;
            }
            .order-details {
              background: #f8f9fa;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
            }
            .timeline {
              margin: 30px 0;
            }
            .timeline-item {
              display: flex;
              align-items: center;
              margin: 15px 0;
              padding: 10px;
              border-radius: 8px;
            }
            .timeline-item.completed {
              background: #d4edda;
              color: #155724;
            }
            .timeline-item.current {
              background: #cce5ff;
              color: #004085;
            }
            .timeline-item.pending {
              background: #f8f9fa;
              color: #6c757d;
            }
            .timeline-dot {
              width: 12px;
              height: 12px;
              border-radius: 50%;
              margin-right: 15px;
            }
            .timeline-dot.completed {
              background: #28a745;
            }
            .timeline-dot.current {
              background: #007bff;
            }
            .timeline-dot.pending {
              background: #6c757d;
            }
            .footer {
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #e9ecef;
              text-align: center;
              color: #6c757d;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="color: #00B4D8; margin-bottom: 10px;">Premium Quality Foods</h1>
              <p style="color: #6c757d; margin: 0;">Order Status Update</p>
            </div>
            
            <div>
              <p style="font-size: 18px; font-weight: 500; margin: 20px 0; line-height: 28px; color: #404040;">
                Hi ${customerName || 'there'},
              </p>
              
              <p style="font-size: 16px; font-weight: 300; color: #404040; line-height: 26px; margin: 16px 0;">
                Your order status has been updated!
              </p>
              
              <div style="text-align: center;">
                <div class="status-badge" style="background-color: ${statusColors[newStatus] || '#6c757d'}">
                  ${statusMessages[newStatus] || newStatus}
                </div>
              </div>
              
              <div class="order-details">
                <h3 style="margin-top: 0; color: #404040;">Order Information</h3>
                <div style="margin: 10px 0;">
                  <strong>Order Number:</strong> #${String(orderData.orderId).slice(-8)}
                </div>
                <div style="margin: 10px 0;">
                  <strong>Tracking Number:</strong> ${orderData.trackingNumber}
                </div>
                <div style="margin: 10px 0;">
                  <strong>Order Type:</strong> ${orderData.orderType}
                </div>
                <div style="margin: 10px 0;">
                  <strong>Total Amount:</strong> ${orderData.totalPrice.toFixed(2)} AED
                </div>
              </div>
              
              <div class="timeline">
                <h3 style="color: #404040;">Order Timeline</h3>
                <div class="timeline-item ${['pending', 'confirmed', 'preparing', 'shipped', 'out_for_delivery', 'delivered'].includes(newStatus) ? 'completed' : 'pending'}">
                  <div class="timeline-dot ${['pending', 'confirmed', 'preparing', 'shipped', 'out_for_delivery', 'delivered'].includes(newStatus) ? 'completed' : 'pending'}"></div>
                  <span>Order Placed</span>
                </div>
                <div class="timeline-item ${['confirmed', 'preparing', 'shipped', 'out_for_delivery', 'delivered'].includes(newStatus) ? 'completed' : 'pending'}">
                  <div class="timeline-dot ${['confirmed', 'preparing', 'shipped', 'out_for_delivery', 'delivered'].includes(newStatus) ? 'completed' : 'pending'}"></div>
                  <span>Order Confirmed</span>
                </div>
                <div class="timeline-item ${['preparing', 'shipped', 'out_for_delivery', 'delivered'].includes(newStatus) ? 'completed' : 'pending'}">
                  <div class="timeline-dot ${['preparing', 'shipped', 'out_for_delivery', 'delivered'].includes(newStatus) ? 'completed' : 'pending'}"></div>
                  <span>Preparing Order</span>
                </div>
                <div class="timeline-item ${['shipped', 'out_for_delivery', 'delivered'].includes(newStatus) ? 'completed' : 'pending'}">
                  <div class="timeline-dot ${['shipped', 'out_for_delivery', 'delivered'].includes(newStatus) ? 'completed' : 'pending'}"></div>
                  <span>Order Shipped</span>
                </div>
                <div class="timeline-item ${['out_for_delivery', 'delivered'].includes(newStatus) ? 'completed' : 'pending'}">
                  <div class="timeline-dot ${['out_for_delivery', 'delivered'].includes(newStatus) ? 'completed' : 'pending'}"></div>
                  <span>Out for Delivery</span>
                </div>
                <div class="timeline-item ${newStatus === 'delivered' ? 'completed' : 'pending'}">
                  <div class="timeline-dot ${newStatus === 'delivered' ? 'completed' : 'pending'}"></div>
                  <span>Delivered</span>
                </div>
              </div>
              
              <p style="font-size: 16px; font-weight: 300; color: #404040; line-height: 26px; margin: 16px 0;">
                ${newStatus === 'delivered' ? 
                  'Your order has been successfully delivered! We hope you enjoy your Premium Quality Foods products.' :
                  'We\'ll continue to keep you updated on your order progress.'
                }
              </p>
              
              <p style="font-size: 16px; font-weight: 300; color: #404040; line-height: 26px; margin: 16px 0;">
                If you have any questions, please contact us at 
                <a href="mailto:support@premiumqualityfoods.com" style="color: #00B4D8; text-decoration: underline;">
                  support@premiumqualityfoods.com
                </a>.
              </p>
            </div>
            
            <div class="footer">
              <p style="margin: 0;">Premium Quality Foods Team</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('Error sending status update email:', error);
      return false;
    }

    console.log('Status update email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Error in sendOrderStatusUpdateEmail:', error);
    return false;
  }
};

module.exports = {
  sendOrderConfirmationEmail,
  sendOrderStatusUpdateEmail
}; 
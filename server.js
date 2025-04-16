const express = require("express");
const session = require("express-session");
const path = require("path");
const axios = require("axios");
require("dotenv").config();
const MongoStore = require("connect-mongo");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cookieParser());
// Enable CORS for all origins for simplicity (adjust as needed)
app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, "public")));
// Session configuration
// Production session configuration for same-origin deployment
app.use(
  session({
    secret: process.env.SECRET_KEY,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: "sessions",
      ttl: 24 * 60 * 60, // Match cookie maxAge
      autoRemove: "interval",
      autoRemoveInterval: 60,
    }),
    cookie: {
      secure: true, // Required for Render's HTTPS
      httpOnly: true,
      sameSite: "lax",
      domain: "https://restaurant-chatbot-6mu4.onrender.com/",
      maxAge: 24 * 60 * 60 * 1000,
    },
    proxy: true, // Required for Render's proxy
  })
);

// Session initialization middleware
app.use((req, res, next) => {
  if (!req.session.initialized) {
    req.session.initialized = true;
    req.session.state = "main";
    req.session.currentOrder = [];
    req.session.orderHistory = [];
    console.log(`New session initialized: ${req.sessionID}`);
  }
  next();
});

// Force session save after each request
app.use((req, res, next) => {
  res.on("finish", async () => {
    try {
      await new Promise((resolve, reject) => {
        req.session.save((err) => {
          if (err) {
            console.error("Session save error:", err);
            reject(err);
          } else {
            console.log("Session persisted:", req.sessionID);
            resolve();
          }
        });
      });
    } catch (err) {
      console.error("Final session save failed:", err);
    }
  });
  next();
});

// Define menu items
const menuItems = [
  { id: 1, name: "Jollof Rice", price: 1500 },
  { id: 2, name: "Fried Chicken", price: 2000 },
  { id: 3, name: "Pounded Yam", price: 2500 },
];

const formatCurrency = (amount) => `₦${amount.toLocaleString()}`;

// Handle main state
function handleMainState(input, session, response) {
  switch (input) {
    case "1":
      session.state = "ordering";
      response.messages.push(
        { text: "Menu Items:", type: "bot" },
        ...menuItems.map((item) => ({
          text: `${item.id}. ${item.name} - ${formatCurrency(item.price)}`,
          type: "bot",
        })),
        {
          text: 'Enter item numbers (1-3) or type "done" to finish',
          type: "bot",
        }
      );
      break;
    case "99":
      if (session.currentOrder.length === 0) {
        response.messages.push({ text: "No order to place", type: "bot" });
      } else {
        const total = session.currentOrder.reduce(
          (sum, item) => sum + item.price,
          0
        );
        session.orderHistory.push([...session.currentOrder]);
        session.currentOrder = [];
        session.state = "main";
        response.messages.push({
          text: `Order placed! Total: ${formatCurrency(
            total
          )}. Proceed to payment`,
          type: "bot",
          payment: true,
        });
      }
      break;

    case "98":
      if (session.orderHistory.length === 0) {
        response.messages.push({
          text: "No order history available",
          type: "bot",
        });
      } else {
        response.messages.push({ text: "Order History:", type: "bot" });
        session.orderHistory.forEach((order, index) => {
          const total = order.reduce((sum, item) => sum + item.price, 0);
          response.messages.push({
            text: `Order #${index + 1}: ${order
              .map((i) => i.name)
              .join(", ")} - Total: ${formatCurrency(total)}`,
            type: "bot",
          });
        });
      }
      break;
    case "97":
      if (session.currentOrder.length === 0) {
        response.messages.push({ text: "No current order", type: "bot" });
      } else {
        const total = session.currentOrder.reduce(
          (sum, item) => sum + item.price,
          0
        );
        response.messages.push({
          text: `Current Order: ${session.currentOrder
            .map((i) => i.name)
            .join(", ")} - Total: ${formatCurrency(total)}`,
          type: "bot",
        });
      }
      break;
    case "0":
      session.currentOrder = [];
      response.messages.push({
        text: "Order cancelled successfully",
        type: "bot",
      });
      break;
    default:
      response.messages.push({
        text: "Please choose a valid option:\n1. Place Order\n99. Checkout\n98. Order History\n97. Current Order\n0. Cancel",
        type: "bot",
      });
  }
}

// Handle ordering state
async function handleOrderingState(input, session, response) {
  const item = menuItems.find((i) => i.id.toString() === input);
  if (input.toLowerCase() === "done") {
    session.state = "main";
    response.messages.push({
      text: "Returning to main menu:\n1. Place Order\n99. Checkout\n98. Order History\n97. Current Order\n0. Cancel",
      type: "bot",
    });
  } else if (item) {
    session.currentOrder.push(item);
    const total = session.currentOrder.reduce(
      (sum, item) => sum + item.price,
      0
    );
    response.messages.push(
      { text: `${item.name} added!`, type: "bot" },
      {
        text:
          `Current Order (${session.currentOrder.length} items):\n` +
          session.currentOrder
            .map((i) => `- ${i.name} (₦${i.price})`)
            .join("\n") +
          `\nTotal: ${formatCurrency(total)}`,
        type: "bot",
      },
      { text: 'Add more items (1-3) or type "done" to finish', type: "bot" }
    );
  } else {
    response.messages.push({
      text: "Invalid selection. Try again or type 'done'.",
      type: "bot",
    });
  }
}

// Chat endpoint: processes user messages
app.post("/message", async (req, res) => {
  console.log("Session ID:", req.sessionID);
  console.log("Session state:", req.session.state);
  console.log("Current order:", req.session.currentOrder);

  const userInput = req.body.message.trim();
  const response = { messages: [] };

  try {
    switch (req.session.state) {
      case "main":
        handleMainState(userInput, req.session, response);
        break;
      case "ordering":
        await handleOrderingState(userInput, req.session, response);
        break;
      default:
        req.session.state = "main";
        response.messages.push({ text: "Resetting session", type: "bot" });
    }
    req.session.save(() => res.json(response));
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      messages: [{ text: "System error. Please try again.", type: "bot" }],
    });
  }
});

// Payment initiation endpoint
// server.js - Payment Endpoints

app.post("/initiate-payment", async (req, res) => {
  try {
    if (!req.session.currentOrder?.length) {
      return res.status(400).json({
        error: "No items in current order",
      });
    }

    // Calculate amount properly
    const amount =
      req.session.currentOrder.reduce((sum, item) => sum + item.price, 0) * 100; // Convert to kobo

    const paymentData = {
      amount: amount,
      email: "customer@example.com",
      callback_url: `${process.env.PAYSTACK_CALLBACK_URL}/?sessionId=${req.sessionID}`,
      metadata: {
        sessionId: req.sessionID,
        ip: req.ip,
      },
    };
    // Force session save with extended TTL
    req.session.cookie.maxAge = 48 * 60 * 60 * 1000; // 48 hours
    await req.session.save();

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      paymentData,
      {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      }
    );

    res.json({
      authorization_url: response.data.data.authorization_url,
      sessionId: req.sessionID,
    });
  } catch (error) {
    console.error("Payment initiation error:", error);
    res.status(500).json({ error: "Payment initialization failed" });
  }
});

app.get("/payment-callback", async (req, res) => {
  try {
    const { sessionId } = req.query;

    // Rebuild session from storage
    req.sessionStore.get(sessionId, async (err, session) => {
      if (err || !session) {
        return res.redirect("/?error=session_expired");
      }

      // Verify payment with Paystack
      const verification = await axios.get(
        `https://api.paystack.co/transaction/verify/${req.query.trxref}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          },
        }
      );

      if (verification.data.data.status === "success") {
        // Regenerate session to prevent fixation
        req.session.regenerate(async (err) => {
          Object.assign(req.session, {
            ...session,
            payment: {
              status: "completed",
              reference: verification.data.data.reference,
              amount: verification.data.data.amount,
            },
          });

          await req.session.save();

          // Set fresh cookies in response
          res.setHeader("Set-Cookie", [
            `connect.sid=${
              req.sessionID
            }; Path=/; Secure; SameSite=None; HttpOnly; Max-Age=${
              24 * 60 * 60
            }`,
          ]);

          res.redirect("/?payment=success");
        });
      } else {
        res.redirect("/?payment=failed");
      }
    });
  } catch (error) {
    console.error("Callback error:", error);
    res.redirect("/?payment=error");
  }
});

// Payment initialization (using Paystack)
/*app.post("/initiate-payment", async (req, res) => {
  try {
    const paystackRes = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        amount: req.body.amount * 100, // Convert to kobo
        email: "customer@example.com",
        callback_url: process.env.PAYSTACK_CALLBACK_UR,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    res.json({ authorization_url: paystackRes.data.data.authorization_url });
  } catch (error) {
    console.error("Payment error:", error);
    res.status(500).json({ error: "Payment initialization failed" });
  }
});

// Payment callback: handles redirection after payment
app.get("/payment-callback", (req, res) => {
  res.redirect("/");
});
*/

// Start the server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

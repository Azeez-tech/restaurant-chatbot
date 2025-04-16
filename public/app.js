const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");

// Initial bot greeting
addMessage(
  `Bot: Welcome! Please choose an option:<br>
   1. Place Order<br>
   99. Checkout<br>
   98. Order History<br>
   97. Current Order<br>
   0. Cancel Order`,
  "bot"
);

// Send message on form submission
async function sendMessage() {
  const message = userInput.value.trim();
  if (!message) return;

  addMessage(`You: ${message}`, "user");
  userInput.value = "";

  try {
    const response = await fetch("/message", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    });

    const data = await response.json();
    data.messages.forEach((msg) => {
      addMessage(`Bot: ${msg.text}`, "bot");
      if (msg.payment) {
        initiatePayment();
      }
    });
  } catch (error) {
    console.error("Error:", error);
    addMessage(
      "Bot: Session expired or an error occurred. Please refresh the page.",
      "bot"
    );
  }
}

// Append message to chat window
function addMessage(text, type) {
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${type}-message`;
  messageDiv.innerHTML = text.replace(/\n/g, "<br>");
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Initiate payment if required
async function initiatePayment() {
  try {
    const response = await fetch("/initiate-payment", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 1000 }),
    });
    const data = await response.json();
    window.location.href = data.authorization_url;
  } catch (error) {
    console.error("Payment error:", error);
    addMessage("Bot: Payment initialization failed", "bot");
  }
}

async function checkPaymentStatus() {
  try {
    const response = await fetch("/payment-status", {
      credentials: "include",
    });

    const result = await response.json();

    if (result.paid) {
      addMessage(
        "Bot: Payment successful! Your order is being processed",
        "bot"
      );
      localStorage.removeItem("paymentSession");
    } else {
      addMessage(
        "Bot: Payment verification failed. Please contact support",
        "bot"
      );
    }

    // Force session refresh
    window.location.reload();
  } catch (error) {
    console.error("Status check error:", error);
  }
}

// Add payment status endpoint
app.get("/payment-status", (req, res) => {
  res.json({
    paid: !!req.session?.payment?.status,
  });
});

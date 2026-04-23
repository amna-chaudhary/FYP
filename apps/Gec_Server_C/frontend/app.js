const chat = document.getElementById("chat");
const inputBox = document.getElementById("inputBox");
const sendBtn = document.getElementById("sendBtn");

const BACKEND_URL = "http://localhost:8000"; // FastAPI backend (the one we made in backend/app.py)
const CHAT_ENDPOINT = `${BACKEND_URL}/chat`;

function addMessage(text, who="assistant") {
  const div = document.createElement("div");
  div.className = "msg " + (who==="user" ? "user": "assistant");
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.innerText = who === "user" ? "🫵" : "🤖";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerText = text;
  div.appendChild(avatar);
  div.appendChild(bubble);
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

sendBtn.addEventListener("click", sendMessage);
inputBox.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

async function sendMessage(){
  const text = inputBox.value.trim();
  if(!text) return;
  // add user message
  addMessage(text, "user");
  inputBox.value = "";
  // show a temporary "typing..."
  addMessage("Processing...", "assistant");
  // send to backend
  try {
    const resp = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({message: text})
    });
    const data = await resp.json();
    // remove last "Processing..." assistant message
    const msgs = chat.querySelectorAll(".msg.assistant");
    if (msgs.length) {
      const last = msgs[msgs.length-1];
      if (last.querySelector(".bubble").innerText === "Processing...") {
        last.remove();
      }
    }

    if (data.success && data.reply) {
      if (data.reply.type === "answer") {
        addMessage(data.reply.text || "No answer.", "assistant");
      } else if (data.reply.type === "mcp_result") {
        addMessage("Action performed. Response: " + JSON.stringify(data.reply.mcp_response), "assistant");
      } else {
        addMessage(JSON.stringify(data.reply), "assistant");
      }
    } else {
      addMessage("Error: Unexpected response from server.", "assistant");
    }
  } catch (err) {
    // remove processing and show error
    const msgs = chat.querySelectorAll(".msg.assistant");
    if (msgs.length) msgs[msgs.length-1].remove();
    addMessage("Error contacting backend: " + err.message, "assistant");
    console.error(err);
  }
}

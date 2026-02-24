"use strict";

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fetch = require("node-fetch");
const path = require("path");

// ── Config ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const GATEWAY = process.env.PANDO_GATEWAY_URL || "https://gateway-one-mu.vercel.app";
const PROJECT_KEY = process.env.PROJECT_API_KEY || "eddbe32406dd003ba9ee45bb46dacf8df9fd97e31637368c119c17da93022c51";

// ── Poll definitions ─────────────────────────────────────────────────────────
const POLLS = [
  {
    id: "p1",
    question: "What is your favorite programming language?",
    options: [
      { id: "a", label: "JavaScript" },
      { id: "b", label: "Python" },
      { id: "c", label: "Rust" },
      { id: "d", label: "Go" }
    ]
  },
  {
    id: "p2",
    question: "How do you prefer to work?",
    options: [
      { id: "a", label: "Fully remote" },
      { id: "b", label: "Hybrid" },
      { id: "c", label: "In office" }
    ]
  },
  {
    id: "p3",
    question: "What matters most in software?",
    options: [
      { id: "a", label: "Performance" },
      { id: "b", label: "Developer experience" },
      { id: "c", label: "Reliability" },
      { id: "d", label: "Security" }
    ]
  }
];

const POLL_IDS = POLLS.map(p => p.id);

// ── Resource Proxy helper ─────────────────────────────────────────────────────
async function dbOp(operation, collection, params = {}) {
  const res = await fetch(`${GATEWAY}/api/resource-proxy/db`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Project-Key": PROJECT_KEY
    },
    body: JSON.stringify({ collection, operation, ...params })
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Resource Proxy error ${res.status}: ${JSON.stringify(json)}`);
  }
  return json.data;
}

// ── Tally helper ──────────────────────────────────────────────────────────────
async function getTally(pollId) {
  const votes = await dbOp("find", "votes", { filter: { pollId }, limit: 1000 });
  const tally = {};
  if (Array.isArray(votes)) {
    for (const vote of votes) {
      tally[vote.optionId] = (tally[vote.optionId] || 0) + 1;
    }
  }
  return tally;
}

async function getAllTallies() {
  const tallies = {};
  for (const pollId of POLL_IDS) {
    tallies[pollId] = await getTally(pollId);
  }
  return tallies;
}

// ── Express + HTTP + WebSocket setup ─────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// REST: poll definitions
app.get("/polls", (_req, res) => {
  res.json(POLLS);
});

// REST: health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", clients: wss ? wss.clients.size : 0 });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ── WebSocket logic ───────────────────────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

wss.on("connection", async (ws) => {
  console.log(`[ws] client connected (total: ${wss.clients.size})`);

  // Send current tallies to the new client so they're in sync immediately
  try {
    const tallies = await getAllTallies();
    for (const pollId of POLL_IDS) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "update",
          pollId,
          tally: tallies[pollId] || {}
        }));
      }
    }
  } catch (err) {
    console.error("[ws] error sending initial tallies:", err.message);
  }

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    if (msg.type === "vote") {
      const { pollId, optionId } = msg;

      // Validate input
      const poll = POLLS.find(p => p.id === pollId);
      if (!poll) {
        ws.send(JSON.stringify({ type: "error", message: `Unknown pollId: ${pollId}` }));
        return;
      }
      const option = poll.options.find(o => o.id === optionId);
      if (!option) {
        ws.send(JSON.stringify({ type: "error", message: `Unknown optionId: ${optionId} for poll ${pollId}` }));
        return;
      }

      try {
        // 1. Save vote
        await dbOp("insertOne", "votes", {
          document: { pollId, optionId, timestamp: new Date().toISOString() }
        });

        // 2. Compute updated tally
        const tally = await getTally(pollId);

        // 3. Broadcast to all clients
        broadcast({ type: "update", pollId, tally });

        console.log(`[vote] poll=${pollId} option=${optionId} tally=`, tally);
      } catch (err) {
        console.error("[vote] error:", err.message);
        ws.send(JSON.stringify({ type: "error", message: "Failed to record vote. Please try again." }));
      }
    }
  });

  ws.on("close", () => {
    console.log(`[ws] client disconnected (total: ${wss.clients.size})`);
  });

  ws.on("error", (err) => {
    console.error("[ws] socket error:", err.message);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
  console.log(`[server] gateway: ${GATEWAY}`);
});

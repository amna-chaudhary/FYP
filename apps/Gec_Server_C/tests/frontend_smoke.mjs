import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const APP_ROOT = new URL("../", import.meta.url);
const FRONTEND_DIR = new URL("../frontend/", import.meta.url);
const BACKEND_PORT = "8010";
const FRONTEND_PORT = "4175";

function startProcess(command, args, cwd) {
  const child = spawn(command, args, {
    cwd: new URL(cwd).pathname,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitForUrl(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const backend = startProcess("python3", ["-m", "uvicorn", "backend.app:app", "--host", "127.0.0.1", "--port", BACKEND_PORT], APP_ROOT);
  const frontend = startProcess("python3", ["-m", "http.server", FRONTEND_PORT, "--bind", "127.0.0.1"], FRONTEND_DIR);

  const shutdown = () => {
    backend.kill("SIGTERM");
    frontend.kill("SIGTERM");
  };

  process.on("exit", shutdown);
  process.on("SIGINT", () => {
    shutdown();
    process.exit(1);
  });

  try {
    await waitForUrl(`http://127.0.0.1:${BACKEND_PORT}/`);
    await waitForUrl(`http://127.0.0.1:${FRONTEND_PORT}/index.html`);

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.addInitScript((port) => {
      window.localStorage.setItem("gec_frontend_api_base", `http://127.0.0.1:${port}`);
    }, BACKEND_PORT);

    await page.goto(`http://127.0.0.1:${FRONTEND_PORT}/index.html`);
    await page.fill("#did", "did:example:alice");
    await page.fill("#accountAddress", "0xabc123");
    await page.fill("#displayName", "Alice");
    await page.fill("#walletLabel", "Browser Wallet");
    await page.click("#login-submit");
    await page.waitForSelector("#login-session-card:not(.hidden)");

    await page.click("text=Continue to chat");
    await page.waitForURL("**/chat.html");
    await page.fill("#chat-input", "hello");
    await page.click("button[type='submit']");
    await page.waitForSelector(".chat-bubble.agent");

    await page.click("text=Registry");
    await page.waitForURL("**/registry.html");
    await page.waitForSelector("#registry-list");

    await page.click("text=Marketplace");
    await page.waitForURL("**/marketplace.html");
    await page.waitForSelector("#marketplace-list");

    await page.click("#notification-toggle");
    await page.waitForSelector("#notification-panel:not(.hidden)");

    await browser.close();
    shutdown();
    process.exit(0);
  } catch (error) {
    shutdown();
    console.error(error);
    process.exit(1);
  }
}

main();

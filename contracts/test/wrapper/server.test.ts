import { expect } from "chai";
import { startServer } from "../../../wrapper/src/server";
import { StubModelBackend } from "../../../wrapper/src/modelBackend";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

async function withTempModelFile(bytes = 1024): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cascade-wrapper-test-"));
  const filePath = path.join(dir, "model.bin");
  await fs.promises.writeFile(filePath, Buffer.alloc(bytes, 1));
  return filePath;
}

describe("wrapper HTTP server", () => {
  it("refuses to start against a backend that has not completed a verified load", () => {
    const backend = new StubModelBackend();
    expect(() => startServer(backend, 0)).to.throw(/before the model backend finished a verified load/);
  });

  it("serves a chat completion once the backend is loaded, and only on the OpenAI-compatible route", async () => {
    const backend = new StubModelBackend();
    await backend.load(await withTempModelFile());
    const server = startServer(backend, 0);
    const port = (server.address() as { port: number }).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "hello" }] }),
      });
      expect(res.status).to.equal(200);
      const body = await res.json();
      expect(body.object).to.equal("chat.completion");
      expect(body.choices[0].message.content).to.include("hello");

      const notFound = await fetch(`http://127.0.0.1:${port}/v1/completions`, { method: "POST" });
      expect(notFound.status).to.equal(404);
    } finally {
      server.close();
    }
  });

  it("rejects malformed JSON without crashing the server", async () => {
    const backend = new StubModelBackend();
    await backend.load(await withTempModelFile());
    const server = startServer(backend, 0);
    const port = (server.address() as { port: number }).port;

    try {
      const bad = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      });
      expect(bad.status).to.equal(400);

      const stillAlive = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "test", messages: [] }),
      });
      expect(stillAlive.status).to.equal(200);
    } finally {
      server.close();
    }
  });

  it("rejects an oversized body", async () => {
    const backend = new StubModelBackend();
    await backend.load(await withTempModelFile());
    const server = startServer(backend, 0);
    const port = (server.address() as { port: number }).port;

    try {
      const huge = "x".repeat(2 * 1024 * 1024);
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: huge,
      });
      expect(res.status).to.equal(413);
    } finally {
      server.close();
    }
  });
});

describe("wrapper StubModelBackend", () => {
  it("fails closed on a missing model file", async () => {
    const backend = new StubModelBackend();
    let threw = false;
    try {
      await backend.load("/definitely/does/not/exist.bin");
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    expect(backend.ready).to.equal(false);
  });

  it("fails closed on an empty model file", async () => {
    const backend = new StubModelBackend();
    const filePath = await withTempModelFile(0);
    let threw = false;
    try {
      await backend.load(filePath);
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    expect(backend.ready).to.equal(false);
  });

  it("refuses to serve before a successful load", async () => {
    const backend = new StubModelBackend();
    let threw = false;
    try {
      await backend.complete({ model: "x", messages: [] });
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
  });
});

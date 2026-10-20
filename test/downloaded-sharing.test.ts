import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DownloadedSharing, parseByteRange } from "../src/downloaded/lan-server.js";
import type { AppContext } from "../src/core/server/context.js";

test("byte ranges handle seeking, suffixes, bounds, and invalid ranges", () => {
  assert.deepEqual(parseByteRange("bytes=2-4", 10), { start: 2, end: 4 });
  assert.deepEqual(parseByteRange("bytes=2-", 10), { start: 2, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange("bytes=0-100", 10), { start: 0, end: 9 });
  for (const value of ["bytes=10-", "bytes=4-2", "bytes=-0", "bytes=0-1,3-4", "bytes=-", "bytes=99999999999999999999-"]) assert.equal(parseByteRange(value, 10), null);
  assert.equal(parseByteRange("bytes=0-", 0), null);
});

async function unusedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}

test("LAN library authenticates, isolates desktop APIs, streams known files, and stops", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prnlb-sharing-"));
  fs.writeFileSync(path.join(root, "movie.mp4"), "0123456789");
  fs.mkdirSync(path.join(root, ".images"));
  fs.writeFileSync(path.join(root, ".images", "cover.jpg"), "cover");
  fs.writeFileSync(path.join(root, "secret.jpg"), "secret");
  fs.symlinkSync(path.join(root, "secret.jpg"), path.join(root, ".images", "escape.jpg"));
  const item = { id: 1, fileName: "movie.mp4", filePath: path.join(root, "movie.mp4"), title: "Title", cachedImage: "cover.jpg" };
  const app = { staticDir: path.resolve("public"), getDownloadedStore: () => ({ getAll: () => [item], getAllTags: () => [], getById: (id: number) => id === 1 ? item : undefined }), getActressStore: () => ({ getAll: () => [] }) } as unknown as AppContext;
  const sharing = new DownloadedSharing(app);
  const port = await unusedPort();
  const key = "x";
  const origin = `http://127.0.0.1:${port}`;
  const headers = { Authorization: `Basic ${Buffer.from(`viewer:${key}`).toString("base64")}` };
  // Credential changes close server connections; avoid reusing a socket being closed.
  function sharingFetch(url: string, init?: RequestInit): Promise<Response> {
    const requestHeaders = new Headers(init?.headers);
    requestHeaders.set("Connection", "close");
    return fetch(url, { ...init, headers: requestHeaders });
  }
  try {
    await sharing.configure({ enabled: true, port, username: "viewer", accessKey: key });
    assert.equal(sharing.status().running, true);
    assert.equal((await sharingFetch(origin + "/library")).status, 401);
    const landing = await sharingFetch(origin + "/", { redirect: "manual" });
    assert.equal(landing.status, 303);
    assert.equal(landing.headers.get("location"), "/login");
    assert.equal(landing.headers.get("www-authenticate"), null);
    const loginPage = await sharingFetch(origin + "/login");
    assert.equal(loginPage.status, 200);
    assert.equal(loginPage.headers.get("referrer-policy"), "same-origin");
    const html = await loginPage.text();
    assert.match(html, /method="post" action="\/login"/);
    assert.match(html, /name="username"/);
    assert.match(html, /name="password" type="password"/);
    assert.equal((await sharingFetch(origin + "/sharing.css")).status, 200);
    async function signIn(password: string, originHeader?: string) {
      return sharingFetch(origin + "/login", {
        method: "POST", redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...(originHeader ? { Origin: originHeader } : {}) },
        body: new URLSearchParams({ username: "viewer", password }),
      });
    }
    const rejected = await signIn("wrong");
    assert.equal(rejected.status, 401);
    assert.match(await rejected.text(), /Incorrect username or password/);
    assert.equal(rejected.headers.get("set-cookie"), null);
    const invalidOrigin = await signIn(key, "http://other.example");
    assert.equal(invalidOrigin.status, 403);
    assert.match(await invalidOrigin.text(), /class="login-error"[^>]*>Sign-in was blocked/);
    assert.equal((await signIn(key, "null")).status, 403);
    const signedIn = await signIn(key, origin);
    assert.equal(signedIn.status, 303);
    const checkPath = signedIn.headers.get("location")!;
    assert.match(checkPath, /^\/login\?check=\d+\.[a-f0-9]{32}\.[a-f0-9]{64}$/);
    const setCookie = signedIn.headers.get("set-cookie")!;
    assert.match(setCookie, /HttpOnly; SameSite=Lax; Max-Age=43200; Expires=/);
    const sessionHeaders = { Cookie: setCookie.split(";")[0] };
    const cookieCheck = await sharingFetch(origin + checkPath, { headers: sessionHeaders, redirect: "manual" });
    assert.equal(cookieCheck.status, 303);
    assert.equal(cookieCheck.headers.get("location"), "/");
    const missingCookie = await sharingFetch(origin + checkPath, { redirect: "manual" });
    assert.equal(missingCookie.status, 303);
    const sessionRoot = missingCookie.headers.get("location")!;
    assert.match(sessionRoot, /^\/session\/[^/]+\/$/);
    const cookieFreePage = await sharingFetch(origin + sessionRoot);
    assert.equal(cookieFreePage.status, 200);
    assert.equal(cookieFreePage.headers.get("referrer-policy"), "no-referrer");
    for (const endpoint of ["sharing.js", "sharing.css", "library?q=Title", "filters", "items/1/image"]) {
      assert.equal((await sharingFetch(origin + sessionRoot + endpoint)).status, 200);
    }
    const cookieFreeVideo = await sharingFetch(origin + sessionRoot + "items/1/file", { headers: { Range: "bytes=2-4" } });
    assert.equal(cookieFreeVideo.status, 206);
    assert.equal(await cookieFreeVideo.text(), "234");
    for (const endpoint of ["api/config", "mcp"]) assert.equal((await sharingFetch(origin + sessionRoot + endpoint)).status, 404);
    assert.equal((await sharingFetch(origin + sessionRoot + "items/1/file", { method: "DELETE" })).status, 405);
    const token = new URL(checkPath, origin).searchParams.get("check")!;
    for (const bad of [token + "x", token.replace(/^\d+/, "1")]) {
      const rejectedSession = await sharingFetch(origin + `/session/${bad}/`);
      assert.equal(rejectedSession.status, 401);
      assert.match(await rejectedSession.text(), /sign-in has expired/);
    }
    const invalidCheck = await sharingFetch(origin + "/login?check=invalid");
    assert.equal(invalidCheck.status, 200);
    assert.match(await invalidCheck.text(), /sign-in has expired/);
    assert.equal((await sharingFetch(origin + "/", { headers: sessionHeaders })).status, 200);
    assert.equal((await sharingFetch(origin + "/library", { headers: sessionHeaders })).status, 200);
    assert.equal(await (await sharingFetch(origin + "/items/1/image", { headers: sessionHeaders })).text(), "cover");
    const sessionVideo = await sharingFetch(origin + "/items/1/file", { headers: { ...sessionHeaders, Range: "bytes=2-4" } });
    assert.equal(sessionVideo.status, 206);
    assert.equal(await sessionVideo.text(), "234");
    for (const cookie of [sessionHeaders.Cookie + "x", sessionHeaders.Cookie.replace(/=\d+/, "=1")]) {
      assert.equal((await sharingFetch(origin + "/library", { headers: { Cookie: cookie } })).status, 401);
    }
    await sharing.configure({ enabled: true, port, username: "changed-viewer", accessKey: key });
    assert.equal((await sharingFetch(origin + sessionRoot + "library")).status, 401);
    assert.equal((await sharingFetch(origin + "/library", { headers: sessionHeaders })).status, 401);
    await sharing.configure({ enabled: true, port, username: "viewer", accessKey: key });
    assert.equal((await sharingFetch(origin + "/library", { headers: sessionHeaders })).status, 401);

    assert.equal((await sharingFetch(origin + "/", { headers })).status, 200);
    const listing = await (await sharingFetch(origin + "/library", { headers })).json();
    assert.equal(listing[0].title, "Title");
    assert.equal(listing[0].filePath, undefined);
    for (const endpoint of ["/api/config", "/mcp", "/api/downloaded", "/items/2/file", "/items/1/../../secret.jpg"]) assert.equal((await sharingFetch(origin + endpoint, { headers })).status, 404);
    assert.equal((await sharingFetch(origin + "/items/1/file", { method: "DELETE", headers })).status, 405);
    const partial = await sharingFetch(origin + "/items/1/file", { headers: { ...headers, Range: "bytes=2-4" } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), "bytes 2-4/10");
    assert.equal(await partial.text(), "234");
    const head = await sharingFetch(origin + "/items/1/file", { method: "HEAD", headers });
    assert.equal(head.headers.get("content-length"), "10");
    assert.equal(await head.text(), "");
    assert.equal((await sharingFetch(origin + "/items/1/file", { headers: { ...headers, Range: "bytes=50-" } })).status, 416);
    const download = await sharingFetch(origin + "/items/1/file?download", { headers });
    assert.match(download.headers.get("content-disposition")!, /attachment/);
    assert.equal(await download.text(), "0123456789");
    assert.equal(await (await sharingFetch(origin + "/items/1/image", { headers })).text(), "cover");
    item.cachedImage = "escape.jpg";
    assert.equal((await sharingFetch(origin + "/items/1/image", { headers })).status, 404);
    await sharing.configure({ enabled: true, port, username: "another-viewer", accessKey: "p" });
    assert.equal((await sharingFetch(origin + "/library", { headers })).status, 401);
    await sharing.configure({ enabled: false, port });
    assert.equal(sharing.status().running, false);
    assert.deepEqual(sharing.status().urls, []);
  } finally { sharing.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

import test from "node:test";
import assert from "node:assert/strict";

function createRequest(url: string, init?: RequestInit) {
  return new Request(url, init);
}

test("assertLocalBrowserRequest allows same-origin localhost GET requests", async () => {
  const { assertLocalBrowserRequest } = await import("./security/request-guard.ts");

  assert.doesNotThrow(() =>
    assertLocalBrowserRequest(
      createRequest("http://localhost:3000/api/settings/llm-profiles", {
        headers: {
          "sec-fetch-site": "same-origin",
        },
      }),
    ),
  );
});

test("assertLocalBrowserRequest allows same-origin localhost POST requests", async () => {
  const { assertLocalBrowserRequest } = await import("./security/request-guard.ts");

  assert.doesNotThrow(() =>
    assertLocalBrowserRequest(
      createRequest("http://127.0.0.1:3000/api/settings/llm-profiles/save", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3000",
          "sec-fetch-site": "same-origin",
        },
      }),
    ),
  );
});

test("assertLocalBrowserRequest rejects cross-site or origin-less write requests", async () => {
  const { assertLocalBrowserRequest } = await import("./security/request-guard.ts");

  assert.throws(
    () =>
      assertLocalBrowserRequest(
        createRequest("http://localhost:3000/api/settings/llm-profiles/save", {
          method: "POST",
          headers: {
            "sec-fetch-site": "same-origin",
          },
        }),
      ),
    /Origin|同源/,
  );

  assert.throws(
    () =>
      assertLocalBrowserRequest(
        createRequest("http://localhost:3000/api/settings/llm-profiles", {
          headers: {
            origin: "https://evil.example",
            "sec-fetch-site": "cross-site",
          },
        }),
      ),
    /Origin|同源/,
  );
});

test("assertLocalBrowserRequest rejects non-local hosts", async () => {
  const { assertLocalBrowserRequest } = await import("./security/request-guard.ts");

  assert.throws(
    () =>
      assertLocalBrowserRequest(
        createRequest("https://example.com/api/files/read?projectId=demo&relativePath=chapter.md", {
          headers: {
            origin: "https://example.com",
            "sec-fetch-site": "same-origin",
          },
        }),
      ),
    /本地|localhost/,
  );
});

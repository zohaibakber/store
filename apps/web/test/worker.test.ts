import { describe, expect, it } from "vitest";

import { handleApiProxy } from "../worker";

describe("handleApiProxy", () => {
  it("forwards the request to the API service binding", async () => {
    const request = new Request("https://example.com/api/health");
    const api = {
      fetch: (input: Request) => {
        expect(input).toBe(request);
        return new Response("ok", { status: 200 });
      },
    };

    const response = await handleApiProxy(request, api);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });
});

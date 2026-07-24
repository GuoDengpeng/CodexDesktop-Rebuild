const test = require("node:test");
const assert = require("node:assert/strict");

const { withRetry } = require("./fetch-msstore");

test("临时请求失败后会重试并返回结果", async () => {
  let attempts = 0;

  const result = await withRetry(
    async () => {
      attempts++;
      if (attempts < 3) throw new Error("Request timeout");
      return "ok";
    },
    { maxAttempts: 3, retryDelayMs: 0 }
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("请求持续失败时达到次数上限后抛出最后一个错误", async () => {
  let attempts = 0;

  await assert.rejects(
    withRetry(
      async () => {
        attempts++;
        throw new Error(`failure-${attempts}`);
      },
      { maxAttempts: 3, retryDelayMs: 0 }
    ),
    /failure-3/
  );

  assert.equal(attempts, 3);
});

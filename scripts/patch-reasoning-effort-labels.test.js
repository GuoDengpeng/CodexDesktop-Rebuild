const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TRANSLATIONS,
  patchSource,
} = require("./patch-reasoning-effort-labels");

function createLocaleSource(overrides = {}) {
  const translations = { ...TRANSLATIONS, ...overrides };
  const entries = Object.keys(TRANSLATIONS).map(
    (messageId) => `"${messageId}":\`${translations[messageId]}\``,
  );
  return `const messages={${entries.join(",")}};export{messages as default};`;
}

test("为全部推理强度补充实际参数并说明 Ultra", () => {
  const source = createLocaleSource({
    "composer.mode.local.reasoning.low.label": "轻度",
    "composer.mode.local.reasoning.ultra.label": "极高",
    "composer.modelPicker.power.ultraUsageWarning": "更快消耗使用额度",
  });

  const result = patchSource(source);

  assert.equal(result.status, "patched");
  for (const [messageId, translation] of Object.entries(TRANSLATIONS)) {
    assert.match(result.source, new RegExp(`"${messageId.replaceAll(".", "\\.")}":\`${translation}\``));
  }
});

test("重复执行不会再次修改语言包", () => {
  const source = createLocaleSource();
  const result = patchSource(source);

  assert.equal(result.status, "already-patched");
  assert.equal(result.source, source);
});

test("关键消息缺失时失败，避免静默产生不完整补丁", () => {
  const source = createLocaleSource().replace(
    /"composer\.mode\.local\.reasoning\.max\.label":`[^`]*`,?/,
    "",
  );
  const result = patchSource(source);

  assert.equal(result.status, "unexpected-entry-count");
  assert.deepEqual(result.invalidEntries, [
    {
      messageId: "composer.mode.local.reasoning.max.label",
      count: 0,
    },
  ]);
});

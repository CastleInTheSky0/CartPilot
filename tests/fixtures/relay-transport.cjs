const { ChildProcess } = require("node:child_process");
const childProcess = require("node:child_process");
const { setDefaultResultOrder } = require("node:dns");
const { mock } = require("node:test");

// 模拟 IPv6 优先的主机，只截获 Chrome 启动，不修改官方中继或握手协议。
setDefaultResultOrder("ipv6first");
process.env.PLAYWRIGHT_MCP_EXECUTABLE_PATH = process.execPath;
for (const key of [
  "PLAYWRIGHT_MCP_EXTENSION_TOKEN",
  "PLAYWRIGHT_MCP_PROFILE_DIR_NAME",
  "PWTEST_EXTENSION_USER_DATA_DIR",
  "DUO_EXTENSION_PROFILE",
]) {
  delete process.env[key];
}
mock.method(childProcess, "spawn", (_executable, args) => {
  const authorizationUrl = args.find((value) => value.startsWith("chrome-extension://"));
  const endpoint = new URL(authorizationUrl).searchParams.get("mcpRelayUrl");
  process.send({ type: "endpoint", endpoint });
  return new ChildProcess();
});
require(process.argv[2]);

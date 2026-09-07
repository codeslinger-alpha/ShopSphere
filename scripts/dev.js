const { spawn } = require("node:child_process");
const children = ["server", "client"].map((workspace) =>
  spawn("npm", ["run", "dev", "--workspace", workspace], { stdio: "inherit" }),
);
function stop() {
  children.forEach((child) => child.kill("SIGTERM"));
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
children.forEach((child) =>
  child.on("exit", (code) => {
    if (code) {
      process.exitCode = code;
      stop();
    }
  }),
);

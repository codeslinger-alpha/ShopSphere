const { spawn } = require("node:child_process");

// Each workspace is started as its own process group. npm does not pass a signal
// on to the dev server it launches: signalling `npm run dev` kills npm and leaves
// vite and `node --watch` running, still holding ports 5000 and 5173 with nothing
// left to stop them. A group can be signalled as a whole, which reaches the
// grandchild processes npm would otherwise orphan.
const children = ["server", "client"].map((workspace) =>
  spawn("npm", ["run", "dev", "--workspace", workspace], {
    stdio: "inherit",
    detached: true,
  }),
);

function stop() {
  children.forEach((child) => {
    try {
      // A negative pid signals the entire process group rather than npm alone.
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // The group is already gone; there is nothing to clean up.
    }
  });
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// SIGHUP is what the kernel sends when the terminal window closes. Unhandled it
// terminates this process before stop() runs, orphaning both groups. Ctrl+C was
// always fine, because that is SIGINT; only closing the window leaked.
process.on("SIGHUP", stop);

children.forEach((child) =>
  child.on("exit", (code) => {
    if (code) {
      process.exitCode = code;
      stop();
    }
  }),
);

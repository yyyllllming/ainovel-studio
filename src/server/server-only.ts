const shouldSkipServerOnly =
  process.argv.includes("--test")
  || process.argv.some((arg) => /content[\\/]+eval-baseline\.ts$/u.test(arg))
  || Boolean(process.env.NODE_TEST_CONTEXT)
  || process.env.AINOVEL_SKIP_SERVER_ONLY === "1";

if (!shouldSkipServerOnly) {
  void import("server-only");
}

export {};

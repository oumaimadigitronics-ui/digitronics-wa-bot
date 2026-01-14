import { createApp } from "./app.js";
import { loadConfig, warnMissingConfig } from "./config.js";
import { createLogger } from "./logging.js";
import { loadMetaConfig } from "./meta.js";

export function initializeServerContext({ env, argv, entryFile }) {
  const meta = loadMetaConfig(env);
  const config = loadConfig({ env, argv, entryFile });
  const { logger, debugLog } = createLogger({ logDebug: config.LOG_DEBUG });

  warnMissingConfig({
    requireEnv: config.REQUIRE_ENV,
    openAiKey: config.OPENAI_API_KEY,
    wcBase: config.CFG.wcBase,
    wcKey: config.CFG.wcKey,
    wcSecret: config.CFG.wcSecret,
  });

  return {
    app: createApp(),
    logger,
    debugLog,
    ...meta,
    ...config,
  };
}

export function loadMetaConfig(env) {
  const envVars = env || process.env;
  const {
    META_VERIFY_TOKEN = "",
    META_PAGE_ACCESS_TOKEN = "",
    META_APP_SECRET = "",
    META_GRAPH_VERSION = "v21.0",
  } = envVars;

  return {
    META_VERIFY_TOKEN,
    META_PAGE_ACCESS_TOKEN,
    META_APP_SECRET,
    META_GRAPH_VERSION,
  };
}

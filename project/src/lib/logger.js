export const logger = {
  debug: (...args) => { if (process.env.LOG_DEBUG === 'true') console.debug(...args); },
  info: (...args) => console.info(...args),
  error: (...args) => console.error(...args),
};

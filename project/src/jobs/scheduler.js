export function startScheduledJobs(cfg, services) {
  const { offersService } = services;
  
  if (cfg.OFFERS_REFRESH_MS && cfg.OFFERS_REFRESH_MS > 0) {
    console.log(`✅ Offers refresh: every ${cfg.OFFERS_REFRESH_MS}ms`);
    
    // Initial refresh
    offersService?.refresh?.().catch(err => {
      console.error('[Scheduler] Initial offers refresh failed:', {
        error: err.message,
        stack: err.stack,
        timestamp: new Date().toISOString()
      });
    });
    
    // Periodic refresh
    setInterval(async () => {
      try {
        await offersService?.refresh?.();
      } catch (err) {
        console.error('[Scheduler] Periodic offers refresh failed:', {
          error: err.message,
          stack: err.stack,
          timestamp: new Date().toISOString()
        });
      }
    }, cfg.OFFERS_REFRESH_MS);
  }
}

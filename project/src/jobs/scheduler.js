export function startScheduledJobs(cfg, services) {
  const { offersService } = services;
  
  if (cfg.OFFERS_REFRESH_MS && cfg.OFFERS_REFRESH_MS > 0) {
    console.log(`✅ Offers refresh: every ${cfg.OFFERS_REFRESH_MS}ms`);
    
    // Initial refresh
    offersService?.refresh?.().catch(err => {
      console.error('Initial offers refresh failed:', err);
    });
    
    // Periodic refresh
    setInterval(async () => {
      try {
        await offersService?.refresh?.();
      } catch (err) {
        console.error('Offers refresh failed:', err);
      }
    }, cfg.OFFERS_REFRESH_MS);
  }
}

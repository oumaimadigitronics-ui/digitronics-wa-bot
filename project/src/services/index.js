import { MemoryStore } from '../stores/memoryStore.js';
import { buildOffersIndex } from './offers/offersIndex.js';
import { OffersService } from './offers/offersService.js';
import { BotService } from './bot/botService.js';

export function buildServices(cfg) {
  const memoryStore = new MemoryStore({
    ttlHours: cfg.MEMORY_TTL_HOURS,
    maxMessages: cfg.MEMORY_MAX_MESSAGES,
    maxConversations: 5000,
    persist: cfg.MEMORY_PERSIST,
    dir: cfg.MEMORY_DIR,
  });

  const offersService = new OffersService();
  const offersIndex = buildOffersIndex({});
  const botService = new BotService({ memoryStore, offersIndex, cfg });

  return { memoryStore, offersService, offersIndex, botService };
}

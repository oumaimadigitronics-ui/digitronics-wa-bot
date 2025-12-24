import { enforceReplyPolicy } from '../../domain/replyPolicy.js';

export class BotService {
  constructor({ memoryStore, offersIndex, cfg }) {
    this.memoryStore = memoryStore;
    this.offersIndex = offersIndex;
    this.cfg = cfg;
  }

  async handleNotification(body = {}, context = {}) {
    const reply = body.reply || 'ok';
    const offersByModel = new Map(Object.entries(this.offersIndex?.modelLookup || {}));
    const safeReply = enforceReplyPolicy(reply, {
      offersByModel,
      allowUrls: false,
      isPhotoFlow: Boolean(body?.photoFlow),
      maxChars: this.cfg?.MAX_WA_REPLY_CHARS,
    });
    this.memoryStore?.appendMessage?.(body.conversationId || 'unknown', { text: safeReply, ts: Date.now() });
    return { ok: true, reply: safeReply, requestId: context.requestId };
  }
}

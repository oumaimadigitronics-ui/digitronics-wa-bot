export class OffersService {
  constructor() {
    this.status = { ok: true };
  }

  async refresh() {
    this.status = { ok: true, refreshedAt: Date.now() };
  }

  async getStatus() {
    return this.status;
  }
}

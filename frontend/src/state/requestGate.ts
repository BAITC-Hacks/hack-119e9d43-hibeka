/** Guards even APIs that fail to honor AbortSignal. */
export class RequestGate {
  private controller: AbortController | null = null;
  start() {
    this.cancel();
    const controller = new AbortController();
    this.controller = controller;
    return {
      signal: controller.signal,
      isCurrent: () =>
        this.controller === controller && !controller.signal.aborted,
    };
  }
  cancel() {
    this.controller?.abort();
    this.controller = null;
  }
}

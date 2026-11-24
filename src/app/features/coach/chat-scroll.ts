/**
 * Keeps the newest chat content in view without fighting the reader (WCAG 2.2 AA, `prefers-reduced-motion`).
 * Follows while the reader is near the bottom, pauses once they scroll up, and resumes when they return or send.
 */

/** How close to the bottom (px) still counts as "reading the latest message". */
export const NEAR_BOTTOM_PX = 120;
/** Scroll events fired by our own smooth scroll must not be mistaken for the reader scrolling away. */
const SMOOTH_SCROLL_GUARD_MS = 800;
const INSTANT_SCROLL_GUARD_MS = 100;

export class ChatScroll {
  private following = true;
  private ignoreScrollUntil = 0;

  constructor(
    private readonly win: Window,
    private readonly target: () => HTMLElement | null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get isFollowing(): boolean {
    return this.following;
  }

  /** Window `scroll` handler: only a reader-driven scroll can pause or resume following. */
  onScroll(): void {
    if (this.now() < this.ignoreScrollUntil) {
      return;
    }
    const doc = this.win.document.documentElement;
    const distance = doc.scrollHeight - (this.win.scrollY + this.win.innerHeight);
    this.following = distance <= NEAR_BOTTOM_PX;
  }

  /**
   * Brings the end of the conversation (through the composer) into view. `force` is for the reader's own actions
   * (sending, opening the page); otherwise it only scrolls when they are already following the thread.
   * Scrolling never moves keyboard focus.
   */
  scrollToLatest(options: { force?: boolean; instant?: boolean } = {}): void {
    if (options.force) {
      this.following = true;
    }
    if (!this.following) {
      return;
    }
    const reduceMotion = this.win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const instant = options.instant === true || reduceMotion;
    this.ignoreScrollUntil = this.now() + (instant ? INSTANT_SCROLL_GUARD_MS : SMOOTH_SCROLL_GUARD_MS);
    this.target()?.scrollIntoView?.({ block: 'end', behavior: instant ? 'auto' : 'smooth' });
  }
}

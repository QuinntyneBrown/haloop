// Acceptance Test
// Traces to: L2-012, L2-030, WCAG 2.2 AA (prefers-reduced-motion)
// Description: Verify the Coach conversation follows new content while the reader is near the bottom, pauses when
// they scroll up, resumes when they return or send, honours reduced motion, and never moves keyboard focus.

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChromeAiService } from '../../core/ai/chrome-ai.service';
import { HaloopDbService } from '../../core/storage/haloop-db.service';
import { ChatScroll, NEAR_BOTTOM_PX } from './chat-scroll';
import { CoachPageComponent } from './coach-page.component';

function fakeWindow(options: { scrollHeight: number; scrollY: number; innerHeight: number; reduceMotion?: boolean }) {
  return {
    document: { documentElement: { scrollHeight: options.scrollHeight } },
    scrollY: options.scrollY,
    innerHeight: options.innerHeight,
    matchMedia: () => ({ matches: options.reduceMotion ?? false }),
  } as unknown as Window;
}

describe('ChatScroll', () => {
  function setup(win: Window, clock = { t: 0 }) {
    const target = { scrollIntoView: vi.fn() } as unknown as HTMLElement;
    const scroll = new ChatScroll(win, () => target, () => clock.t);
    return { scroll, target, clock, spy: target.scrollIntoView as ReturnType<typeof vi.fn> };
  }

  it('scrolls the end of the thread into view smoothly while following (L2-012)', () => {
    const { scroll, spy } = setup(fakeWindow({ scrollHeight: 2000, scrollY: 1200, innerHeight: 800 }));
    scroll.scrollToLatest();
    expect(spy).toHaveBeenCalledWith({ block: 'end', behavior: 'smooth' });
  });

  it('uses an instant scroll when reduced motion is preferred (WCAG 2.3.3)', () => {
    const { scroll, spy } = setup(fakeWindow({ scrollHeight: 2000, scrollY: 1200, innerHeight: 800, reduceMotion: true }));
    scroll.scrollToLatest();
    expect(spy).toHaveBeenCalledWith({ block: 'end', behavior: 'auto' });
  });

  it('uses an instant scroll when asked, e.g. when history first loads (L2-012)', () => {
    const { scroll, spy } = setup(fakeWindow({ scrollHeight: 2000, scrollY: 0, innerHeight: 800 }));
    scroll.scrollToLatest({ force: true, instant: true });
    expect(spy).toHaveBeenCalledWith({ block: 'end', behavior: 'auto' });
  });

  it('pauses when the reader scrolls up, and resumes when they return near the bottom (L2-012)', () => {
    const win = fakeWindow({ scrollHeight: 2000, scrollY: 1200, innerHeight: 800 });
    const { scroll, spy, clock } = setup(win);
    clock.t = 5000;

    (win as { scrollY: number }).scrollY = 300; // far above the bottom
    scroll.onScroll();
    expect(scroll.isFollowing).toBe(false);
    scroll.scrollToLatest();
    expect(spy).not.toHaveBeenCalled();

    (win as { scrollY: number }).scrollY = 1200 - NEAR_BOTTOM_PX + 10; // back near the bottom
    scroll.onScroll();
    expect(scroll.isFollowing).toBe(true);
    scroll.scrollToLatest();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('resumes when the reader sends a message even after scrolling up (L2-012)', () => {
    const win = fakeWindow({ scrollHeight: 2000, scrollY: 100, innerHeight: 800 });
    const { scroll, spy, clock } = setup(win);
    clock.t = 5000;
    scroll.onScroll();
    expect(scroll.isFollowing).toBe(false);

    scroll.scrollToLatest({ force: true });

    expect(scroll.isFollowing).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not mistake its own smooth-scroll events for the reader scrolling away (L2-012)', () => {
    const win = fakeWindow({ scrollHeight: 2000, scrollY: 100, innerHeight: 800 });
    const { scroll, clock } = setup(win);
    clock.t = 1000;
    scroll.scrollToLatest({ force: true });

    clock.t = 1300; // mid-animation: the window is still far from the bottom
    scroll.onScroll();
    expect(scroll.isFollowing).toBe(true);

    clock.t = 3000; // animation over: a real scroll position counts again
    scroll.onScroll();
    expect(scroll.isFollowing).toBe(false);
  });

  it('is safe when the composer is not rendered or scrollIntoView is missing (L2-030)', () => {
    const scroll = new ChatScroll(fakeWindow({ scrollHeight: 1, scrollY: 0, innerHeight: 1 }), () => null);
    expect(() => scroll.scrollToLatest({ force: true })).not.toThrow();
    const bare = new ChatScroll(fakeWindow({ scrollHeight: 1, scrollY: 0, innerHeight: 1 }), () => ({}) as HTMLElement);
    expect(() => bare.scrollToLatest({ force: true })).not.toThrow();
  });
});

describe('Coach conversation scrolling', () => {
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
  });

  function render(promptCoach: ChromeAiService['promptCoach'], history: unknown = null) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ChromeAiService, useValue: { promptCoach, resetPromptSession: () => undefined } },
        { provide: HaloopDbService, useValue: { get: async () => history, set: async () => undefined } },
      ],
    });
    const fixture = TestBed.createComponent(CoachPageComponent);
    const host = fixture.nativeElement as HTMLElement;
    document.body.append(host);
    fixture.detectChanges();
    return { fixture, host };
  }

  it('opens scrolled to the most recent message, instantly (L2-012)', async () => {
    render(async () => ({ text: '', reflection: '', engine: 'x' }));
    await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end', behavior: 'auto' }));
  });

  it('scrolls to the new message when sending and follows the reply without taking focus (L2-012)', async () => {
    let finish: (v: { text: string; reflection: string; engine: string }) => void = () => undefined;
    let stream: (t: string) => void = () => undefined;
    const { fixture, host } = render((_p, onChunk) => {
      stream = onChunk ?? stream;
      return new Promise((resolve) => (finish = resolve));
    });
    await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    scrollIntoView.mockClear();

    const input = host.querySelector<HTMLInputElement>('[data-testid="coach-prompt-input"]')!;
    input.focus();
    input.value = 'Pace my run';
    input.dispatchEvent(new Event('input'));
    host.querySelector('form.chat-composer')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end', behavior: 'smooth' }));
    expect(host.textContent).toContain('Generating on-device…');

    scrollIntoView.mockClear();
    stream('Keep it');
    fixture.detectChanges();
    await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled());

    scrollIntoView.mockClear();
    finish({ text: 'Keep it easy.', reflection: 'r', engine: 'Haloop Coach · Test' });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(host.textContent).toContain('Keep it easy.');
    });
    await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    // Scrolling only ever moves the viewport; the composer keeps whatever focus it had.
    expect(document.activeElement === input || document.activeElement === document.body).toBe(true);
    host.remove();
  });

  it('stops following streamed tokens after the reader scrolls up (L2-012)', async () => {
    let stream: (t: string) => void = () => undefined;
    const { fixture, host } = render((_p, onChunk) => {
      stream = onChunk ?? stream;
      return new Promise(() => undefined);
    });
    await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    const input = host.querySelector<HTMLInputElement>('[data-testid="coach-prompt-input"]')!;
    input.value = 'Pace my run';
    input.dispatchEvent(new Event('input'));
    host.querySelector('form.chat-composer')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled());

    // The reader scrolls up well above the bottom once our own scroll has settled.
    await new Promise((resolve) => setTimeout(resolve, 900));
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 });
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 3000 });
    window.dispatchEvent(new Event('scroll'));

    scrollIntoView.mockClear();
    stream('Still reading earlier messages');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scrollIntoView).not.toHaveBeenCalled();
    host.remove();
  });
});

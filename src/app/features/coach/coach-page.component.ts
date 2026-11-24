import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ChromeAiService } from '../../core/ai/chrome-ai.service';
import { ScriptureService, VerseSearchResult } from '../../core/scripture/scripture.service';
import { PreferencesStore } from '../../core/state/preferences.store';
import { HaloopDbService } from '../../core/storage/haloop-db.service';
import { LIGHT_LOAD_WARM_UP, WorkoutPlanStore } from '../../core/state/workout-plan.store';
import { ChatScroll } from './chat-scroll';

interface CoachMessage {
  readonly id: string;
  readonly sender: 'user' | 'coach';
  readonly author: string;
  readonly time: string;
  readonly text: string;
  readonly reflection?: string;
  readonly showActions?: boolean;
}

const DEFAULT_THREAD: readonly CoachMessage[] = [
  {
    id: 'm1',
    sender: 'user',
    author: 'Micah',
    time: '07:08',
    text: 'My calves are still tight from Thursday’s tempo run. Should I swap goblet squats today or keep them light?',
  },
  {
    id: 'm2',
    sender: 'coach',
    author: 'Haloop Coach · Gemini Nano',
    time: '07:08',
    text: 'Keep goblet squats, drop the load by 20%, and elevate your heels on a folded mat for the first set. Add 90 seconds of slow ankle rocks before set one.',
    reflection: 'For your warm-up reflection: Isaiah 40:31 — strength is renewed in patience, not rushing through soreness.',
    showActions: true,
  },
];

@Component({
  selector: 'app-coach-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:scroll)': 'chatScroll.onScroll()' },
  imports: [FormsModule, RouterLink],
  template: `
    <div class="cluster cluster--between">
      <p class="text-muted">Powered by Chrome Gemini Nano Prompt API · KJV verse index cached (23 MB)</p>
      <div class="cluster">
        <span class="badge badge--success">On-device · Private</span>
        <button
          type="button"
          class="btn btn--sm btn--pill"
          (click)="openVerseSearch()"
          data-testid="coach-open-verse-search"
        >
          <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          Search Scripture
        </button>
      </div>
    </div>

    @if (!historyLoaded()) {
      <div class="stack" role="status" aria-busy="true" aria-label="Loading conversation" data-testid="coach-loading">
        <div class="card stack stack--sm">
          <span class="skeleton skeleton--text" style="width:30%;"></span>
          <span class="skeleton skeleton--text" style="width:85%;"></span>
        </div>
        <div class="card stack stack--sm">
          <span class="skeleton skeleton--text" style="width:35%;"></span>
          <span class="skeleton skeleton--text" style="width:92%;"></span>
          <span class="skeleton skeleton--text" style="width:60%;"></span>
        </div>
      </div>
    } @else if (sessionInterrupted()) {
      <section class="empty" role="alert">
        <h2 class="empty__title">Gemini Nano session interrupted</h2>
        <p class="empty__text">
          Chrome recycled the Prompt API context after the tab was idle. Download the local Qwen2.5-0.5B fallback or
          restart the session.
        </p>
        <div class="empty__actions">
          <button type="button" class="btn btn--primary btn--pill" (click)="restartSession()">Restart session</button>
          <a class="btn btn--pill" routerLink="/lab">Open AI Lab</a>
        </div>
      </section>
    } @else if (messages().length === 0) {
      <section class="empty">
        <h2 class="empty__title">Ask your on-device Coach</h2>
        <p class="empty__text">
          Plan a workout around soreness, check form cues, or search KJV Scripture for today’s reflection—all processed
          locally in Chrome.
        </p>
        <div class="empty__actions">
          <button type="button" class="btn btn--primary btn--pill" (click)="seedStarterPrompt()">
            Start a conversation
          </button>
          <button type="button" class="btn btn--pill" (click)="openVerseSearch()">Search Scripture</button>
        </div>
      </section>
    } @else {
      <section class="chat-thread" aria-label="Coach conversation" aria-live="polite">
        @for (msg of messages(); track msg.id) {
          <article class="chat-msg" [class.chat-msg--user]="msg.sender === 'user'">
            <div class="chat-msg__meta">
              @if (msg.sender === 'coach') {
                <span class="status-dot status-dot--halo" aria-hidden="true"></span>
              }
              <span>{{ msg.author }}</span>
              <span>·</span>
              <span>{{ msg.time }}</span>
            </div>
            <p>{{ msg.text }}</p>
            @if (msg.reflection) {
              <p class="text-sm text-muted">{{ msg.reflection }}</p>
            }
            @if (msg.showActions) {
              <div class="cluster" style="margin-top:var(--space-1);">
                <button
                  type="button"
                  class="btn btn--sm btn--pill"
                  (click)="applyWarmUp()"
                  data-testid="coach-apply-warmup"
                >
                  Apply light-load warm-up
                </button>
                <button type="button" class="btn btn--sm btn--ghost" (click)="openVerseSearch()">
                  Translate verse
                </button>
              </div>
            }
          </article>
        }
        @if (submitting()) {
          <article class="chat-msg" role="status">
            <div class="chat-msg__meta">
              <span class="status-dot status-dot--halo" aria-hidden="true"></span>
              <span>Haloop Coach</span>
            </div>
            @if (streamingText(); as streamed) {
              <p data-testid="coach-streaming-text">{{ streamed }}</p>
            } @else {
              <p class="text-muted">Generating on-device…</p>
            }
          </article>
        }
      </section>
    }

    <form class="chat-composer" #composer (ngSubmit)="sendMessage()">
      <label class="field" style="flex:1;">
        <span class="visually-hidden">Message Haloop Coach</span>
        <input
          class="input"
          type="text"
          name="prompt"
          placeholder="Ask about form, recovery, or a verse for today…"
          [ngModel]="promptText()"
          (ngModelChange)="promptText.set($event)"
          [disabled]="submitting()"
          data-testid="coach-prompt-input"
        />
      </label>
      <button
        class="btn btn--primary btn--pill"
        type="submit"
        [disabled]="submitting()"
        data-testid="coach-send"
      >
        <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
        {{ submitting() ? 'Sending' : 'Send' }}
      </button>
    </form>

    @if (verseDialogOpen()) {
      <div class="backdrop" (click)="closeVerseSearch()"></div>
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="verse-dlg-title"
        aria-describedby="verse-dlg-desc"
        (keydown.escape)="closeVerseSearch()"
        data-testid="verse-search-dialog"
      >
        <div class="dialog__panel">
          <div class="dialog__header">
            <div class="dialog__icon dialog__icon--info" aria-hidden="true">
              <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </div>
            <div style="flex:1;">
              <h2 class="dialog__title" id="verse-dlg-title">Search Scripture</h2>
              <p id="verse-dlg-desc" class="text-sm text-muted" style="margin-top:var(--space-1);">
                Semantic search powered by Xenova/all-MiniLM-L6-v2 (23 MB cached).
              </p>
            </div>
            <button
              type="button"
              class="btn btn--ghost btn--icon btn--sm"
              aria-label="Close dialog"
              (click)="closeVerseSearch()"
            >
              <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div class="dialog__body stack">
            <form class="cluster" (ngSubmit)="runVerseSearch()" [attr.aria-busy]="verseBusy()">
              <label class="field" style="flex:1;">
                <span class="field__label">Search KJV index on-device</span>
                <input
                  class="input"
                  type="search"
                  name="verseQuery"
                  [ngModel]="verseQuery()"
                  (ngModelChange)="verseQuery.set($event)"
                  [attr.aria-invalid]="verseError() ? 'true' : null"
                  data-testid="verse-search-input"
                />
                @if (verseError(); as err) {
                  <span class="field__error" role="alert">{{ err }}</span>
                }
              </label>
              <button
                type="submit"
                class="btn btn--primary btn--sm btn--pill"
                style="align-self:flex-end;"
                [disabled]="verseBusy()"
                data-testid="verse-search-submit"
              >
                {{ verseBusy() ? 'Searching…' : 'Search' }}
              </button>
            </form>

            @if (verseBusy()) {
              <div class="stack stack--sm" role="status" aria-label="Searching Scripture" data-testid="verse-search-busy">
                <span class="skeleton skeleton--text" style="width:90%;"></span>
                <span class="skeleton skeleton--text" style="width:75%;"></span>
              </div>
            } @else {
            <ul class="list">
              @for (v of verseResults(); track v.reference) {
                <li class="list__item">
                  <div class="list__body">
                    <div class="list__title">{{ v.reference }}</div>
                    <div class="list__meta">“{{ v.text }}”</div>
                  </div>
                  <button
                    type="button"
                    class="btn btn--sm btn--pill"
                    (click)="insertVerse(v)"
                    data-testid="verse-insert-btn"
                  >
                    Insert
                  </button>
                </li>
              }
            </ul>
            }
          </div>

          <div class="dialog__footer">
            <button type="button" class="btn btn--pill" (click)="closeVerseSearch()">Close</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class CoachPageComponent {
  private readonly scripture = inject(ScriptureService);
  private readonly chromeAi = inject(ChromeAiService);
  private readonly prefs = inject(PreferencesStore);
  private readonly db = inject(HaloopDbService);
  private readonly plan = inject(WorkoutPlanStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly composer = viewChild<ElementRef<HTMLElement>>('composer');
  protected readonly chatScroll = new ChatScroll(window, () => this.composer()?.nativeElement ?? null);

  protected readonly promptText = signal<string>('');
  protected readonly historyLoaded = signal<boolean>(false);
  protected readonly submitting = signal<boolean>(false);
  protected readonly streamingText = signal<string>('');
  protected readonly sessionInterrupted = signal<boolean>(false);
  protected readonly verseDialogOpen = signal<boolean>(false);
  protected readonly verseQuery = signal<string>('endurance and patience');
  protected readonly verseError = signal<string | null>(null);
  protected readonly verseResults = signal<readonly VerseSearchResult[]>([]);
  protected readonly verseBusy = signal<boolean>(false);
  private verseSearchToken = 0;
  protected readonly messages = signal<readonly CoachMessage[]>(DEFAULT_THREAD);

  constructor() {
    void this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    try {
      const saved = await this.db.get<CoachMessage[]>('coachMessages');
      if (saved && saved.length > 0) {
        this.messages.set(saved);
      }
    } finally {
      this.historyLoaded.set(true);
      // Opening the conversation lands on the most recent message, without animating.
      this.followLatest({ force: true, instant: true });
    }
  }

  /** Scrolls once the new content has rendered; a reader who scrolled up is left where they are. */
  private followLatest(options: { force?: boolean; instant?: boolean } = {}): void {
    afterNextRender(() => this.chatScroll.scrollToLatest(options), { injector: this.injector });
  }

  protected seedStarterPrompt(): void {
    this.promptText.set('Can you give me a 2-minute breath prayer before I start my plank holds?');
  }

  protected applyWarmUp(): void {
    this.plan.apply(LIGHT_LOAD_WARM_UP);
    void this.router.navigateByUrl('/train');
  }

  protected restartSession(): void {
    this.chromeAi.resetPromptSession();
    this.sessionInterrupted.set(false);
  }

  protected async sendMessage(): Promise<void> {
    const clean = this.promptText().trim();
    if (!clean) {
      return;
    }
    const userMsg: CoachMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      author: this.prefs.preferences().displayName.split(/\s+/)[0] || 'Micah',
      time: '07:16',
      text: clean,
    };
    this.messages.update((list) => [...list, userMsg]);
    this.promptText.set('');
    this.submitting.set(true);
    // Sending is the reader's own action: jump to their message and the generating indicator.
    this.followLatest({ force: true });

    try {
      const response = await this.chromeAi.promptCoach(clean, (text) => {
        this.streamingText.set(text);
        this.followLatest();
      });
      const reply: CoachMessage = {
        id: `c-${Date.now()}`,
        sender: 'coach',
        author: response.engine,
        time: '07:16',
        text: response.text,
        reflection: response.reflection,
      };
      this.messages.update((list) => [...list, reply]);
      this.followLatest();
      await this.db.set('coachMessages', this.messages());
    } catch {
      this.sessionInterrupted.set(true);
    } finally {
      this.streamingText.set('');
      this.submitting.set(false);
    }
  }

  protected async openVerseSearch(): Promise<void> {
    this.verseError.set(null);
    this.verseDialogOpen.set(true);
    await this.runVerseSearch();
  }

  protected closeVerseSearch(): void {
    this.verseSearchToken++;
    this.verseBusy.set(false);
    this.verseDialogOpen.set(false);
  }

  protected async runVerseSearch(): Promise<void> {
    const q = this.verseQuery().trim();
    if (!q) {
      this.verseError.set('Enter a theme, keyword, or reference (for example, “patience” or “Psalm 23”).');
      return;
    }
    this.verseError.set(null);
    const token = ++this.verseSearchToken;
    this.verseBusy.set(true);
    try {
      const hits = await this.scripture.searchSemantic(q, this.prefs.preferences().scriptureLanguage);
      // A newer search (or a closed dialog) supersedes this one.
      if (token === this.verseSearchToken) {
        this.verseResults.set(hits);
      }
    } catch {
      if (token === this.verseSearchToken) {
        this.verseResults.set([]);
        this.verseError.set('Scripture search is unavailable right now. Try again.');
      }
    } finally {
      if (token === this.verseSearchToken) {
        this.verseBusy.set(false);
      }
    }
  }

  protected insertVerse(verse: VerseSearchResult): void {
    this.promptText.set(`Reflect on ${verse.reference}: "${verse.text}"`);
    this.closeVerseSearch();
  }
}

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BluetoothDeviceStore } from '../../core/state/bluetooth-device.store';
import { SensorKind } from '../../core/wearables/web-bluetooth.adapter';

interface SensorChoice {
  readonly id: string;
  readonly kind: SensorKind;
  readonly name: string;
  readonly role: string;
}

/** The browser's own chooser lists the physical sensors; here the user says what kind of sensor to look for. */
const SENSOR_CHOICES: readonly SensorChoice[] = [
  { id: 'heart-rate', kind: 'heart-rate', name: 'Heart-rate strap or armband', role: 'Live BPM and heart-rate zones' },
  { id: 'running', kind: 'running', name: 'Running watch or cadence sensor', role: 'Live cadence in steps per minute' },
];

@Component({
  selector: 'app-devices-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (!store.loaded()) {
      <div class="stack" role="status" aria-busy="true" aria-label="Loading devices" data-testid="devices-loading">
        <span class="skeleton skeleton--text" style="width:70%;"></span>
        <div class="model-list">
          @for (n of [1, 2]; track n) {
            <div class="model-row">
              <div class="stack stack--sm">
                <span class="skeleton skeleton--text" style="width:45%;"></span>
                <span class="skeleton skeleton--text" style="width:65%;"></span>
              </div>
              <span class="skeleton skeleton--text" style="width:4rem;"></span>
              <span class="skeleton skeleton--text" style="width:4rem;"></span>
              <span class="skeleton" style="width:6rem;height:2rem;border-radius:var(--radius-full);margin-left:auto;"></span>
            </div>
          }
        </div>
      </div>
    } @else if (store.adapterStatus() === 'off') {
      <div class="alert alert--danger" role="alert" data-testid="devices-adapter-off">
        <svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
        <div class="alert__body">
          <div class="alert__title">Bluetooth adapter is turned off</div>
          <p class="text-sm">Turn on Bluetooth in your system settings so Chrome can reconnect to your sensors.</p>
          <div class="alert__actions">
            <button type="button" class="toast__action" (click)="store.checkAdapter()" data-testid="devices-check-again">Check again</button>
          </div>
        </div>
      </div>
    } @else if (store.adapterStatus() === 'unsupported') {
      <div class="alert alert--danger" role="alert" data-testid="devices-unsupported">
        <svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
        <div class="alert__body">
          <div class="alert__title">Web Bluetooth is not available</div>
          <p class="text-sm">Use Chrome or Edge on desktop or Android to pair a heart-rate strap or running watch. Haloop still works without sensors.</p>
        </div>
      </div>
    } @else if (store.devices().length === 0) {
      <div class="empty" data-testid="devices-empty">
        <div class="empty__icon" aria-hidden="true">
          <svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10-5 5V2l5 5L7 17" /></svg>
        </div>
        <h2 class="empty__title">No devices linked yet</h2>
        <p class="empty__text">
          Pair a Bluetooth heart-rate strap or watch to stream live zones during Train sessions. Haloop also works without
          sensors.
        </p>
        <div class="empty__actions">
          <button type="button" class="btn btn--primary btn--pill" (click)="openPairDialog()" data-testid="devices-empty-pair">
            <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Pair Bluetooth device
          </button>
        </div>
      </div>
    } @else {
    <div class="cluster cluster--between">
      <p class="text-soft" style="font-size:var(--font-size-lg); max-width:44rem;">
        Haloop connects directly to heart-rate straps and running watches via Web Bluetooth—no companion phone app or
        cloud relay required.
      </p>
      <button
        type="button"
        class="btn btn--primary btn--sm btn--pill"
        (click)="openPairDialog()"
        data-testid="devices-open-pair"
      >
        <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Pair device
      </button>
    </div>

    <section class="stack">
      <div class="section-head">
        <h2>Linked devices</h2>
        <span class="text-sm text-muted">{{ connectedCount() }} connected · Web Bluetooth active</span>
      </div>

      <div class="model-list">
        @for (device of store.devices(); track device.id) {
          <div class="model-row">
            <div>
              <div class="builtin-row__title">{{ device.label }}</div>
              <div class="builtin-row__desc">{{ device.role }}</div>
            </div>
            <div class="model-row__task">Battery {{ device.batteryPercent > 0 ? device.batteryPercent + '%' : '—' }}</div>
            <div class="model-row__size" [class.text-live]="device.connected" [class.text-muted]="!device.connected">
              {{ device.connected ? 'Connected' : 'Disconnected' }}
            </div>
            <div class="model-row__action">
              <button
                type="button"
                class="btn btn--sm btn--ghost"
                (click)="store.forgetDevice(device.id)"
                [attr.aria-label]="'Forget ' + device.label"
                [attr.data-testid]="'device-forget-' + device.id"
              >
                Forget
              </button>
              <button
                type="button"
                class="btn btn--sm btn--pill"
                (click)="store.toggleConnection(device.id)"
                [disabled]="store.pairingBusy()"
                [attr.data-testid]="'device-toggle-' + device.id"
              >
                {{ device.connected ? 'Disconnect' : 'Reconnect' }}
              </button>
            </div>
          </div>
        }
      </div>
    </section>
    }

    @if (pairDialogOpen()) {
      <div class="backdrop" (click)="closePairDialog()"></div>
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pair-dlg-title"
        aria-describedby="pair-dlg-desc"
        (keydown.escape)="closePairDialog()"
        data-testid="pair-device-dialog"
      >
        <div class="dialog__panel">
          <div class="dialog__header">
            <div class="dialog__icon dialog__icon--info" aria-hidden="true">
              <svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10-5 5V2l5 5L7 17" /></svg>
            </div>
            <div style="flex:1;">
              <h2 class="dialog__title" id="pair-dlg-title">Pair Bluetooth device</h2>
              <p id="pair-dlg-desc" class="text-sm text-muted" style="margin-top:var(--space-1);">
                Select a nearby BLE sensor to stream live metrics into Train.
              </p>
            </div>
            <button
              type="button"
              class="btn btn--ghost btn--icon btn--sm"
              aria-label="Close dialog"
              (click)="closePairDialog()"
            >
              <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div class="dialog__body stack">
            @if (store.pairOutcome() === 'timeout') {
              <div class="alert alert--danger" role="alert" data-testid="pair-device-timeout">
                <svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                <div class="alert__body">
                  <div class="alert__title">Pairing timed out</div>
                  <p class="text-sm">Make sure the sensor is awake and within 2 meters, then try again.</p>
                </div>
              </div>
            }
            <fieldset class="stack stack--sm">
              <legend>Sensor type</legend>
              @for (sensor of sensorChoices; track sensor.id) {
                <label class="choice">
                  <input
                    type="radio"
                    name="bt"
                    [value]="sensor.id"
                    [checked]="selectedSensorId() === sensor.id"
                    (change)="selectSensor(sensor)"
                  />
                  <span class="choice__text">
                    {{ sensor.name }}
                    <small>{{ sensor.role }}</small>
                  </span>
                </label>
              }
            </fieldset>

            <label class="field">
              <span class="field__label">Device label</span>
              <input
                class="input"
                type="text"
                name="deviceLabel"
                [ngModel]="deviceLabel()"
                (ngModelChange)="deviceLabel.set($event)"
                [attr.aria-invalid]="labelError() ? 'true' : null"
                data-testid="pair-device-label"
              />
              @if (labelError(); as err) {
                <span class="field__error" role="alert" data-testid="pair-device-error">{{ err }}</span>
              }
            </label>
          </div>

          <div class="dialog__footer">
            <button type="button" class="btn btn--pill" (click)="closePairDialog()">Cancel</button>
            <button
              type="button"
              class="btn btn--primary btn--pill"
              (click)="confirmPair()"
              [disabled]="store.pairingBusy()"
              data-testid="pair-device-submit"
            >
              {{ store.pairingBusy() ? 'Pairing…' : store.pairOutcome() === 'timeout' ? 'Try again' : 'Pair sensor' }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (store.toast(); as t) {
      <div class="toast-region" aria-live="polite" data-testid="device-toast">
        <div
          class="toast"
          [class.toast--info]="t.severity === 'info'"
          [class.toast--success]="t.severity === 'success'"
          [class.toast--warning]="t.severity === 'warning'"
          [class.toast--danger]="t.severity === 'danger'"
          role="status"
        >
          <div class="toast__icon" aria-hidden="true">
            <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24">
              @if (t.severity === 'success') {
                <path d="M20 6 9 17l-5-5" />
              } @else if (t.severity === 'danger' || t.severity === 'warning') {
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              } @else {
                <path d="m7 7 10 10-5 5V2l5 5L7 17" />
              }
            </svg>
          </div>
          <div class="toast__body">
            <div class="toast__title">{{ t.title }}</div>
            <div class="toast__text">{{ t.message }}</div>
            @if (t.action; as action) {
              <button type="button" class="toast__action" (click)="runToastAction(action.deviceId)" data-testid="device-toast-action">
                {{ action.label }}
              </button>
            }
          </div>
          <button
            type="button"
            class="btn btn--ghost btn--icon btn--sm"
            aria-label="Dismiss notification"
            (click)="store.dismissToast()"
          >
            <svg class="icon icon--sm" aria-hidden="true" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
    }
  `,
})
export class DevicesPageComponent {
  protected readonly store = inject(BluetoothDeviceStore);
  protected readonly sensorChoices = SENSOR_CHOICES;

  protected readonly pairDialogOpen = signal<boolean>(false);
  protected readonly selectedSensorId = signal<string>(SENSOR_CHOICES[0].id);
  protected readonly deviceLabel = signal<string>('');
  protected readonly labelError = signal<string | null>(null);

  protected readonly connectedCount = computed(
    () => this.store.devices().filter((d) => d.connected).length,
  );

  constructor() {
    void this.store.checkAdapter();
  }

  protected async runToastAction(deviceId: string): Promise<void> {
    this.store.dismissToast();
    await this.store.toggleConnection(deviceId);
  }

  protected openPairDialog(): void {
    this.store.pairOutcome.set(null);
    this.labelError.set(null);
    this.selectedSensorId.set(SENSOR_CHOICES[0].id);
    this.deviceLabel.set('');
    this.pairDialogOpen.set(true);
  }

  protected closePairDialog(): void {
    this.pairDialogOpen.set(false);
  }

  protected selectSensor(sensor: SensorChoice): void {
    this.selectedSensorId.set(sensor.id);
  }

  protected async confirmPair(): Promise<void> {
    const sensor = SENSOR_CHOICES.find((s) => s.id === this.selectedSensorId()) ?? SENSOR_CHOICES[0];
    const err = await this.store.pairSensor(sensor.kind, this.deviceLabel(), sensor.role);
    this.labelError.set(err);
    // Stay open after a cancel, timeout or failure so the user can retry without re-entering the label.
    if (!err && this.store.pairOutcome() === 'connected') {
      this.pairDialogOpen.set(false);
    }
  }
}

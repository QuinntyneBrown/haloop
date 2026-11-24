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
              {{ store.pairingBusy() ? 'Pairing…' : 'Pair sensor' }}
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

  protected openPairDialog(): void {
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
    if (!err) {
      this.pairDialogOpen.set(false);
    }
  }
}

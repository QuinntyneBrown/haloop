import { Routes } from '@angular/router';
import { AppShellComponent } from './layout/app-shell.component';
import { OnboardingPageComponent } from './features/onboarding/onboarding-page.component';
import { UnsupportedBrowserPageComponent } from './features/onboarding/unsupported-browser-page.component';
import { TodayPageComponent } from './features/today/today-page.component';
import { TrainPageComponent } from './features/train/train-page.component';
import { CoachPageComponent } from './features/coach/coach-page.component';
import { HistoryPageComponent } from './features/history/history-page.component';
import { SessionDetailPageComponent } from './features/history/session-detail-page.component';
import { DevicesPageComponent } from './features/devices/devices-page.component';
import { AiLabPageComponent } from './features/ai-lab/ai-lab-page.component';
import { SettingsPageComponent } from './features/settings/settings-page.component';
import { OfflinePageComponent } from './features/system/offline-page.component';
import { NotFoundPageComponent } from './features/system/not-found-page.component';

export const routes: Routes = [
  { path: 'welcome', component: OnboardingPageComponent },
  { path: 'unsupported', component: UnsupportedBrowserPageComponent },
  {
    path: '',
    component: AppShellComponent,
    children: [
      { path: '', component: TodayPageComponent },
      { path: 'train', component: TrainPageComponent },
      { path: 'coach', component: CoachPageComponent },
      { path: 'history', component: HistoryPageComponent },
      { path: 'history/:id', component: SessionDetailPageComponent },
      { path: 'devices', component: DevicesPageComponent },
      { path: 'lab', component: AiLabPageComponent },
      { path: 'settings', component: SettingsPageComponent },
      { path: 'offline', component: OfflinePageComponent },
      { path: '404', component: NotFoundPageComponent },
      { path: '**', redirectTo: '404' },
    ],
  },
];

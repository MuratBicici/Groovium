import { invoke } from '@tauri-apps/api/core';
import { currentLanguage } from '@/core/settings/store';

/**
 * Reporting a problem: the log's folder, and a new GitHub issue ready to be
 * written into. Nothing is sent by either — see `src-tauri/src/report.rs`.
 */
export async function openLogFolder(): Promise<void> {
  await invoke('logs_open_folder');
}

/** In the language the app is in, so the form asks in words its writer reads. */
export async function reportProblem(): Promise<void> {
  await invoke('report_problem', { language: currentLanguage() });
}

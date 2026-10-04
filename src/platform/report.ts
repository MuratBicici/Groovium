import { invoke } from '@tauri-apps/api/core';

/**
 * Reporting a problem: the log's folder, and a new GitHub issue ready to be
 * written into. Nothing is sent by either — see `src-tauri/src/report.rs`.
 */
export async function openLogFolder(): Promise<void> {
  await invoke('logs_open_folder');
}

export async function reportProblem(): Promise<void> {
  await invoke('report_problem');
}

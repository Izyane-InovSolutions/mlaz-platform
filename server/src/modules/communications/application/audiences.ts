// Port: who a broadcast reaches. Members belong to the membership module, which depends on this one (for the outbox),
// so membership implements this interface and the composition root (platform/modules.ts) provides it.
// Audience keys: ALL, DUES_DUE (dues payable now or overdue), LAPSED, SUSPENDED, TIER:<name>, PROVINCE:<name>.

export interface AudienceDirectory {
  /** Every audience the Secretariat can choose, with how many members it reaches now. */
  list(): Promise<{ key: string; label: string; count: number }[]>;
  /** The contact details of everyone in an audience. Throws 400 for an unknown key. */
  recipients(audience: string): Promise<{ contactEmail: string; contactPhone: string }[]>;
}

let directory: AudienceDirectory | null = null;

export const provideAudienceDirectory = (d: AudienceDirectory) => { directory = d; };

export function audienceDirectory(): AudienceDirectory {
  if (!directory) throw new Error('No audience directory provided: call wireModules() (platform/modules.ts) at startup.');
  return directory;
}

// The `test` every spec imports: Playwright's own, plus a guard that fails the test if the browser reports a
// Content-Security-Policy violation on any page it opened (the default page and contexts made with browser.newContext).
// Chromium reports every violation (blocked script, style, image, connection, frame...) as a console error naming the
// policy, so listening to the console catches them without adding anything to the pages under test. The check runs
// after the test body, so the test's own failure, if any, is reported first.
import { type BrowserContext, test as base, expect } from '@playwright/test';

const VIOLATION = /Content[- ]Security[- ]Policy/i;

export const test = base.extend<{ cspGuard: void }>({
  cspGuard: [async ({ browser, context }, use) => {
    const violations: string[] = [];
    const watch = (c: BrowserContext) => c.on('console', m => {
      if (m.type() === 'error' && VIOLATION.test(m.text())) violations.push(`${m.location().url || '(page)'}: ${m.text()}`);
    });
    watch(context);
    // Contexts a test opens itself (a second browser, say) are watched too, for the length of the test.
    const newContext = browser.newContext;
    browser.newContext = async (...args) => {
      const c = await newContext.apply(browser, args);
      watch(c);
      return c;
    };
    try {
      await use();
    } finally {
      browser.newContext = newContext;
    }
    expect(violations, 'the browser reported Content-Security-Policy violations').toEqual([]);
  }, { auto: true }],
});

export { expect };
export type { APIRequestContext, Browser, BrowserContext, Download, Page } from '@playwright/test';

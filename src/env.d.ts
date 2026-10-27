/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Interface language chosen by src/middleware.ts. */
    locale: import('./shared/i18n.ts').Locale;
  }
}
